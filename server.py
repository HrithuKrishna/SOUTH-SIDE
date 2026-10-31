#!/usr/bin/env python3
"""Static game host and small WebSocket relay for South Side."""

import base64
import hashlib
import json
import mimetypes
import os
import secrets
import socket
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


CLIENT_ROOT = Path(__file__).resolve().parents[1] / "client"
MAX_MESSAGE_SIZE = 1_000_000
clients = {}
clients_lock = threading.Lock()


def frame(payload, opcode=1):
    data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
    length = len(data)
    if length < 126:
        header = bytes([0x80 | opcode, length])
    elif length <= 0xFFFF:
        header = bytes([0x80 | opcode, 126]) + struct.pack("!H", length)
    else:
        header = bytes([0x80 | opcode, 127]) + struct.pack("!Q", length)
    return header + data


def send_json(client, message):
    try:
        data = frame(json.dumps(message, separators=(",", ":"), ensure_ascii=False))
        with client["send_lock"]:
            client["socket"].sendall(data)
        return True
    except (OSError, socket.error):
        return False


def broadcast(message, exclude=None):
    with clients_lock:
        recipients = [
            client
            for identifier, client in clients.items()
            if identifier != exclude and client.get("name")
        ]
    for client in recipients:
        send_json(client, message)


def read_exact(connection, length):
    data = bytearray()
    while len(data) < length:
        chunk = connection.recv(length - len(data))
        if not chunk:
            return None
        data.extend(chunk)
    return bytes(data)


def read_frame(connection):
    header = read_exact(connection, 2)
    if header is None:
        return None, None
    first, second = header
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if length == 126:
        extension = read_exact(connection, 2)
        if extension is None:
            return None, None
        length = struct.unpack("!H", extension)[0]
    elif length == 127:
        extension = read_exact(connection, 8)
        if extension is None:
            return None, None
        length = struct.unpack("!Q", extension)[0]
    if length > MAX_MESSAGE_SIZE:
        raise ValueError("WebSocket message is too large")
    mask = read_exact(connection, 4) if masked else None
    payload = read_exact(connection, length)
    if payload is None:
        return None, None
    if masked and mask:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return opcode, payload


def handle_message(client, message):
    kind = message.get("type")
    if kind == "hello":
        name = str(message.get("name", "Explorer")).strip()[:20] or "Explorer"
        gender = message.get("gender") if message.get("gender") in ("male", "female") else "male"
        try:
            x = max(-55.0, min(55.0, float(message.get("x", -12))))
            z = max(-100.0, min(200.0, float(message.get("z", 0))))
        except (TypeError, ValueError):
            x, z = 0.0, -16.0
        client.update({"name": name, "gender": gender, "x": x, "z": z})
        with clients_lock:
            current_players = [
                {"id": other_id, "name": other["name"], "gender": other["gender"], "x": other["x"], "z": other["z"]}
                for other_id, other in clients.items()
                if other_id != client["id"] and other.get("name")
            ]
        send_json(client, {"type": "welcome", "id": client["id"], "players": current_players})
        broadcast(
            {"type": "join", "player": {"id": client["id"], "name": name, "gender": gender, "x": x, "z": z}},
            exclude=client["id"],
        )
    elif kind == "move" and client.get("name"):
        try:
            client["x"] = max(-55.0, min(55.0, float(message.get("x", client["x"]))))
            client["z"] = max(-100.0, min(200.0, float(message.get("z", client["z"]))))
        except (TypeError, ValueError):
            return
        broadcast({"type": "move", "id": client["id"], "name": client["name"], "x": client["x"], "z": client["z"]}, exclude=client["id"])
    elif kind == "chat" and client.get("name"):
        text = str(message.get("text", "")).strip()[:160]
        if text:
            broadcast({"type": "chat", "name": client["name"], "text": text}, exclude=client["id"])
    elif kind == "profile" and client.get("name"):
        name = str(message.get("name", client["name"])).strip()[:20] or client["name"]
        gender = message.get("gender") if message.get("gender") in ("male", "female") else client["gender"]
        client.update({"name": name, "gender": gender})
        broadcast(
            {
                "type": "profile",
                "player": {
                    "id": client["id"],
                    "name": name,
                    "gender": gender,
                    "x": client["x"],
                    "z": client["z"],
                },
            },
            exclude=client["id"],
        )
    elif kind == "signal" and client.get("name"):
        destination = message.get("to")
        payload = message.get("payload")
        if isinstance(destination, str) and isinstance(payload, dict) and len(json.dumps(payload)) <= MAX_MESSAGE_SIZE:
            with clients_lock:
                target = clients.get(destination)
            if target:
                send_json(target, {"type": "signal", "from": client["id"], "payload": payload})


class GameHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if urlsplit(self.path).path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket()
            return
        self.serve_file()

    def serve_file(self):
        path = unquote(urlsplit(self.path).path)
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        requested = (CLIENT_ROOT / relative).resolve()
        try:
            requested.relative_to(CLIENT_ROOT.resolve())
        except ValueError:
            self.send_error(403)
            return
        if requested.is_dir():
            requested = requested / "index.html"
        if not requested.is_file():
            self.send_error(404)
            return
        try:
            payload = requested.read_bytes()
        except OSError:
            self.send_error(500)
            return
        content_type = mimetypes.guess_type(str(requested))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def handle_websocket(self):
        websocket_key = self.headers.get("Sec-WebSocket-Key")
        if not websocket_key or self.headers.get("Sec-WebSocket-Version") != "13":
            self.send_error(400)
            return
        accept = base64.b64encode(
            hashlib.sha1((websocket_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
        ).decode("ascii")
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        identifier = secrets.token_urlsafe(12)
        client = {
            "id": identifier,
            "socket": self.connection,
            "send_lock": threading.Lock(),
        }
        with clients_lock:
            clients[identifier] = client
        try:
            while True:
                opcode, payload = read_frame(self.connection)
                if opcode is None or opcode == 8:
                    break
                if opcode == 9:
                    with client["send_lock"]:
                        self.connection.sendall(frame(payload or b"", 10))
                    continue
                if opcode != 1:
                    continue
                try:
                    message = json.loads(payload.decode("utf-8"))
                    if isinstance(message, dict):
                        handle_message(client, message)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    send_json(client, {"type": "error", "message": "Invalid message format."})
                except ValueError:
                    send_json(client, {"type": "error", "message": "Message is too large."})
        except (OSError, socket.error, ValueError):
            pass
        finally:
            with clients_lock:
                clients.pop(identifier, None)
            self.connection.close()
            if client.get("name"):
                broadcast({"type": "leave", "id": identifier})


class ThreadedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    host = os.environ.get("SOUTH_SIDE_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", os.environ.get("SOUTH_SIDE_PORT", "8765")))
    server = ThreadedHTTPServer((host, port), GameHandler)
    print(f"South Side is ready at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping South Side.")
        server.server_close()
