import * as THREE from "three";

const $ = (selector) => document.querySelector(selector);
const sceneRoot = $("#scene");
const profileStoreKey = "south-side.profile.v1";
const movementKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 420);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
sceneRoot.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const world = new THREE.Group();
scene.add(world);
scene.fog = new THREE.Fog(0xacc5c8, 80, 260);

const hemiLight = new THREE.HemisphereLight(0xd8eaff, 0x485448, 1.1);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffedcd, 2.6);
sunLight.position.set(-35, 75, -45);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -80;
sunLight.shadow.camera.right = 80;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.bias = -0.00025;
sunLight.shadow.normalBias = 0.02;
scene.add(sunLight);

const material = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const mat = {
  paving: material(0xb5aa91),
  pavingLight: material(0xd0c8b2),
  pavingDark: material(0x827b6a),
  curb: material(0xb8b39f),
  concrete: material(0xa6a99b),
  concreteDark: material(0x626e62),
  metal: material(0x39463d, 0.38, { metalness: 0.5 }),
  metalLight: material(0xa0aa94, 0.34, { metalness: 0.5 }),
  leaf: material(0x4e7548),
  leafLight: material(0x7d9b5b),
  leafDeep: material(0x355d3c),
  bark: material(0x604832),
  grass: material(0x547b49),
};
const up = new THREE.Vector3(0, 1, 0);
const playerStart = new THREE.Vector3(-12, 0, 0);
const player = { group: null, model: null, name: "Explorer", gender: "male", position: playerStart.clone(), velocityY: 0, stamina: 100, moving: false, walkingTime: 0 };
const keyState = new Set();
const network = {
  socket: null,
  id: null,
  connected: false,
  players: new Map(),
  peers: new Map(),
  voiceStream: null,
  reconnectTimer: null,
  reconnectDelay: 1000,
};
let cameraYaw = 0;
let cameraPitch = 0.12;
let chatOpen = false;
let toastTimeout = 0;
let currentGender = "male";
let profile = readProfile();
let activeLabel = "OPEN LAWN";

function readProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(profileStoreKey) || "null");
    if (saved && typeof saved.name === "string" && ["male", "female"].includes(saved.gender)) {
      return { name: saved.name.slice(0, 20), gender: saved.gender };
    }
  } catch (error) {
    console.warn("Could not read the saved South Side profile.", error);
  }
  return null;
}

function saveProfile(nextProfile) {
  try {
    localStorage.setItem(profileStoreKey, JSON.stringify(nextProfile));
    profile = nextProfile;
  } catch (error) {
    showToast("Profile could not be saved in this browser.");
    console.error("Could not save the South Side profile.", error);
  }
}

function box(parent, size, position, surface, castShadow = true, receiveShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), surface);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function cylinderBetween(parent, start, end, radius, surface, radialSegments = 8) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.78, radius, direction.length(), radialSegments), surface);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(up, direction.normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addGround() {
  const lawn = box(world, [120, 0.52, 330], [0, -0.31, 50], mat.grass, false);
  lawn.receiveShadow = true;
  box(world, [150, 0.18, 360], [0, -0.67, 50], material(0x665848), false);
}

function addTree(x, z, variant = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  world.add(group);
  const height = 4.8 + (variant % 4) * 0.35;
  cylinderBetween(group, new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.15, height, 0), 0.35, mat.bark, 10);
  for (let branch = 0; branch < 7; branch++) {
    const angle = branch * 0.9 + variant * 0.41;
    const end = new THREE.Vector3(Math.cos(angle) * 2.4, height + (branch % 3) * 0.35, Math.sin(angle) * 2.1);
    const start = new THREE.Vector3(0.1, height * 0.7 + (branch % 2) * 0.55, 0);
    cylinderBetween(group, start, end, 0.12, mat.bark, 7);
  }
  for (let leaf = 0; leaf < 17; leaf++) {
    const angle = leaf * 2.4 + variant * 0.7;
    const radius = 0.6 + (leaf % 5) * 0.38;
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      [mat.leaf, mat.leafLight, mat.leafDeep][leaf % 3],
    );
    crown.position.set(Math.cos(angle) * radius, height + Math.sin(leaf * 1.7) * 1.2, Math.sin(angle) * radius);
    crown.scale.set(1.15 + (leaf % 3) * 0.17, 0.72 + (leaf % 4) * 0.08, 1 + (leaf % 2) * 0.23);
    crown.castShadow = true;
    group.add(crown);
  }
  const mulch = new THREE.Mesh(new THREE.CircleGeometry(2.15, 24), material(0x5b5940));
  mulch.rotation.x = -Math.PI / 2;
  mulch.position.set(x, -0.035, z);
  world.add(mulch);
}

function addBench(x, z, rotation = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  world.add(group);
  for (let slat = 0; slat < 5; slat++) {
    box(group, [2.4, 0.12, 0.22], [0, 0.67 + slat * 0.015, (slat - 2) * 0.25], slat % 2 ? mat.pavingLight : mat.concreteDark);
  }
  for (const side of [-1, 1]) {
    box(group, [0.13, 0.55, 1.1], [side * 0.9, 0.35, 0], mat.metal);
    box(group, [0.13, 1.45, 0.13], [side * 0.9, 0.83, -0.43], mat.metal);
  }
  for (let slat = 0; slat < 4; slat++) {
    box(group, [2.35, 0.12, 0.2], [0, 1.05 + slat * 0.22, -0.53], slat % 2 ? mat.pavingLight : mat.concreteDark);
  }
}

const lamps = [];
function addLamp(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  world.add(group);
  cylinderBetween(group, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5.2, 0), 0.1, mat.metalLight, 10);
  cylinderBetween(group, new THREE.Vector3(0, 5.05, 0), new THREE.Vector3(-0.2, 5.55, -0.5), 0.075, mat.metal, 8);
  const shade = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 14), material(0xdcae72, 0.35, { emissive: 0xf1ad64, emissiveIntensity: 0.05 }));
  shade.position.set(-0.2, 5.42, -0.5);
  group.add(shade);
  const light = new THREE.PointLight(0xffc777, 0, 14, 2);
  light.position.copy(shade.position);
  light.position.y -= 0.1;
  group.add(light);
  lamps.push({ light, shade: shade.material });
}

function addForest(treeSpots) {
  const treeCount = treeSpots.length;
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), mat.bark, treeCount);
  const branchMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 7), mat.bark, treeCount * 7);
  const leafGeometry = new THREE.SphereGeometry(1, 20, 14);
  const leafMeshes = [mat.leaf, mat.leafLight, mat.leafDeep].map(
    (surface) => new THREE.InstancedMesh(leafGeometry, surface, treeCount * 6),
  );
  const mulchMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24), material(0x5b5940), treeCount);
  const dummy = new THREE.Object3D();
  const branchStart = new THREE.Vector3();
  const branchEnd = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const leafCounts = [0, 0, 0];
  let branchIndex = 0;

  treeSpots.forEach(([x, z], variant) => {
    const height = 4.8 + (variant % 4) * 0.35;
    dummy.position.set(x + 0.15, height / 2, z);
    dummy.quaternion.identity();
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(variant, dummy.matrix);

    for (let branch = 0; branch < 7; branch++) {
      const angle = branch * 0.9 + variant * 0.41;
      branchStart.set(0.1, height * 0.7 + (branch % 2) * 0.55, 0);
      branchEnd.set(Math.cos(angle) * 2.4, height + (branch % 3) * 0.35, Math.sin(angle) * 2.1);
      direction.subVectors(branchEnd, branchStart);
      const length = direction.length();
      dummy.position.set(
        x + (branchStart.x + branchEnd.x) / 2,
        (branchStart.y + branchEnd.y) / 2,
        z + (branchStart.z + branchEnd.z) / 2,
      );
      dummy.quaternion.setFromUnitVectors(up, direction.normalize());
      dummy.scale.set(1, length, 1);
      dummy.updateMatrix();
      branchMesh.setMatrixAt(branchIndex++, dummy.matrix);
    }

    for (let leaf = 0; leaf < 17; leaf++) {
      const angle = leaf * 2.4 + variant * 0.7;
      const radius = 0.6 + (leaf % 5) * 0.38;
      const surfaceIndex = leaf % 3;
      dummy.position.set(
        x + Math.cos(angle) * radius,
        height + Math.sin(leaf * 1.7) * 1.2,
        z + Math.sin(angle) * radius,
      );
      dummy.quaternion.identity();
      dummy.scale.set(1.15 + (leaf % 3) * 0.17, 0.72 + (leaf % 4) * 0.08, 1 + (leaf % 2) * 0.23);
      dummy.updateMatrix();
      leafMeshes[surfaceIndex].setMatrixAt(leafCounts[surfaceIndex]++, dummy.matrix);
    }

    dummy.position.set(x, -0.035, z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(2.15, 2.15, 1);
    dummy.updateMatrix();
    mulchMesh.setMatrixAt(variant, dummy.matrix);
  });

  trunkMesh.castShadow = true;
  branchMesh.castShadow = true;
  leafMeshes.forEach((mesh, index) => {
    mesh.count = leafCounts[index];
    mesh.castShadow = true;
    world.add(mesh);
  });
  mulchMesh.receiveShadow = true;
  world.add(trunkMesh, branchMesh, mulchMesh);
  trunkMesh.instanceMatrix.needsUpdate = true;
  branchMesh.instanceMatrix.needsUpdate = true;
  leafMeshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  mulchMesh.instanceMatrix.needsUpdate = true;
}

function addParkPath(points, width, surface = mat.paving) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0.015, z)));
  const steps = points.length * 18;
  const halfWidth = width / 2;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const offsetX = (tangent.z / Math.hypot(tangent.x, tangent.z)) * halfWidth;
    const offsetZ = (-tangent.x / Math.hypot(tangent.x, tangent.z)) * halfWidth;
    positions.push(point.x - offsetX, point.y, point.z - offsetZ);
    positions.push(point.x + offsetX, point.y, point.z + offsetZ);
    if (i < steps) {
      const current = i * 2;
      const next = current + 2;
      indices.push(current, next + 1, current + 1, current, next, next + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const path = new THREE.Mesh(geometry, surface);
  path.receiveShadow = true;
  world.add(path);
  return path;
}

function addCourtMarking(x, y, z, width, depth, surface) {
  return box(world, [width, 0.025, depth], [x, y, z], surface, false, false);
}

function addBasketballCourt(x, z, paint) {
  box(world, [24, 0.24, 36], [x, -0.02, z], mat.concreteDark, false);
  box(world, [22.8, 0.04, 34.8], [x, 0.12, z], paint, false);
  const line = material(0xf0e9ce, 0.9);
  addCourtMarking(x, 0.15, z - 16.8, 21.8, 0.16, line);
  addCourtMarking(x, 0.15, z + 16.8, 21.8, 0.16, line);
  addCourtMarking(x - 10.8, 0.15, z, 0.16, 33.6, line);
  addCourtMarking(x + 10.8, 0.15, z, 0.16, 33.6, line);
  addCourtMarking(x, 0.15, z, 0.14, 33.4, line);
  for (const side of [-1, 1]) {
    const circle = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.075, 6, 32), line);
    circle.rotation.x = Math.PI / 2;
    circle.position.set(x, 0.17, z + side * 11.6);
    world.add(circle);
    box(world, [0.35, 3.1, 0.35], [x, 1.7, z + side * 15.9], mat.metal, true);
    box(world, [3.1, 1.8, 0.16], [x, 3.2, z + side * 14.4], material(0xe5e8dc, 0.55), false);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.075, 8, 24), material(0xdf8959, 0.45, { metalness: 0.25 }));
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(x, 2.54, z + side * 13.45);
    world.add(hoop);
    for (let strand = 0; strand < 8; strand++) {
      const angle = (strand / 8) * Math.PI * 2;
      const start = new THREE.Vector3(x + Math.cos(angle) * 0.6, 2.5, z + side * 13.45 + Math.sin(angle) * 0.6);
      const end = new THREE.Vector3(x + Math.cos(angle + 0.2) * 0.2, 1.85, z + side * 13.45 + Math.sin(angle + 0.2) * 0.2);
      cylinderBetween(world, start, end, 0.012, line, 4);
    }
  }
}

function addPlayground() {
  const padX = -19;
  const padZ = 26;
  box(world, [34, 0.24, 32], [padX, 0, padZ], mat.concreteDark, false);
  box(world, [32, 0.12, 30], [padX, 0.16, padZ], mat.rubber, false);
  box(world, [13, 0.08, 12], [-23, 0.25, 21], mat.rubberBlue, false);
  box(world, [13, 0.08, 12], [-13, 0.25, 32], mat.rubberGold, false);

  const slidePlatform = material(0xe59a57, 0.5);
  const slideSupport = material(0x637b91, 0.42, { metalness: 0.25 });
  box(world, [0.16, 2.8, 0.16], [-27, 1.55, 23], slideSupport);
  box(world, [0.16, 2.8, 0.16], [-21, 1.55, 23], slideSupport);
  box(world, [0.16, 2.8, 0.16], [-27, 1.55, 28], slideSupport);
  box(world, [0.16, 2.8, 0.16], [-21, 1.55, 28], slideSupport);
  box(world, [6.4, 0.18, 5.4], [-24, 2.9, 25.5], slidePlatform);
  box(world, [5.4, 0.18, 0.22], [-24, 3, 22.9], mat.metalLight);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 5.4, 14), slidePlatform);
    rail.position.set(-24 + side * 1.6, 1.6, 20.1);
    rail.rotation.x = -0.55;
    rail.castShadow = true;
    world.add(rail);
    box(world, [0.22, 0.18, 0.7], [-24 + side * 1.6, 0.72, 17.9], slidePlatform);
    box(world, [0.22, 0.18, 0.7], [-24 + side * 1.6, 1.17, 18.7], slidePlatform);
  }
  box(world, [3.2, 0.22, 5.6], [-24, 1.83, 20.1], material(0x6cb3c3, 0.28, { metalness: 0.1 }));

  const swingX = -10;
  const swingZ = 27;
  for (const x of [swingX - 4.1, swingX + 4.1]) {
    cylinderBetween(world, new THREE.Vector3(x, 0.25, swingZ - 1), new THREE.Vector3(x, 4.8, swingZ), 0.13, slideSupport, 10);
    cylinderBetween(world, new THREE.Vector3(x, 0.25, swingZ + 1), new THREE.Vector3(x, 4.8, swingZ), 0.13, slideSupport, 10);
  }
  cylinderBetween(world, new THREE.Vector3(swingX - 4.1, 4.8, swingZ), new THREE.Vector3(swingX + 4.1, 4.8, swingZ), 0.16, slideSupport, 12);
  for (const x of [swingX - 2, swingX, swingX + 2]) {
    for (const side of [-1, 1]) {
      cylinderBetween(world, new THREE.Vector3(x, 4.65, swingZ), new THREE.Vector3(x, 1.3, swingZ + side * 0.48), 0.035, mat.metal, 6);
    }
    box(world, [0.9, 0.18, 0.65], [x, 1.23, swingZ], mat.rubberGold);
  }

  const barsX = -8;
  const barsZ = 37;
  for (const x of [barsX - 3.2, barsX + 3.2]) {
    for (const z of [barsZ - 2.2, barsZ + 2.2]) {
      cylinderBetween(world, new THREE.Vector3(x, 0.2, z), new THREE.Vector3(x, 3.3, z), 0.08, slideSupport, 8);
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = barsX - 3.2 + i * (6.4 / 6);
    cylinderBetween(world, new THREE.Vector3(x, 3.3, barsZ - 2.2), new THREE.Vector3(x, 3.3, barsZ + 2.2), 0.055, mat.rubberGold, 8);
  }

  const seesawPivot = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.3, 12), mat.rubberGold);
  seesawPivot.position.set(-28, 0.65, 36);
  seesawPivot.castShadow = true;
  world.add(seesawPivot);
  const seesaw = box(world, [0.22, 0.18, 6.8], [-28, 1.1, 36], slidePlatform);
  seesaw.rotation.x = 0.08;
  for (const z of [33.2, 38.8]) {
    box(world, [0.8, 0.16, 0.9], [-28, 1.17, z], mat.rubberBlue);
    cylinderBetween(world, new THREE.Vector3(-28, 1.2, z), new THREE.Vector3(-28, 1.9, z), 0.045, mat.metal, 6);
  }
}

function addGazebo(x, z) {
  const roof = material(0x596f56, 0.62);
  const postPositions = [-3.6, 3.6];
  for (const px of postPositions) {
    for (const pz of postPositions) {
      cylinderBetween(world, new THREE.Vector3(x + px, 0.2, z + pz), new THREE.Vector3(x + px, 4.5, z + pz), 0.12, mat.bark, 10);
    }
  }
  box(world, [8.2, 0.22, 8.2], [x, 0.15, z], mat.pavingLight, false);
  const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(6.6, 2.1, 4), roof);
  roofMesh.position.set(x, 5, z);
  roofMesh.rotation.y = Math.PI / 4;
  roofMesh.castShadow = true;
  world.add(roofMesh);
  for (const side of [-1, 1]) {
    const bench = box(world, [4.5, 0.24, 0.8], [x + side * 2, 0.75, z + 2.4], mat.pavingDark);
    bench.rotation.y = side * 0.12;
  }
}

function addPicnicTable(x, z) {
  box(world, [3.8, 0.2, 1.35], [x, 1.05, z], mat.pavingDark);
  box(world, [0.18, 1.15, 0.18], [x, 0.57, z], mat.metal);
  for (const side of [-1, 1]) {
    box(world, [3.6, 0.15, 0.55], [x, 0.72, z + side * 1.1], mat.pavingLight);
    box(world, [0.18, 0.7, 0.18], [x, 0.38, z + side * 1.1], mat.metal);
  }
}

function addStageLight(x) {
  const shade = material(0xffd49a, 0.35, { emissive: 0xffb95c, emissiveIntensity: 0.05 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), shade);
  bulb.position.set(x, 10.6, 171.5);
  world.add(bulb);
  const light = new THREE.PointLight(0xffc777, 0, 34, 2);
  light.position.set(x, 10, 169.5);
  world.add(light);
  lamps.push({ light, shade });
}

function addCommunityStage() {
  const stageDeck = material(0x544d49, 0.5);
  const structure = material(0x303a3d, 0.4, { metalness: 0.42 });
  const canopy = material(0x354a44, 0.56, { metalness: 0.18 });
  const speaker = material(0x202728, 0.5);

  box(world, [48, 0.9, 18], [0, 0.45, 180], stageDeck);
  box(world, [48.5, 0.35, 0.35], [0, 0.42, 171], material(0x81946b));
  for (let step = 0; step < 4; step++) {
    const height = 0.225 * (4 - step);
    box(world, [13, height, 1.3], [0, height / 2, 170.25 - step * 1.3], mat.concreteDark);
  }

  for (const x of [-23, 23]) {
    for (const z of [172, 188]) {
      box(world, [0.7, 10.5, 0.7], [x, 5.25, z], structure);
    }
  }
  box(world, [48, 0.7, 0.7], [0, 10.4, 172], structure);
  box(world, [48, 0.7, 0.7], [0, 10.4, 188], structure);
  box(world, [0.7, 0.7, 16], [-23, 10.4, 180], structure);
  box(world, [0.7, 0.7, 16], [23, 10.4, 180], structure);
  box(world, [54, 0.8, 22], [0, 11.25, 180], canopy);
  box(world, [34, 8.2, 0.65], [0, 5.4, 172.2], structure);

  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 1024;
  screenCanvas.height = 384;
  const context = screenCanvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 1024, 384);
  gradient.addColorStop(0, "#183a35");
  gradient.addColorStop(0.5, "#385b49");
  gradient.addColorStop(1, "#1c3433");
  context.fillStyle = gradient;
  context.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
  context.strokeStyle = "#c5f16a";
  context.lineWidth = 8;
  context.strokeRect(18, 18, 988, 348);
  context.textAlign = "center";
  context.fillStyle = "#c5f16a";
  context.font = "600 40px Arial";
  context.fillText("SOUTH SIDE", 512, 135);
  context.fillStyle = "#f3f1e9";
  context.font = "700 88px Arial";
  context.fillText("COMMUNITY STAGE", 512, 238);
  context.fillStyle = "#d1deca";
  context.font = "28px Arial";
  context.fillText("GATHER  ·  SHARE  ·  PLAY", 512, 310);
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 7.6),
    new THREE.MeshBasicMaterial({ map: screenTexture }),
  );
  screen.position.set(0, 5.4, 171.86);
  screen.rotation.y = Math.PI;
  world.add(screen);

  for (const x of [-22, 22]) {
    box(world, [2.8, 4.2, 2.4], [x, 2.1, 173], speaker);
    box(world, [2.2, 1.7, 0.12], [x, 2.1, 171.75], material(0x111718));
    for (const y of [1.65, 2.55]) {
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.52, 20), material(0x536061));
      cone.position.set(x, y, 171.67);
      cone.rotation.y = Math.PI;
      world.add(cone);
    }
  }

  for (const x of [-18, -6, 6, 18]) addStageLight(x);
}

function addFountain(x, z) {
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 0.55, 40), mat.concreteDark);
  stone.position.set(x, 0.15, z);
  stone.castShadow = true;
  world.add(stone);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.9, 0.16, 40), mat.pavingLight);
  basin.position.set(x, 0.48, z);
  world.add(basin);
  const water = new THREE.Mesh(new THREE.CircleGeometry(4.55, 40), mat.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.57, z);
  world.add(water);
  for (const radius of [1.2, 2.4, 3.5]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 8, 36), mat.pavingLight);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.6, z);
    world.add(ring);
  }
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 2.1, 16), mat.pavingLight);
  column.position.set(x, 1.55, z);
  column.castShadow = true;
  world.add(column);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 0.4, 0.5, 24), mat.concrete);
  bowl.position.set(x, 2.65, z);
  bowl.castShadow = true;
  world.add(bowl);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.18, 1.6, 12), material(0xb8e6d9, 0.15, { emissive: 0x4a9f91, emissiveIntensity: 0.24, transparent: true, opacity: 0.8 }));
  jet.position.set(x, 3.55, z);
  world.add(jet);
}

function addFlowerBed(x, z, width, depth, variant = 0) {
  box(world, [width, 0.24, depth], [x, 0.03, z], mat.flowerBed, false);
  const flowerGeometry = new THREE.SphereGeometry(0.2, 10, 8);
  for (let i = 0; i < 24; i++) {
    const px = x + ((i * 7) % 17) / 17 * (width - 1) - (width - 1) / 2;
    const pz = z + ((i * 11) % 19) / 19 * (depth - 1) - (depth - 1) / 2;
    const flower = new THREE.Mesh(flowerGeometry, mat.flower[(i + variant) % mat.flower.length]);
    flower.position.set(px, 0.42 + (i % 3) * 0.08, pz);
    flower.scale.set(1, 1 + (i % 3) * 0.18, 1);
    flower.castShadow = true;
    world.add(flower);
  }
}

function addSign() {
  const support = material(0x5a6246);
  box(world, [0.24, 2.8, 5.8], [7, 1.45, -35], support);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "#294536";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#c5f16a";
  context.lineWidth = 8;
  context.strokeRect(12, 12, 488, 232);
  context.textAlign = "center";
  context.fillStyle = "#c5f16a";
  context.font = "600 34px Arial";
  context.fillText("WELCOME TO", 256, 91);
  context.fillStyle = "#f3f1e9";
  context.font = "700 54px Arial";
  context.fillText("SOUTH SIDE PARK", 256, 157);
  context.fillStyle = "#d1deca";
  context.font = "22px Arial";
  context.fillText("A PLACE FOR EVERYONE", 256, 202);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.75), new THREE.MeshBasicMaterial({ map: texture }));
  face.position.set(6.86, 1.65, -35);
  face.rotation.y = -Math.PI / 2;
  world.add(face);
}

function addVolleyballCourt(x, z) {
  box(world, [23, 0.22, 15], [x, 0, z], material(0xc5ac78), false);
  box(world, [21.8, 0.025, 13.8], [x, 0.13, z], material(0xd7bf8b), false);
  const line = material(0xf5ebd0);
  for (const side of [-1, 1]) {
    box(world, [0.12, 0.03, 13.4], [x + side * 10.7, 0.15, z], line, false, false);
    box(world, [21.4, 0.03, 0.12], [x, 0.15, z + side * 6.7], line, false, false);
  }
  for (const side of [-1, 1]) {
    cylinderBetween(world, new THREE.Vector3(x, 0.2, z + side * 7), new THREE.Vector3(x, 3.4, z + side * 7), 0.09, mat.metal, 8);
  }
  const net = box(world, [0.12, 1.5, 13.8], [x, 2.5, z], material(0xe5e5d6, 0.95, { transparent: true, opacity: 0.5 }), false);
  net.receiveShadow = false;
  for (let zOffset = -6.5; zOffset <= 6.5; zOffset += 0.65) {
    box(world, [0.02, 1.45, 0.025], [x + 0.08, 2.5, z + zOffset], mat.metalLight, false, false);
  }
}

function addParkFeatures() {
  addCommunityStage();
  for (const z of [82, 99, 116, 133]) {
    for (const x of [-36, -18, 0, 18, 36]) addPicnicTable(x, z);
  }

  const columns = [-50, -37, -24, -11, 11, 24, 37, 50];
  const rows = [-88, -66, -44, -22, 0, 22, 44, 66, 148, 166, 190];
  const treeSpots = [];
  rows.forEach((z, rowIndex) => {
    columns.forEach((x, columnIndex) => {
      const nearSpawn = Math.hypot(x + 12, z) < 17;
      const insideStage = z >= 155 && Math.abs(x) < 30;
      const onMainAisle = Math.abs(x) < 16;
      const offsetX = (rowIndex + columnIndex) % 2 === 0 ? -1.5 : 1.5;
      if (!nearSpawn && !insideStage && !onMainAisle) treeSpots.push([x + offsetX, z]);
    });
  });
  addForest(treeSpots);
}

function addParkBoundary() {
  const fence = material(0x5d745c, 0.56);
  for (const x of [-57, 57]) {
    for (let z = -105; z <= 205; z += 13) {
      box(world, [0.18, 1.25, 0.18], [x, 0.63, z], fence);
    }
    box(world, [0.12, 0.1, 310], [x, 1.1, 50], fence, false);
  }
  for (const z of [-105, 205]) {
    for (let x = -57; x <= 57; x += 13) {
      box(world, [0.18, 1.25, 0.18], [x, 0.63, z], fence);
    }
    box(world, [114, 0.1, 0.12], [0, 1.1, z], fence, false);
  }
}

function makeFemaleCharacter(name, tint, isRemote) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const nameSeed = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const skinTones = [0xc99572, 0xb98261, 0xd7a17e, 0xc28b6b, 0xe0b28f];
  const skin = material(skinTones[nameSeed % skinTones.length], 0.74);
  const hair = material(0x211916, 0.76, { side: THREE.DoubleSide });
  const blouse = material(isRemote ? tint : 0x164fe0, 0.58);
  const blouseTrim = material(0xf0c675, 0.48, { metalness: 0.28 });
  const sleeveFabric = material(0x745080, 0.72, { transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  const sleeveEmbroidery = material(0xd4a9bd, 0.62, { metalness: 0.12 });
  const trousers = material(0x21439c, 0.82);
  const shoe = material(0xb7966c, 0.72);
  const sole = material(0x3c3932, 0.82);
  const gold = material(0xd5ad61, 0.36, { metalness: 0.68 });
  const eyeWhite = material(0xf1e8dc, 0.55);
  const iris = material(0x39271d, 0.38);
  const pupil = material(0x171311, 0.3);
  const brow = material(0x382820, 0.86);
  const eyeliner = material(0x38251f, 0.76);
  const lip = material(0x965b53, 0.72);
  const bindi = material(0x9e3932, 0.5);

  const addEllipsoid = (parent, surface, position, scale, geometry = new THREE.SphereGeometry(1, 24, 18)) => {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const addCurve = (parent, points, radius, surface, segments = 20) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 8, false), surface);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const hips = addEllipsoid(body, trousers, [0, 0.87, 0], [0.34, 0.24, 0.26]);
  hips.castShadow = true;
  const blouseShape = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.72),
    new THREE.Vector2(0.27, 0.72),
    new THREE.Vector2(0.36, 0.79),
    new THREE.Vector2(0.4, 0.91),
    new THREE.Vector2(0.34, 1.08),
    new THREE.Vector2(0.31, 1.27),
    new THREE.Vector2(0.34, 1.48),
    new THREE.Vector2(0.4, 1.68),
    new THREE.Vector2(0.38, 1.8),
    new THREE.Vector2(0.27, 1.88),
    new THREE.Vector2(0, 1.89),
  ], 40);
  const blouseMesh = new THREE.Mesh(blouseShape, blouse);
  blouseMesh.castShadow = true;
  blouseMesh.receiveShadow = true;
  body.add(blouseMesh);

  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.014, 8, 48), blouseTrim);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.77;
  body.add(hem);
  addCurve(body, [
    [-0.29, 1.82, 0.2],
    [-0.28, 1.68, 0.28],
    [-0.2, 1.61, 0.33],
    [0, 1.59, 0.35],
    [0.2, 1.61, 0.33],
    [0.28, 1.68, 0.28],
    [0.29, 1.82, 0.2],
  ], 0.018, blouseTrim, 32);
  for (let button = 0; button < 3; button += 1) {
    addEllipsoid(body, blouseTrim, [0, 1.68 - button * 0.085, 0.382 - button * 0.004], [0.012, 0.012, 0.006]);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.13, 0.32, 24), skin);
  neck.position.set(0, 1.99, 0);
  neck.castShadow = true;
  body.add(neck);
  const headGroup = new THREE.Group();
  headGroup.position.y = 2.36;
  headGroup.scale.setScalar(1.18);
  body.add(headGroup);

  const head = addEllipsoid(headGroup, skin, [0, 0, 0], [0.285, 0.35, 0.27], new THREE.SphereGeometry(1, 40, 32));
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.305, 48, 32, 0, Math.PI * 2, 0, 1.58), hair);
  hairCap.position.set(0, 0.035, -0.035);
  hairCap.scale.set(1.02, 1.08, 0.88);
  hairCap.castShadow = true;
  headGroup.add(hairCap);
  const hairRows = [
    { y: 0.27, width: 0.12, depth: 0.13, sideZ: -0.07 },
    { y: 0.2, width: 0.2, depth: 0.17, sideZ: -0.1 },
    { y: 0.04, width: 0.27, depth: 0.22, sideZ: -0.08 },
    { y: -0.16, width: 0.29, depth: 0.26, sideZ: -0.045 },
    { y: -0.4, width: 0.29, depth: 0.07, sideZ: -0.32 },
    { y: -0.64, width: 0.26, depth: 0.045, sideZ: -0.36 },
    { y: -0.82, width: 0.17, depth: 0.03, sideZ: -0.38 },
    { y: -0.96, width: 0.08, depth: 0.018, sideZ: -0.38 },
    { y: -1.02, width: 0.012, depth: 0.008, sideZ: -0.37 },
  ];
  const hairSegments = 24;
  const hairVertices = [];
  const hairIndices = [];
  for (const row of hairRows) {
    for (let segment = 0; segment <= hairSegments; segment += 1) {
      const angle = (segment / hairSegments - 0.5) * Math.PI;
      hairVertices.push(
        Math.sin(angle) * row.width,
        row.y,
        row.sideZ - Math.cos(angle) * row.depth,
      );
    }
  }
  for (let row = 0; row < hairRows.length - 1; row += 1) {
    for (let segment = 0; segment < hairSegments; segment += 1) {
      const topLeft = row * (hairSegments + 1) + segment;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + hairSegments + 1;
      const bottomRight = bottomLeft + 1;
      hairIndices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
    }
  }
  const backHairGeometry = new THREE.BufferGeometry();
  backHairGeometry.setAttribute("position", new THREE.Float32BufferAttribute(hairVertices, 3));
  backHairGeometry.setIndex(hairIndices);
  backHairGeometry.computeVertexNormals();
  const backHair = new THREE.Mesh(backHairGeometry, hair);
  backHair.castShadow = true;
  backHair.receiveShadow = true;
  headGroup.add(backHair);

  for (const side of [-1, 1]) {
    const eyeX = side * 0.092;
    addEllipsoid(headGroup, eyeWhite, [eyeX, 0.055, 0.242], [0.042, 0.027, 0.018]).castShadow = false;
    addEllipsoid(headGroup, iris, [eyeX + side * 0.003, 0.054, 0.257], [0.018, 0.02, 0.009]).castShadow = false;
    addEllipsoid(headGroup, pupil, [eyeX + side * 0.003, 0.054, 0.264], [0.009, 0.013, 0.005]).castShadow = false;
    addEllipsoid(headGroup, eyeWhite, [eyeX + side * 0.008, 0.062, 0.268], [0.004, 0.004, 0.002]).castShadow = false;
    addCurve(headGroup, [
      [eyeX - 0.048, 0.09, 0.245],
      [eyeX, 0.109, 0.26],
      [eyeX + 0.046, 0.087, 0.244],
    ], 0.006, eyeliner, 10);
    addCurve(headGroup, [
      [eyeX - 0.046, 0.13, 0.231],
      [eyeX, 0.144, 0.248],
      [eyeX + 0.046, 0.13, 0.231],
    ], 0.009, brow, 10);
    addEllipsoid(headGroup, skin, [side * 0.258, -0.005, -0.006], [0.046, 0.066, 0.035]);
    const earring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 16), gold);
    earring.position.set(side * 0.282, -0.105, 0.015);
    headGroup.add(earring);
    const earringDrop = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.075, 12), gold);
    earringDrop.position.set(side * 0.282, -0.16, 0.015);
    earringDrop.rotation.x = Math.PI;
    headGroup.add(earringDrop);
    addEllipsoid(headGroup, blouseTrim, [side * 0.282, -0.19, 0.015], [0.034, 0.012, 0.034]);
  }
  addEllipsoid(headGroup, skin, [0, 0.005, 0.267], [0.021, 0.057, 0.022]);
  addEllipsoid(headGroup, skin, [0, -0.034, 0.282], [0.028, 0.019, 0.02]);
  addEllipsoid(headGroup, bindi, [0, 0.159, 0.237], [0.014, 0.018, 0.008]);
  const smile = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material(0x542a2c, 0.8));
  smile.position.set(0, -0.108, 0.25);
  smile.scale.set(0.054, 0.027, 0.012);
  headGroup.add(smile);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.069, 0.018, 0.009), eyeWhite);
  teeth.position.set(0, -0.098, 0.263);
  teeth.scale.set(0.78, 1, 1);
  headGroup.add(teeth);
  addCurve(headGroup, [
    [-0.047, -0.105, 0.245],
    [-0.023, -0.116, 0.264],
    [0, -0.118, 0.267],
    [0.023, -0.116, 0.264],
    [0.047, -0.105, 0.245],
  ], 0.008, lip, 16);
  addCurve(body, [
    [-0.21, 1.9, 0.15],
    [-0.19, 1.76, 0.25],
    [-0.12, 1.67, 0.31],
    [0, 1.64, 0.34],
    [0.12, 1.67, 0.31],
    [0.19, 1.76, 0.25],
    [0.21, 1.9, 0.15],
  ], 0.014, gold, 28);
  addCurve(body, [
    [-0.16, 1.9, 0.18],
    [-0.14, 1.79, 0.28],
    [-0.08, 1.72, 0.33],
    [0, 1.7, 0.35],
    [0.08, 1.72, 0.33],
    [0.14, 1.79, 0.28],
    [0.16, 1.9, 0.18],
  ], 0.008, blouseTrim, 24);
  const pendant = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), gold);
  pendant.position.set(0, 1.63, 0.35);
  body.add(pendant);

  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.37, 1.69, 0);
    armPivot.rotation.z = side * 0.08;
    const puffSleeve = addEllipsoid(armPivot, blouse, [0, -0.105, 0], [0.16, 0.19, 0.15]);
    puffSleeve.castShadow = true;
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.132, 0.23, 5, 14), blouse);
    sleeve.position.y = -0.2;
    sleeve.castShadow = true;
    armPivot.add(sleeve);
    const embroideredSection = new THREE.Mesh(
      new THREE.CylinderGeometry(0.128, 0.119, 0.16, 24, 1, true),
      sleeveFabric,
    );
    embroideredSection.position.y = -0.31;
    armPivot.add(embroideredSection);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.014, 8, 24), blouseTrim);
    cuff.position.y = -0.4;
    cuff.rotation.x = Math.PI / 2;
    armPivot.add(cuff);
    for (let motif = 0; motif < 12; motif += 1) {
      const angle = motif * Math.PI / 6;
      const embroidery = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0), sleeveEmbroidery);
      embroidery.position.set(Math.sin(angle) * 0.123, -0.32, Math.cos(angle) * 0.123);
      embroidery.scale.set(0.8, 1.4, 0.6);
      armPivot.add(embroidery);
    }
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.22, 5, 12), skin);
    forearm.position.y = -0.51;
    forearm.castShadow = true;
    armPivot.add(forearm);
    const hand = new THREE.Group();
    hand.position.set(0, -0.7, 0.015);
    armPivot.add(hand);
    addEllipsoid(hand, skin, [0, -0.018, 0], [0.075, 0.085, 0.045]);
    for (let finger = 0; finger < 4; finger += 1) {
      const fingerX = (finger - 1.5) * 0.034;
      const fingerLength = [0.064, 0.083, 0.078, 0.061][finger];
      const fingerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, fingerLength, 4, 8), skin);
      fingerMesh.position.set(fingerX, -0.086 - fingerLength * 0.35, 0.012);
      fingerMesh.rotation.z = -fingerX * 1.8;
      fingerMesh.castShadow = true;
      hand.add(fingerMesh);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.055, 4, 8), skin);
    thumb.position.set(side * 0.073, -0.01, 0.018);
    thumb.rotation.z = side * 0.72;
    thumb.rotation.x = -0.2;
    thumb.castShadow = true;
    hand.add(thumb);
    for (let bracelet = 0; bracelet < 3; bracelet += 1) {
      const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.082, bracelet === 1 ? 0.012 : 0.007, 8, 20), gold);
      bangle.position.y = -0.59 - bracelet * 0.035;
      bangle.rotation.x = Math.PI / 2;
      armPivot.add(bangle);
    }
    body.add(armPivot);
    arms.push({ pivot: armPivot, side });

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.18, 0.88, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.31, 5, 14), trousers);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    legPivot.add(thigh);
    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.44;
    legPivot.add(kneePivot);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), trousers);
    knee.position.y = 0.012;
    knee.castShadow = true;
    kneePivot.add(knee);
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.3, 5, 14), trousers);
    calf.position.y = -0.2;
    calf.castShadow = true;
    kneePivot.add(calf);
    const anklePivot = new THREE.Group();
    anklePivot.position.y = -0.42;
    kneePivot.add(anklePivot);
    const shoeMesh = addEllipsoid(anklePivot, shoe, [0, -0.015, 0.09], [0.145, 0.085, 0.23]);
    shoeMesh.castShadow = true;
    const shoeSole = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.04, 0.39), sole);
    shoeSole.position.set(0, -0.074, 0.09);
    anklePivot.add(shoeSole);
    const shoeStrap = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.025, 0.07), blouseTrim);
    shoeStrap.position.set(0, 0.005, 0.17);
    anklePivot.add(shoeStrap);
    body.add(legPivot);
    legs.push({ hip: legPivot, knee: kneePivot, ankle: anklePivot, side });
  }

  group.userData = { body, arms, legs, name, gender: "female", isRemote };
  if (!isRemote) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ color: 0xc5f16a, transparent: true, opacity: 0.12, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.015;
    group.add(marker);
  }
  return group;
}

function makeCharacter(name, gender, tint = 0x477765, isRemote = false) {
  if (gender === "female") return makeFemaleCharacter(name, tint, isRemote);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const nameSeed = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const skinTones = [0xc99572, 0xb98261, 0xd7a17e, 0xc28b6b, 0xe0b28f];
  const eyeColors = [0x493326, 0x30251e, 0x435b56, 0x4c3928];
  const shirt = material(new THREE.Color(isRemote ? tint : 0x1d70ae), 0.72);
  const pants = material(0x202a30, 0.78);
  const skin = material(skinTones[nameSeed % skinTones.length], 0.72);
  const hair = material(gender === "female" ? 0x211c19 : 0x30251e, 0.94);
  const seam = material(0xd0c8b2, 0.78);
  const shoeMaterial = material(0xe4e4dc, 0.58);
  const soleMaterial = material(0xaeb4b4, 0.82);
  const eyeWhite = material(0xe9e1d6, 0.52);
  const iris = material(eyeColors[nameSeed % eyeColors.length], 0.34);
  const pupil = material(0x171615, 0.25);
  const brow = material(gender === "female" ? 0x39271f : 0x30231d, 0.8);
  const mouth = material(0x815b50, 0.82);
  const innerEar = material(0x9b6552, 0.82);
  const shirtWidth = gender === "female" ? 0.69 : 0.77;
  const addEllipsoid = (parent, surface, position, scale, geometry = new THREE.SphereGeometry(1, 20, 14)) => {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const torsoShape = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.78),
    new THREE.Vector2(0.19, 0.79),
    new THREE.Vector2(0.27, 0.86),
    new THREE.Vector2(0.29, 1.02),
    new THREE.Vector2(0.28, 1.19),
    new THREE.Vector2(0.33, 1.39),
    new THREE.Vector2(0.38, 1.59),
    new THREE.Vector2(0.41, 1.72),
    new THREE.Vector2(0.36, 1.83),
    new THREE.Vector2(0.22, 1.88),
    new THREE.Vector2(0.14, 1.84),
    new THREE.Vector2(0, 1.84),
  ], 32);
  if (gender === "female") {
    const positions = torsoShape.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index) * 1.035;
      const y = positions.getY(index);
      const z = positions.getZ(index) * 1.035;
      const frontFacing = Math.max(0, z / Math.hypot(x, z));
      const chestHeight = Math.exp(-(((y - 1.48) / 0.16) ** 2));
      const leftBust = Math.exp(-(((x + 0.145) / 0.13) ** 2));
      const rightBust = Math.exp(-(((x - 0.145) / 0.13) ** 2));
      const bust = y > 1.27 && y < 1.68
        ? 0.045 * chestHeight * (leftBust + rightBust) * frontFacing
        : 0;
      positions.setXYZ(index, x, y, z + bust);
    }
    positions.needsUpdate = true;
  }
  torsoShape.computeVertexNormals();
  const torso = new THREE.Mesh(torsoShape, shirt);
  torso.castShadow = true;
  body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.135, 0.34, 20), skin);
  neck.position.set(0, 1.99, 0);
  neck.castShadow = true;
  body.add(neck);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 8, 24), seam);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.85;
  body.add(collar);

  const headGroup = new THREE.Group();
  headGroup.position.y = 2.36;
  headGroup.scale.setScalar(1.18);
  body.add(headGroup);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), pants);
  hips.scale.set(gender === "female" ? 0.34 : 0.31, 0.22, gender === "female" ? 0.25 : 0.235);
  hips.position.y = 0.88;
  hips.castShadow = true;
  body.add(hips);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 36, 28), skin);
  head.scale.set(0.9, 1.08, 0.88);
  head.castShadow = true;
  headGroup.add(head);
  if (gender === "male") {
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 36, 24, 0, Math.PI * 2, 0, 1.02), hair);
    hairCap.position.set(0, 0.035, -0.015);
    hairCap.scale.set(0.94, 0.98, 0.94);
    hairCap.castShadow = true;
    headGroup.add(hairCap);
  } else {
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 36, 24, 0, Math.PI * 2, 0, 1.08), hair);
    hairCap.position.set(0, 0.035, -0.015);
    hairCap.scale.set(0.98, 1, 0.96);
    hairCap.castShadow = true;
    headGroup.add(hairCap);

    const backHair = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), hair);
    backHair.position.set(0, -0.34, -0.13);
    backHair.scale.set(0.29, 0.57, 0.17);
    backHair.castShadow = true;
    headGroup.add(backHair);

    const hairHighlight = material(0x392820, 0.9);
    for (const strandX of [-0.17, -0.07, 0.07, 0.17]) {
      const strandPoints = [0.04, -0.2, -0.46, -0.7, -0.82].map((y) => {
        const x = strandX * (1 - Math.max(0, -y - 0.2) * 0.08);
        const insideHair = 1 - (x / 0.29) ** 2 - ((y + 0.34) / 0.57) ** 2;
        const z = -0.13 - 0.17 * Math.sqrt(Math.max(0.08, insideHair)) - 0.006;
        return new THREE.Vector3(x, y, z);
      });
      const strandCurve = new THREE.CatmullRomCurve3(strandPoints);
      const strand = new THREE.Mesh(new THREE.TubeGeometry(strandCurve, 20, 0.006, 5, false), hairHighlight);
      headGroup.add(strand);
    }

    for (const side of [-1, 1]) {
      const lockCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.22, 0.12, 0.16),
        new THREE.Vector3(side * 0.29, -0.06, 0.13),
        new THREE.Vector3(side * 0.29, -0.34, 0.12),
        new THREE.Vector3(side * 0.25, -0.62, 0.08),
        new THREE.Vector3(side * 0.21, -0.78, 0.04),
      ]);
      const lock = new THREE.Mesh(new THREE.TubeGeometry(lockCurve, 20, 0.045, 10, false), hair);
      lock.castShadow = true;
      headGroup.add(lock);
    }
  }

  for (const side of [-1, 1]) {
    const eyeX = side * 0.105;
    const eye = addEllipsoid(headGroup, eyeWhite, [eyeX, 0.065, 0.27], [0.042, 0.029, 0.018]);
    eye.castShadow = false;
    addEllipsoid(headGroup, iris, [eyeX + side * 0.005, 0.063, 0.284], [0.019, 0.021, 0.009]);
    addEllipsoid(headGroup, pupil, [eyeX + side * 0.005, 0.063, 0.291], [0.01, 0.014, 0.006]);
    addEllipsoid(headGroup, eyeWhite, [eyeX + side * 0.009, 0.071, 0.296], [0.004, 0.005, 0.003]);

    const browCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(eyeX - 0.045, 0.12, 0.266),
      new THREE.Vector3(eyeX, 0.13, 0.275),
      new THREE.Vector3(eyeX + 0.045, 0.12, 0.266),
    ]);
    const eyebrow = new THREE.Mesh(new THREE.TubeGeometry(browCurve, 8, 0.008, 6, false), brow);
    headGroup.add(eyebrow);

    const ear = addEllipsoid(headGroup, skin, [side * 0.294, -0.005, -0.005], [0.05, 0.071, 0.038]);
    ear.castShadow = true;
    addEllipsoid(headGroup, innerEar, [side * 0.311, -0.005, 0.028], [0.009, 0.031, 0.006]);
  }

  addEllipsoid(headGroup, skin, [0, -0.005, 0.288], [0.023, 0.061, 0.021]);
  addEllipsoid(headGroup, skin, [0, -0.046, 0.301], [0.031, 0.022, 0.025]);
  if (gender === "male") {
    const glassesFrame = material(0x172229, 0.42, { metalness: 0.3 });
    const glassesLens = material(0x29434b, 0.28, {
      metalness: 0.18,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    });
    const roundedPath = (path, width, height, radius, clockwise = false) => {
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      if (clockwise) {
        path.moveTo(-halfWidth + radius, -halfHeight);
        path.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth, -halfHeight + radius);
        path.lineTo(-halfWidth, halfHeight - radius);
        path.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth + radius, halfHeight);
        path.lineTo(halfWidth - radius, halfHeight);
        path.quadraticCurveTo(halfWidth, halfHeight, halfWidth, halfHeight - radius);
        path.lineTo(halfWidth, -halfHeight + radius);
        path.quadraticCurveTo(halfWidth, -halfHeight, halfWidth - radius, -halfHeight);
      } else {
        path.moveTo(-halfWidth + radius, -halfHeight);
        path.lineTo(halfWidth - radius, -halfHeight);
        path.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
        path.lineTo(halfWidth, halfHeight - radius);
        path.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
        path.lineTo(-halfWidth + radius, halfHeight);
        path.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
        path.lineTo(-halfWidth, -halfHeight + radius);
        path.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
      }
      path.closePath();
    };
    for (const side of [-1, 1]) {
      const lensX = side * 0.105;
      const frameCenterY = 0.065;
      const outerWidth = 0.195;
      const outerHeight = 0.145;
      const lensWidth = 0.165;
      const lensHeight = 0.115;
      const frameShape = new THREE.Shape();
      roundedPath(frameShape, outerWidth, outerHeight, 0.038);
      const frameOpening = new THREE.Path();
      roundedPath(frameOpening, lensWidth, lensHeight, 0.03, true);
      frameShape.holes.push(frameOpening);
      const frame = new THREE.Mesh(
        new THREE.ExtrudeGeometry(frameShape, { depth: 0.014, bevelEnabled: false, curveSegments: 8 }),
        glassesFrame,
      );
      frame.position.set(lensX, frameCenterY, 0.326);
      frame.castShadow = true;
      headGroup.add(frame);

      const lensShape = new THREE.Shape();
      roundedPath(lensShape, lensWidth, lensHeight, 0.03);
      const lens = new THREE.Mesh(new THREE.ShapeGeometry(lensShape, 8), glassesLens);
      lens.position.set(lensX, frameCenterY, 0.341);
      headGroup.add(lens);
      const templeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.202, frameCenterY, 0.329),
        new THREE.Vector3(side * 0.25, frameCenterY - 0.005, 0.255),
        new THREE.Vector3(side * 0.29, frameCenterY - 0.015, 0.15),
        new THREE.Vector3(side * 0.29, frameCenterY - 0.025, 0.035),
      ]);
      const temple = new THREE.Mesh(new THREE.TubeGeometry(templeCurve, 16, 0.009, 6, false), glassesFrame);
      temple.castShadow = true;
      headGroup.add(temple);
    }
    const glassesBridge = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.018), glassesFrame);
    glassesBridge.position.set(0, 0.065, 0.342);
    headGroup.add(glassesBridge);
  }
  const smileCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.055, -0.112, 0.279),
    new THREE.Vector3(-0.028, -0.121, 0.287),
    new THREE.Vector3(0, -0.123, 0.29),
    new THREE.Vector3(0.028, -0.121, 0.287),
    new THREE.Vector3(0.055, -0.112, 0.279),
  ]);
  headGroup.add(new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 16, 0.005, 6, false), mouth));

  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * (shirtWidth / 2 + 0.09), 1.69, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.52, 4, 10), shirt);
    arm.position.y = -0.34;
    arm.castShadow = true;
    armPivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), skin);
    hand.position.y = -0.72;
    armPivot.add(hand);
    for (let finger = 0; finger < 4; finger++) {
      const fingerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.075, 3, 6), skin);
      fingerMesh.position.set((finger - 1.5) * 0.045, -0.82, 0.025);
      fingerMesh.castShadow = true;
      armPivot.add(fingerMesh);
    }
    body.add(armPivot);
    arms.push({ pivot: armPivot, side });

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.18, 0.9, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.28, 5, 14), pants);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    legPivot.add(thigh);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.45;
    legPivot.add(kneePivot);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), pants);
    knee.position.y = 0.015;
    knee.scale.set(0.96, 1, 0.98);
    knee.castShadow = true;
    kneePivot.add(knee);

    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.108, 0.28, 5, 14), pants);
    calf.position.y = -0.2;
    calf.castShadow = true;
    kneePivot.add(calf);

    const anklePivot = new THREE.Group();
    anklePivot.position.y = -0.42;
    kneePivot.add(anklePivot);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), shoeMaterial);
    shoe.scale.set(0.15, 0.085, 0.24);
    shoe.position.set(0, -0.015, 0.09);
    shoe.castShadow = true;
    anklePivot.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.045, 0.4), soleMaterial);
    sole.position.set(0, -0.077, 0.1);
    anklePivot.add(sole);

    body.add(legPivot);
    legs.push({ hip: legPivot, knee: kneePivot, ankle: anklePivot, side });
  }

  group.userData = { body, arms, legs, name, gender, isRemote };
  if (!isRemote) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ color: 0xc5f16a, transparent: true, opacity: 0.12, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.015;
    group.add(marker);
  }
  return group;
}

function nameSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(12, 22, 20, .8)";
  context.beginPath();
  context.roundRect(24, 9, 464, 78, 20);
  context.fill();
  context.strokeStyle = "rgba(197, 241, 106, .52)";
  context.lineWidth = 2;
  context.stroke();
  context.font = "600 34px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f3f1e9";
  context.fillText(text.slice(0, 20), 256, 49, 420);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.2, 0.42, 1);
  sprite.position.y = 3.05;
  return sprite;
}

function addWorld() {
  addGround();
  addParkBoundary();
  addParkFeatures();
}

function showToast(message, duration = 2600) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), duration);
}

function updateProfileUI() {
  $("#profile-avatar").textContent = player.name.trim().charAt(0).toUpperCase() || "S";
  $("#name-input").value = player.name === "Explorer" ? "" : player.name;
  $("#profile-submit-label").textContent = profile ? "SAVE & RETURN" : "ENTER THE PARK";
  currentGender = player.gender;
  document.querySelectorAll(".gender-choice").forEach((button) => {
    button.classList.toggle("selected", button.dataset.gender === currentGender);
  });
}

function openProfile() {
  updateProfileUI();
  $("#profile-modal").classList.add("open");
  $("#name-input").focus();
}

function startWithProfile(nextProfile) {
  const normalizedName = nextProfile.name.trim().replace(/\s+/g, " ").slice(0, 20);
  if (normalizedName.length < 2) {
    $("#name-input").setCustomValidity("Please enter at least two characters.");
    $("#name-input").reportValidity();
    return;
  }
  $("#name-input").setCustomValidity("");
  saveProfile({ name: normalizedName, gender: nextProfile.gender });
  player.name = normalizedName;
  player.gender = nextProfile.gender;
  if (player.group) scene.remove(player.group);
  player.group = makeCharacter(player.name, player.gender, 0x4c766b);
  player.group.position.copy(player.position);
  player.model = player.group.userData;
  scene.add(player.group);
  updateProfileUI();
  $("#profile-modal").classList.remove("open");
  showToast(`Welcome to South Side Park, ${player.name}.`);
  if (network.connected) {
    sendNetwork({ type: "profile", name: player.name, gender: player.gender });
  } else {
    connectNetwork();
  }
}

function setGender(gender) {
  currentGender = gender;
  document.querySelectorAll(".gender-choice").forEach((button) => {
    button.classList.toggle("selected", button.dataset.gender === gender);
  });
}

function updateLocalTime() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const daylight = smoothstep(5.2, 6.5, hour) * (1 - smoothstep(17.5, 18.8, hour));
  const golden = Math.max(0, 1 - Math.abs(hour - 17.45) / 1.6);
  const isNight = daylight < 0.08;
  const dateText = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  $("#world-time").textContent = dateText;
  $("#world-weather").textContent = `${now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase()} · YOUR LOCAL TIME`;
  $("#time-period").textContent = isNight ? "NIGHT" : golden > 0.4 ? "GOLDEN HOUR" : "DAY";
  $("#time-icon").textContent = isNight ? "☾" : golden > 0.4 ? "◉" : "☀";
  $("#time-icon").style.color = isNight ? "#a5bbd7" : "#c5f16a";
  sunLight.intensity = THREE.MathUtils.lerp(0.035, 3.25, daylight);
  sunLight.color.set(daylight < 0.1 ? 0x8aa8d8 : golden > 0.25 ? 0xffc081 : 0xffedcd);
  sunLight.position.set(Math.cos((hour / 24) * Math.PI * 2) * 90, 18 + daylight * 95, Math.sin((hour / 24) * Math.PI * 2) * 70);
  hemiLight.intensity = THREE.MathUtils.lerp(0.24, 1.36, daylight);
  hemiLight.color.set(daylight < 0.1 ? 0x536b9a : 0xd8eaff);
  hemiLight.groundColor.set(daylight < 0.1 ? 0x202c42 : 0x485448);
  const skyColor = new THREE.Color().setRGB(
    THREE.MathUtils.lerp(0.025, 0.48, daylight),
    THREE.MathUtils.lerp(0.055, 0.68, daylight),
    THREE.MathUtils.lerp(0.13, 0.73, daylight),
  );
  scene.background = skyColor;
  scene.fog.color.copy(skyColor);
  scene.fog.near = THREE.MathUtils.lerp(42, 90, daylight);
  scene.fog.far = THREE.MathUtils.lerp(160, 260, daylight);
  lamps.forEach(({ light, shade }) => {
    light.intensity = THREE.MathUtils.lerp(3.6, 0, daylight);
    shade.emissiveIntensity = THREE.MathUtils.lerp(1.8, 0.05, daylight);
  });
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.92, 1.13, daylight);
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function connectNetwork() {
  if (network.socket || !profile || !["http:", "https:"].includes(location.protocol)) {
    return;
  }
  const configuredServer = new URLSearchParams(location.search).get("server") || window.SOUTH_SIDE_SERVER;
  let endpoint;
  try {
    if (configuredServer) {
      endpoint = new URL(configuredServer, location.href);
      if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
      if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
      if (!["ws:", "wss:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new TypeError("The multiplayer server must be an HTTP(S) or WS(S) URL without credentials.");
      }
      if (location.protocol === "https:" && endpoint.protocol !== "wss:") {
        throw new TypeError("Secure game pages require a secure WSS multiplayer server.");
      }
      const endpointPath = endpoint.pathname.replace(/\/+$/, "");
      endpoint.pathname = endpointPath.endsWith("/ws") ? endpointPath : `${endpointPath}/ws`;
      endpoint.hash = "";
    } else if (location.hostname === "github.io" || location.hostname.endsWith(".github.io")) {
      $("#network-state").className = "network-state offline";
      $("#network-state span:last-child").textContent = "SOLO MODE";
      return;
    } else {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      endpoint = new URL(`${protocol}//${location.host}/ws`);
    }
  } catch (error) {
    console.error("Could not configure the multiplayer server.", error);
    $("#network-state").className = "network-state offline";
    $("#network-state span:last-child").textContent = "SERVER URL ERROR";
    return;
  }
  $("#network-state").className = "network-state";
  $("#network-state span:last-child").textContent = "CONNECTING";
  let socket;
  try {
    socket = new WebSocket(endpoint);
  } catch (error) {
    console.error("Could not open the multiplayer connection.", error);
    scheduleNetworkReconnect();
    return;
  }
  network.socket = socket;
  socket.addEventListener("open", () => {
    network.connected = true;
    network.reconnectDelay = 1000;
    $("#network-state").className = "network-state online";
    $("#network-state span:last-child").textContent = "ONLINE";
    socket.send(JSON.stringify({ type: "hello", name: player.name, gender: player.gender, x: player.position.x, z: player.position.z }));
    updatePlayerCount();
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Ignored an invalid multiplayer message.", error);
      return;
    }
    handleNetworkMessage(message);
  });
  socket.addEventListener("close", () => {
    if (network.socket !== socket) return;
    network.connected = false;
    network.socket = null;
    network.id = null;
    $("#network-state").className = "network-state offline";
    $("#network-state span:last-child").textContent = "OFFLINE";
    clearRemotePlayers();
    updatePlayerCount();
    scheduleNetworkReconnect();
  });
  socket.addEventListener("error", () => {
    $("#network-state").className = "network-state offline";
    $("#network-state span:last-child").textContent = "OFFLINE";
  });
}

function scheduleNetworkReconnect() {
  if (network.reconnectTimer || !profile) return;
  const delay = network.reconnectDelay;
  network.reconnectDelay = Math.min(network.reconnectDelay * 2, 15000);
  network.reconnectTimer = window.setTimeout(() => {
    network.reconnectTimer = null;
    connectNetwork();
  }, delay);
}

function sendNetwork(message) {
  if (network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify(message));
  }
}

function handleNetworkMessage(message) {
  if (message.type === "welcome") {
    network.id = message.id;
    for (const peer of message.players || []) addRemotePlayer(peer, true);
  } else if (message.type === "join") {
    addRemotePlayer(message.player, false);
  } else if (message.type === "profile") {
    updateRemoteProfile(message.player);
  } else if (message.type === "move") {
    const remote = network.players.get(message.id);
    if (remote) {
      remote.target.set(message.x, 0, message.z);
      remote.name = message.name || remote.name;
    }
  } else if (message.type === "leave") {
    removeRemotePlayer(message.id);
  } else if (message.type === "chat") {
    appendChat(message.name, message.text, false);
  } else if (message.type === "signal") {
    receiveSignal(message.from, message.payload);
  }
}

function addRemotePlayer(data, isExisting) {
  if (!data || !data.id || data.id === network.id || network.players.has(data.id)) return;
  const colorChoices = [0x53736b, 0x806454, 0x68788d, 0x9b7055, 0x697a52];
  const tint = colorChoices[Math.abs([...data.id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colorChoices.length];
  const group = makeCharacter(data.name || "Neighbour", data.gender === "female" ? "female" : "male", tint, true);
  group.add(nameSprite(data.name || "Neighbour"));
  group.position.set(Number(data.x) || 0, 0, Number(data.z) || 0);
  scene.add(group);
  network.players.set(data.id, { group, target: group.position.clone(), name: data.name || "Neighbour" });
  ensurePeerConnection(data.id);
  updatePlayerCount();
  if (!isExisting) appendSystemMessage(`${data.name || "Someone"} joined the park.`);
}

function removeRemotePlayer(id) {
  const remote = network.players.get(id);
  if (remote) {
    scene.remove(remote.group);
    network.players.delete(id);
  }
  const peer = network.peers.get(id);
  if (peer) {
    peer.connection.close();
    peer.audio.remove();
    network.peers.delete(id);
  }
  updatePlayerCount();
}

function clearRemotePlayers() {
  for (const id of [...network.players.keys()]) removeRemotePlayer(id);
  for (const peer of network.peers.values()) {
    peer.connection.close();
    peer.audio.remove();
  }
  network.peers.clear();
}

function updatePlayerCount() {
  const count = network.players.size;
  $("#players-count").textContent = count === 0 ? "JUST YOU" : `${count + 1} HERE`;
}

function ensurePeerConnection(id) {
  if (network.peers.has(id) || !network.id) return;
  const connection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  const transceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.dataset.playerId = id;
  document.body.appendChild(audio);
  const peer = { connection, audio, sender: transceiver.sender, makingOffer: false };
  network.peers.set(id, peer);
  connection.ontrack = (event) => {
    audio.srcObject = event.streams[0] || new MediaStream([event.track]);
    audio.play().catch((error) => console.warn("Remote voice playback needs a user gesture.", error));
  };
  connection.onicecandidate = (event) => {
    if (event.candidate) sendNetwork({ type: "signal", to: id, payload: { candidate: event.candidate } });
  };
  connection.onnegotiationneeded = async () => {
    if (network.id.localeCompare(id) >= 0) return;
    try {
      peer.makingOffer = true;
      await connection.setLocalDescription();
      sendNetwork({ type: "signal", to: id, payload: { description: connection.localDescription } });
    } catch (error) {
      console.error("Could not create a voice connection offer.", error);
      showToast("Voice connection could not be started.");
    } finally {
      peer.makingOffer = false;
    }
  };
  const activeTrack = network.voiceStream?.getAudioTracks()[0];
  if (activeTrack) {
    transceiver.sender.replaceTrack(activeTrack).catch((error) => console.warn("Could not enable voice for a new player.", error));
  }
}

function updateRemoteProfile(data) {
  if (!data?.id) return;
  const remote = network.players.get(data.id);
  if (!remote) {
    addRemotePlayer(data, false);
    return;
  }
  scene.remove(remote.group);
  const colorChoices = [0x53736b, 0x806454, 0x68788d, 0x9b7055, 0x697a52];
  const tint = colorChoices[Math.abs([...data.id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colorChoices.length];
  const group = makeCharacter(data.name || "Neighbour", data.gender === "female" ? "female" : "male", tint, true);
  group.add(nameSprite(data.name || "Neighbour"));
  group.position.copy(remote.group.position);
  scene.add(group);
  remote.group = group;
  remote.name = data.name || "Neighbour";
}

async function receiveSignal(id, payload) {
  if (!id || !payload || !network.id) return;
  ensurePeerConnection(id);
  const peer = network.peers.get(id);
  if (!peer) return;
  try {
    if (payload.description) {
      await peer.connection.setRemoteDescription(payload.description);
      if (payload.description.type === "offer") {
        await peer.connection.setLocalDescription();
        sendNetwork({ type: "signal", to: id, payload: { description: peer.connection.localDescription } });
      }
    } else if (payload.candidate) {
      await peer.connection.addIceCandidate(payload.candidate);
    }
  } catch (error) {
    console.warn("Could not complete a voice connection.", error);
    showToast("Voice connection had a problem. Try toggling voice again.");
  }
}

async function toggleVoice() {
  if (network.voiceStream) {
    network.voiceStream.getTracks().forEach((track) => track.stop());
    network.voiceStream = null;
    for (const peer of network.peers.values()) peer.sender.replaceTrack(null).catch((error) => console.warn("Could not mute a voice track.", error));
    $("#voice-button").classList.remove("active");
    $("#voice-label").textContent = "VOICE";
    $("#voice-hint").textContent = "VOICE OFF";
    showToast("Voice chat turned off.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Voice needs localhost or an HTTPS connection.");
    return;
  }
  try {
    network.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    const track = network.voiceStream.getAudioTracks()[0];
    for (const id of network.players.keys()) {
      ensurePeerConnection(id);
      await network.peers.get(id)?.sender.replaceTrack(track);
    }
    $("#voice-button").classList.add("active");
    $("#voice-label").textContent = "LIVE";
    $("#voice-hint").textContent = "MIC ON · CLICK TO MUTE";
    showToast("Mic is on. Say hello to nearby players.");
  } catch (error) {
    console.error("Microphone access was not granted.", error);
    showToast(error.name === "NotAllowedError" ? "Microphone permission was denied." : "Couldn't start your microphone.");
  }
}

function appendSystemMessage(text) {
  const item = document.createElement("div");
  item.className = "chat-system";
  item.textContent = text;
  $("#chat-messages").append(item);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function appendChat(name, text, isSelf) {
  const item = document.createElement("div");
  item.className = "chat-message";
  const playerName = document.createElement("strong");
  playerName.textContent = isSelf ? "YOU" : name.toUpperCase();
  item.append(playerName, document.createTextNode(text));
  $("#chat-messages").append(item);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function setChatOpen(open) {
  chatOpen = open;
  $("#chat-panel").classList.toggle("open", open);
  if (open) $("#chat-input").focus();
}

function sendChat(text) {
  const clean = text.trim().slice(0, 160);
  if (!clean) return;
  appendChat(player.name, clean, true);
  sendNetwork({ type: "chat", text: clean });
  $("#chat-input").value = "";
}

function nearestPlace() {
  const places = [
    { x: 0, z: 180, radius: 30, name: "the South Side community stage" },
  ];
  const place = places.find((entry) => Math.hypot(entry.x - player.position.x, entry.z - player.position.z) < entry.radius);
  if (place) return `You’re at ${place.name}. Have fun and look out for one another.`;
  if (player.position.z > 76 && player.position.z < 140 && Math.abs(player.position.x) < 42) {
    return "Pull up a seat at one of the community tables and enjoy the show.";
  }
  if (Math.abs(player.position.x) > 40) return "Take a breather beneath the trees.";
  return "Explore the open lawns and find a place to relax.";
}

function updateLocation() {
  const x = player.position.x;
  const z = player.position.z;
  const label = z > 155 ? "COMMUNITY STAGE" : z > 76 && z < 140 ? "GATHERING SEATS" : Math.abs(x) > 40 ? "TREE GROVE" : "OPEN LAWN";
  if (label !== activeLabel) {
    activeLabel = label;
    $("#world-label-text").textContent = label;
  }
}

function updateMovement(delta) {
  if (!player.group) return;
  const forward = keyState.has("KeyW") || keyState.has("ArrowUp");
  const backward = keyState.has("KeyS") || keyState.has("ArrowDown");
  const left = keyState.has("KeyA") || keyState.has("ArrowLeft");
  const right = keyState.has("KeyD") || keyState.has("ArrowRight");
  const inputZ = Number(forward) - Number(backward);
  const inputX = Number(right) - Number(left);
  const hasInput = inputX !== 0 || inputZ !== 0;
  const sprinting = hasInput && (keyState.has("ShiftLeft") || keyState.has("ShiftRight")) && player.stamina > 1;
  const speed = sprinting ? 9.5 : 5.1;
  player.moving = hasInput;
  if (hasInput) {
    const magnitude = Math.hypot(inputX, inputZ) || 1;
    const localX = inputX / magnitude;
    const localZ = inputZ / magnitude;
    const moveX = -localX * Math.cos(cameraYaw) + localZ * Math.sin(cameraYaw);
    const moveZ = localZ * Math.cos(cameraYaw) + localX * Math.sin(cameraYaw);
    player.position.x += moveX * speed * delta;
    player.position.z += moveZ * speed * delta;
    player.group.rotation.y = Math.atan2(moveX, moveZ);
    const cadence = player.walkingTime * (sprinting ? 13 : 9);
    player.model.legs.forEach(({ hip, knee, ankle, side }) => {
      const phase = cadence + (side === 1 ? Math.PI : 0);
      const stride = Math.sin(phase);
      const kneeFlex = Math.max(0, Math.cos(phase)) * (sprinting ? 0.8 : 0.58);
      hip.rotation.x = stride * (sprinting ? 0.58 : 0.4);
      knee.rotation.x = kneeFlex;
      ankle.rotation.x = -hip.rotation.x * 0.3 - kneeFlex * 0.25;
    });
    player.model.arms.forEach(({ pivot, side }) => {
      const phase = cadence + (side === 1 ? Math.PI : 0);
      pivot.rotation.x = -Math.sin(phase) * (sprinting ? 0.4 : 0.28);
    });
    player.walkingTime += delta;
    player.stamina = Math.max(0, player.stamina - delta * (sprinting ? 13 : 1.8));
  } else {
    player.model.legs.forEach(({ hip, knee, ankle }) => {
      hip.rotation.x = THREE.MathUtils.damp(hip.rotation.x, 0, 8, delta);
      knee.rotation.x = THREE.MathUtils.damp(knee.rotation.x, 0, 8, delta);
      ankle.rotation.x = THREE.MathUtils.damp(ankle.rotation.x, 0, 8, delta);
    });
    player.model.arms.forEach(({ pivot }) => {
      pivot.rotation.x = THREE.MathUtils.damp(pivot.rotation.x, 0, 8, delta);
    });
    player.stamina = Math.min(100, player.stamina + delta * 7);
  }
  if (keyState.has("Space") && player.position.y === 0) {
    player.velocityY = 5.9;
    keyState.delete("Space");
  }
  player.velocityY -= 13.5 * delta;
  player.position.y = Math.max(0, player.position.y + player.velocityY * delta);
  if (player.position.y === 0) player.velocityY = 0;
  player.position.x = THREE.MathUtils.clamp(player.position.x, -55, 55);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -100, 200);
  player.group.position.copy(player.position);
  $("#stamina-fill").style.width = `${player.stamina}%`;
  $("#stamina-label").textContent = `${Math.round(player.stamina)}%`;
  updateLocation();
}

function updateCamera(delta) {
  if (!player.group) return;
  const distance = 10.2;
  const target = new THREE.Vector3(player.position.x, player.position.y + 2.35, player.position.z);
  const pitch = THREE.MathUtils.clamp(cameraPitch, -0.2, 0.8);
  const horizontalDistance = distance * Math.cos(pitch);
  const desired = new THREE.Vector3(
    target.x - Math.sin(cameraYaw) * horizontalDistance,
    target.y + distance * Math.sin(pitch) + 1.6,
    target.z - Math.cos(cameraYaw) * horizontalDistance,
  );
  camera.position.lerp(desired, 1 - Math.exp(-7 * delta));
  camera.lookAt(target);
}

let lastNetworkUpdate = 0;
let lastTimeUpdate = 0;
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.045);
  const elapsed = clock.elapsedTime;
  updateMovement(delta);
  updateCamera(delta);
  for (const remote of network.players.values()) {
    remote.group.position.lerp(remote.target, 1 - Math.exp(-9 * delta));
  }
  if (elapsed - lastNetworkUpdate > 0.12 && network.connected) {
    sendNetwork({ type: "move", x: player.position.x, z: player.position.z, name: player.name });
    lastNetworkUpdate = elapsed;
  }
  if (elapsed - lastTimeUpdate > 15) {
    updateLocalTime();
    lastTimeUpdate = elapsed;
  }
  renderer.render(scene, camera);
}

function initUI() {
  if (profile) {
    player.name = profile.name;
    player.gender = profile.gender;
    player.group = makeCharacter(player.name, player.gender, 0x4c766b);
    player.model = player.group.userData;
    player.group.position.copy(player.position);
    scene.add(player.group);
    updateProfileUI();
    connectNetwork();
    window.setTimeout(() => $("#profile-modal").classList.remove("open"), 900);
  } else {
    openProfile();
  }
  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    startWithProfile({ name: $("#name-input").value, gender: currentGender });
  });
  document.querySelectorAll(".gender-choice").forEach((button) => {
    button.addEventListener("click", () => setGender(button.dataset.gender));
  });
  $("#profile-button").addEventListener("click", openProfile);
  $("#modal-close").addEventListener("click", () => {
    if (profile) $("#profile-modal").classList.remove("open");
  });
  $("#chat-button").addEventListener("click", () => setChatOpen(!chatOpen));
  $("#social-button").addEventListener("click", () => {
    setChatOpen(true);
    showToast(network.players.size ? `${network.players.size} other player${network.players.size === 1 ? "" : "s"} in the park.` : "You’ve got the park to yourself.");
  });
  $("#close-chat").addEventListener("click", () => setChatOpen(false));
  $("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat($("#chat-input").value);
  });
  $("#voice-button").addEventListener("click", toggleVoice);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Enter" && !event.target.matches("input")) {
      event.preventDefault();
      setChatOpen(!chatOpen);
      return;
    }
    if (event.code === "Escape" && chatOpen) {
      setChatOpen(false);
      return;
    }
    if (event.code === "KeyE" && !event.repeat && !$("#profile-modal").classList.contains("open")) {
      showToast(nearestPlace());
      return;
    }
    if (movementKeys.has(event.code) && !event.target.matches("input")) {
      event.preventDefault();
      keyState.add(event.code);
    }
  });
  window.addEventListener("keyup", (event) => keyState.delete(event.code));
  window.addEventListener("blur", () => keyState.clear());
  renderer.domElement.addEventListener("click", () => {
    if (profile && !$("#profile-modal").classList.contains("open") && document.pointerLockElement !== renderer.domElement && window.innerWidth > 760) {
      renderer.domElement.requestPointerLock?.();
    }
  });
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === renderer.domElement) {
      cameraYaw -= event.movementX * 0.0026;
      cameraPitch = THREE.MathUtils.clamp(cameraPitch + event.movementY * 0.0018, -0.16, 0.75);
    }
  });
  document.querySelectorAll("[data-move]").forEach((button) => {
    const moveKey = button.dataset.move;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      keyState.add(moveKey);
      button.setPointerCapture(event.pointerId);
    });
    const stop = () => keyState.delete(moveKey);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
  });
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  });
}

addWorld();
updateLocalTime();
initUI();
window.setTimeout(() => $("#loading").classList.add("done"), 450);
window.setInterval(() => {
  updateLocalTime();
}, 15000);
animate();
