import * as THREE from "three";
import { RoundedBoxGeometry } from "/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js";
import * as CANNON from "/node_modules/cannon-es/dist/cannon-es.js";

const PIECES_KEY = "board-free-piece-positions-v1";
const CELL_MASK_SRC = "assets/board-cell-mask.png";

let cells = [];
let cellInfo = [];
let cellMask = null;
let selectedCellIndex = -1;
let hoveredCellIndex = -1;
let exitingCellIndex = -1;
let hoverAnimationFrame = null;
let lastHoverFrameTime = 0;
let hoverAnimationStartTime = 0;
let hoverAnimationExitTime = 0;
let magnifiedCellCache = null;
let outlineCellCache = null;

const pieces = [
  { label: "1", color: "#d64545", start: { x: 8, y: 72 } },
  { label: "2", color: "#2878d7", start: { x: 11, y: 72 } },
  { label: "3", color: "#2f9e44", start: { x: 14, y: 72 } },
  { label: "4", color: "#7b3fc4", start: { x: 17, y: 72 } },
  { label: "5", color: "#e09f1f", start: { x: 20, y: 72 } },
];

const stage = document.querySelector("#boardStage");
const boardMap = document.querySelector(".board-map");
const cellLayer = document.querySelector("#cellLayer");
const cellContext = cellLayer.getContext("2d");
const pieceLayer = document.querySelector("#pieceLayer");
const cellModal = document.querySelector("#cellModal");
const cellModalTitle = document.querySelector("#cellModalTitle");
const cellModalText = document.querySelector("#cellModalText");
const closeCellModal = document.querySelector("#closeCellModal");
const previousCell = document.querySelector("#previousCell");
const nextCell = document.querySelector("#nextCell");
const playerBadges = document.querySelectorAll(".board-player-badge[data-player-id]");
const boardRollButton = document.querySelector("#boardRollButton");
const boardDoubleDiceButton = document.querySelector("#boardDoubleDiceButton");
const mapDiceLayer = document.querySelector("#mapDiceLayer");
const diceModal = document.querySelector("#diceModal");
const diceModalCard = document.querySelector("#diceModalCard");
const diceDragHandle = document.querySelector("#diceDragHandle");
const diceScene = document.querySelector(".dice-scene");
const diceCube = document.querySelector("#diceCube");
const diceResult = document.querySelector("#diceResult");
const diceBreakdown = document.querySelector("#diceBreakdown");
const closeDiceModal = document.querySelector("#closeDiceModal");
const doubleDiceToggle = document.querySelector("#doubleDiceToggle");
const doubleDiceControl = doubleDiceToggle.closest(".dice-double-toggle");

let positions = loadPositions();
let activePiece = null;
let diceWindowPosition = { x: 0, y: 0 };
let diceWindowScale = 1;
let diceDragState = null;
let dicePhysics = null;
let diceRolling = false;
let diceHolding = false;
let dicePointerId = null;
let diceRollStartedAt = 0;
let diceSettledAt = 0;
let lastDiceFrameTime = performance.now();

function loadPositions() {
  const saved = localStorage.getItem(PIECES_KEY);
  if (!saved) return pieces.map((piece) => ({ ...piece.start }));

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length !== pieces.length) {
      return pieces.map((piece) => ({ ...piece.start }));
    }

    return parsed.map((position, index) => {
      const fallback = pieces[index].start;
      const x = Number(position?.x);
      const y = Number(position?.y);

      return Number.isFinite(x) && Number.isFinite(y)
        ? { x: clamp(x, 2, 98), y: clamp(y, 4, 96) }
        : { ...fallback };
    });
  } catch {
    return pieces.map((piece) => ({ ...piece.start }));
  }
}

function savePositions() {
  localStorage.setItem(PIECES_KEY, JSON.stringify(positions));
}

async function loadPlayerBalances() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    const playersById = new Map(state.players.map((player) => [player.id, player]));
    const catalog = [...state.shopItems, ...state.prizes];

    playerBadges.forEach((badge) => {
      const player = playersById.get(badge.dataset.playerId);
      const gold = badge.querySelector(".board-player-gold");
      if (player && gold) gold.textContent = Number(player.balance || 0).toLocaleString("ru-RU");
      if (player) {
        renderBoardPlayerInventory(badge, player.inventory, catalog);
      }
    });
  } catch (error) {
    console.error("Не удалось загрузить балансы игроков", error);
  }
}

function renderBoardPlayerInventory(badge, inventory, catalog) {
  const inventoryNode = badge.querySelector(".board-player-inventory");
  if (!inventoryNode) return;

  inventoryNode.replaceChildren();
  for (let index = 0; index < 6; index += 1) {
    const itemName = inventory[index];
    const slot = document.createElement("span");
    slot.className = "board-player-inventory-slot";

    if (itemName) {
      const item = catalog.find((catalogItem) => catalogItem.name === itemName);
      slot.classList.add("filled");
      slot.title = itemName;

      if (item?.image) {
        const image = document.createElement("img");
        image.src = item.image;
        image.alt = "";
        slot.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "board-player-inventory-fallback";
        fallback.textContent = itemName.trim().charAt(0) || "?";
        slot.append(fallback);
      }
    } else {
      slot.setAttribute("aria-hidden", "true");
    }

    inventoryNode.append(slot);
  }
}

function openDiceModal() {
  closeMapDiceMode();
  restoreDiceSceneToModal();
  diceModal.hidden = false;
  updateDiceWindowScale();
  setDiceWindowPosition(diceWindowPosition.x, diceWindowPosition.y);
  initializeDicePhysics();
  setDiceSceneFloorMode("modal");
  resetDiceForMode();
  resizeDiceRenderer();
  diceResult.classList.remove("rolling");
  diceResult.textContent = "";
  diceBreakdown.classList.remove("show");
  diceBreakdown.textContent = "";
}

function restoreDiceSceneToModal() {
  if (diceScene.parentElement !== diceModalCard) {
    diceModalCard.insertBefore(diceScene, doubleDiceControl);
  }
}

function setDiceSceneFloorMode(mode) {
  if (!dicePhysics) return;
  dicePhysics.floor.material = mode === "map"
    ? dicePhysics.mapFloorMaterial
    : dicePhysics.modalFloorMaterial;
  dicePhysics.floor.material.needsUpdate = true;
}

function openMapDiceMode() {
  closeDiceWindow();
  mapDiceLayer.hidden = false;
  boardRollButton.setAttribute("aria-pressed", "true");
  mapDiceLayer.appendChild(diceScene);
  initializeDicePhysics();
  setDiceSceneFloorMode("map");
  resetDiceForMode();
  resizeDiceRenderer();
}

function closeMapDiceMode() {
  if (!mapDiceLayer.hidden) mapDiceLayer.hidden = true;
  boardRollButton.setAttribute("aria-pressed", "false");
  diceRolling = false;
  diceHolding = false;
  dicePointerId = null;
  diceCube.classList.remove("holding");
  if (dicePhysics) dicePhysics.dice.forEach(({ body }) => body.sleep());
}

function handleBoardRoll() {
  if (mapDiceLayer.hidden) openMapDiceMode();
  else closeMapDiceMode();
}

function setDoubleDiceMode(enabled) {
  doubleDiceToggle.checked = enabled;
  boardDoubleDiceButton.setAttribute("aria-pressed", String(enabled));
  if (dicePhysics) resetDiceForMode();
}

function closeDiceWindow() {
  diceModal.hidden = true;
  diceRolling = false;
  diceHolding = false;
  dicePointerId = null;
  dicePointerId = null;
  diceCube.classList.remove("holding");
  if (dicePhysics) dicePhysics.dice.forEach(({ body }) => body.sleep());
}

function getActiveDice() {
  if (!dicePhysics) return [];
  return doubleDiceToggle.checked ? dicePhysics.dice : dicePhysics.dice.slice(0, 1);
}

function resetDiceForMode() {
  initializeDicePhysics();
  const [firstDie, secondDie] = dicePhysics.dice;
  const doubleEnabled = doubleDiceToggle.checked;

  diceRolling = false;
  diceHolding = false;
  diceSettledAt = 0;
  diceResult.classList.remove("show");
  diceResult.textContent = "";
  diceBreakdown.classList.remove("show");
  diceBreakdown.textContent = "";
  diceCube.classList.remove("holding");

  firstDie.body.position.set(doubleEnabled ? -0.48 : 0, 0.315, 0);
  firstDie.body.quaternion.setFromEuler(0, 0.28, 0);
  firstDie.body.velocity.set(0, 0, 0);
  firstDie.body.angularVelocity.set(0, 0, 0);
  firstDie.body.wakeUp();

  if (doubleEnabled) {
    if (!dicePhysics.world.bodies.includes(secondDie.body)) dicePhysics.world.addBody(secondDie.body);
    secondDie.mesh.visible = true;
    secondDie.outline.visible = true;
    secondDie.body.position.set(0.48, 0.315, 0);
    secondDie.body.quaternion.setFromEuler(0, -0.28, 0);
    secondDie.body.velocity.set(0, 0, 0);
    secondDie.body.angularVelocity.set(0, 0, 0);
    secondDie.body.wakeUp();
  } else {
    if (dicePhysics.world.bodies.includes(secondDie.body)) dicePhysics.world.removeBody(secondDie.body);
    secondDie.mesh.visible = false;
    secondDie.outline.visible = false;
  }
}

function setDiceWindowPosition(x, y) {
  const margin = 8;
  const scaledWidth = diceModalCard.offsetWidth * diceWindowScale;
  const scaledHeight = diceModalCard.offsetHeight * diceWindowScale;
  const maxX = Math.max(0, (window.innerWidth - scaledWidth) / 2 - margin);
  const maxY = Math.max(0, (window.innerHeight - scaledHeight) / 2 - margin);
  diceWindowPosition = {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
  const left = (window.innerWidth - scaledWidth) / 2 + diceWindowPosition.x;
  const top = (window.innerHeight - scaledHeight) / 2 + diceWindowPosition.y;
  diceModalCard.style.setProperty("--dice-window-left", `${left}px`);
  diceModalCard.style.setProperty("--dice-window-top", `${top}px`);
}

function updateDiceWindowScale() {
  const margin = 16;
  const baseWidth = 620;
  const baseHeight = 600;
  const referenceViewportWidth = 1920;
  const referenceViewportHeight = 1080;
  const responsiveScale = Math.sqrt(
    (window.innerWidth / referenceViewportWidth)
    * (window.innerHeight / referenceViewportHeight),
  );
  const fitScale = Math.min(
    (window.innerWidth - margin) / baseWidth,
    (window.innerHeight - margin) / baseHeight,
  );
  diceWindowScale = Math.max(0.1, Math.min(responsiveScale, fitScale));
  diceModalCard.style.setProperty("--dice-window-scale", String(diceWindowScale));
}

function startDiceWindowDrag(event) {
  diceDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    windowX: diceWindowPosition.x,
    windowY: diceWindowPosition.y,
  };
  diceDragHandle.setPointerCapture(event.pointerId);
}

function dragDiceWindow(event) {
  if (!diceDragState || event.pointerId !== diceDragState.pointerId) return;
  setDiceWindowPosition(
    diceDragState.windowX + event.clientX - diceDragState.startX,
    diceDragState.windowY + event.clientY - diceDragState.startY,
  );
}

function stopDiceWindowDrag(event) {
  if (!diceDragState || event.pointerId !== diceDragState.pointerId) return;
  diceDragState = null;
}

function updateDiceMagnetTarget(event) {
  if (!dicePhysics) return;
  const rect = dicePhysics.renderer.domElement.getBoundingClientRect();
  const inset = mapDiceLayer.hidden ? 14 : 0;
  const clientX = Math.min(rect.right - inset, Math.max(rect.left + inset, event.clientX));
  const clientY = Math.min(rect.bottom - inset, Math.max(rect.top + inset, event.clientY));
  dicePhysics.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  dicePhysics.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  dicePhysics.raycaster.setFromCamera(dicePhysics.pointer, dicePhysics.camera);
  dicePhysics.raycaster.ray.intersectPlane(dicePhysics.dragPlane, dicePhysics.dragTarget);
}

function startDiceMagnet(event, captureElement = diceCube) {
  if (event.button !== undefined && event.button !== 0) return;
  initializeDicePhysics();
  event.preventDefault();
  dicePointerId = event.pointerId;
  diceHolding = true;
  diceRolling = false;
  diceSettledAt = 0;
  diceCube.classList.add("holding");
  captureElement.setPointerCapture(event.pointerId);
  updateDiceMagnetTarget(event);
  getActiveDice().forEach(({ body }) => body.wakeUp());
  diceResult.classList.remove("show");
  diceResult.textContent = "";
  diceBreakdown.classList.remove("show");
  diceBreakdown.textContent = "";
}

function isPointerOverMapDice(event) {
  if (!dicePhysics || mapDiceLayer.hidden) return false;
  const rect = dicePhysics.renderer.domElement.getBoundingClientRect();
  dicePhysics.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  dicePhysics.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  dicePhysics.raycaster.setFromCamera(dicePhysics.pointer, dicePhysics.camera);
  const meshes = getActiveDice().map(({ mesh }) => mesh);
  return dicePhysics.raycaster.intersectObjects(meshes, false).length > 0;
}

function startMapDiceMagnet(event) {
  if (!isPointerOverMapDice(event)) return;
  event.stopPropagation();
  startDiceMagnet(event, stage);
}

function moveMapDiceMagnet(event) {
  if (mapDiceLayer.hidden || !diceHolding || event.pointerId !== dicePointerId) return;
  event.stopPropagation();
  moveDiceMagnet(event);
}

function releaseMapDiceMagnet(event) {
  if (mapDiceLayer.hidden || !diceHolding || event.pointerId !== dicePointerId) return;
  event.stopPropagation();
  releaseDiceMagnet(event);
}

function moveDiceMagnet(event) {
  if (!diceHolding || event.pointerId !== dicePointerId) return;
  event.preventDefault();
  updateDiceMagnetTarget(event);
}

function releaseDiceMagnet(event) {
  if (!diceHolding || event.pointerId !== dicePointerId) return;
  event.preventDefault();
  diceHolding = false;
  dicePointerId = null;
  diceCube.classList.remove("holding");

  const random = () => Math.random() - 0.5;
  getActiveDice().forEach(({ body }, index) => {
    body.velocity.x = body.velocity.x * 0.45 + random() * 1.5 + (index ? 0.45 : -0.45);
    body.velocity.y = -6 - Math.random() * 3;
    body.velocity.z = body.velocity.z * 0.45 + random() * 1.5;
    body.angularVelocity.x += random() * 12;
    body.angularVelocity.y += random() * 12;
    body.angularVelocity.z += random() * 12;
    body.wakeUp();
  });

  diceRolling = true;
  diceRollStartedAt = performance.now();
  diceSettledAt = 0;
  diceResult.textContent = "";
  diceBreakdown.classList.remove("show");
  diceBreakdown.textContent = "";
}

function initializeDicePhysics() {
  if (dicePhysics) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 12, 0);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  diceCube.replaceChildren(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffefff, 0x35203e, 1.75));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
  keyLight.position.set(-3, 10, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -18;
  keyLight.shadow.camera.right = 18;
  keyLight.shadow.camera.top = 18;
  keyLight.shadow.camera.bottom = -18;
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 45;
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.04;
  keyLight.shadow.radius = 7;
  keyLight.shadow.blurSamples = 16;
  scene.add(keyLight);

  const geometry = new RoundedBoxGeometry(0.62, 0.62, 0.62, 6, 0.09);
  const faceValues = [3, 4, 1, 6, 2, 5];
  const createDiceMaterials = (colors) => faceValues.map((value) => new THREE.MeshStandardMaterial({
    map: createDiceFaceTexture(value, colors),
    roughness: 0.48,
    metalness: 0.02,
  }));
  const primaryMaterials = createDiceMaterials(["#e39af2", "#ca72e2", "#ad55cc"]);
  const secondaryMaterials = createDiceMaterials(["#ff9ab8", "#ff5c8a", "#d83a6a"]);

  const floorGeometry = new THREE.PlaneGeometry(60, 20);
  floorGeometry.translate(0, 2, 0);
  const modalFloorMaterial = new THREE.MeshStandardMaterial({
    color: 0x94836b,
    roughness: 0.92,
    metalness: 0,
    alphaMap: createFloorFadeTexture(),
    transparent: true,
  });
  const mapFloorMaterial = new THREE.ShadowMaterial({
    color: 0x150b1c,
    opacity: 0.48,
  });
  const floor = new THREE.Mesh(floorGeometry, modalFloorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.rotation.z = 0.46;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
  world.allowSleep = true;
  world.solver.iterations = 12;
  const floorMaterial = new CANNON.Material("dice-floor");
  const diceMaterial = new CANNON.Material("dice-body");
  world.addContactMaterial(new CANNON.ContactMaterial(floorMaterial, diceMaterial, {
    friction: 0.34,
    restitution: 0.43,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
    friction: 0.24,
    restitution: 0.32,
  }));

  const floorBody = new CANNON.Body({ mass: 0, material: floorMaterial });
  floorBody.addShape(new CANNON.Plane());
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);

  const createDie = (x, rotation, dieMaterials, outlineColor) => {
    const mesh = new THREE.Mesh(geometry, dieMaterials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const outline = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide }),
    );
    outline.scale.setScalar(1.025);
    scene.add(outline);

    const body = new CANNON.Body({
      mass: 1,
      material: diceMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(0.31, 0.31, 0.31)),
      sleepSpeedLimit: 0.16,
      sleepTimeLimit: 0.45,
      linearDamping: 0.24,
      angularDamping: 0.2,
    });
    body.position.set(x, 0.315, 0);
    body.quaternion.setFromEuler(...rotation);
    return { mesh, outline, body };
  };

  const firstDie = createDie(0, [0, 0.28, 0], primaryMaterials, 0x6e3d68);
  const secondDie = createDie(0.48, [0, -0.28, 0], secondaryMaterials, 0x7e2948);
  secondDie.mesh.visible = false;
  secondDie.outline.visible = false;
  world.addBody(firstDie.body);

  dicePhysics = {
    scene,
    camera,
    renderer,
    world,
    floor,
    modalFloorMaterial,
    mapFloorMaterial,
    dice: [firstDie, secondDie],
    pointer: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),
    dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.8),
    dragTarget: new THREE.Vector3(0, 2.8, 0),
    boundaryBodies: [],
  };
  resizeDiceRenderer();
  requestAnimationFrame(animatePhysicalDice);
}

function createDiceFaceTexture(value, colors = ["#e39af2", "#ca72e2", "#ad55cc"]) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(20, 10, 236, 246);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.5, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const positions = {
    1: [[128, 128]],
    2: [[72, 72], [184, 184]],
    3: [[68, 68], [128, 128], [188, 188]],
    4: [[72, 72], [184, 72], [72, 184], [184, 184]],
    5: [[68, 68], [188, 68], [128, 128], [68, 188], [188, 188]],
    6: [[72, 58], [184, 58], [72, 128], [184, 128], [72, 198], [184, 198]],
  };
  context.fillStyle = "#fff";
  positions[value].forEach(([x, y]) => {
    context.beginPath();
    context.arc(x, y, value === 1 ? 23 : 18, 0, Math.PI * 2);
    context.fill();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createFloorFadeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#000");
  gradient.addColorStop(0.24, "#fff");
  gradient.addColorStop(1, "#fff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function resizeDiceRenderer() {
  if (!dicePhysics) return;
  const width = Math.max(diceCube.clientWidth, 1);
  const height = Math.max(diceCube.clientHeight, 1);
  dicePhysics.camera.aspect = width / height;
  dicePhysics.camera.updateProjectionMatrix();
  dicePhysics.renderer.setSize(width, height, false);
  rebuildDicePhysicsBounds();
}

function rebuildDicePhysicsBounds() {
  if (!dicePhysics) return;
  const { world, camera } = dicePhysics;
  dicePhysics.boundaryBodies.forEach((body) => world.removeBody(body));
  dicePhysics.boundaryBodies = [];

  camera.updateMatrixWorld();
  const cameraPosition = new THREE.Vector3();
  const centerDirection = new THREE.Vector3();
  camera.getWorldPosition(cameraPosition);
  camera.getWorldDirection(centerDirection);

  const rayDirection = (x, y) => new THREE.Vector3(x, y, 0.5)
    .unproject(camera)
    .sub(cameraPosition)
    .normalize();

  const addScreenEdge = (start, end) => {
    const firstRay = rayDirection(start.x, start.y);
    const secondRay = rayDirection(end.x, end.y);
    const inwardNormal = new THREE.Vector3().crossVectors(firstRay, secondRay).normalize();
    if (inwardNormal.dot(centerDirection) < 0) inwardNormal.negate();

    const wall = new CANNON.Body({ mass: 0 });
    wall.addShape(new CANNON.Plane());
    wall.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    wall.quaternion.setFromVectors(
      new CANNON.Vec3(0, 0, 1),
      new CANNON.Vec3(inwardNormal.x, inwardNormal.y, inwardNormal.z),
    );
    world.addBody(wall);
    dicePhysics.boundaryBodies.push(wall);
  };

  const sideInset = 1;
  const topInset = 1;
  const bottomInset = -1;
  addScreenEdge(new THREE.Vector2(-sideInset, bottomInset), new THREE.Vector2(-sideInset, topInset));
  addScreenEdge(new THREE.Vector2(sideInset, topInset), new THREE.Vector2(sideInset, bottomInset));
  addScreenEdge(new THREE.Vector2(-sideInset, topInset), new THREE.Vector2(sideInset, topInset));
  addScreenEdge(new THREE.Vector2(sideInset, bottomInset), new THREE.Vector2(-sideInset, bottomInset));
}

function animatePhysicalDice(timestamp) {
  if (!dicePhysics) return;
  const delta = Math.min((timestamp - lastDiceFrameTime) / 1000, 0.05);
  lastDiceFrameTime = timestamp;

  if (!diceModal.hidden || !mapDiceLayer.hidden) {
    if (diceHolding) {
      const activeDice = getActiveDice();
      activeDice.forEach(({ body }, index) => {
        const side = activeDice.length === 2 ? (index ? 1 : -1) : 0;
        const desiredVelocity = {
          x: (dicePhysics.dragTarget.x + side * 0.48 - body.position.x) * 11,
          y: (dicePhysics.dragTarget.y - body.position.y) * 11,
          z: (dicePhysics.dragTarget.z - body.position.z) * 11,
        };
        body.velocity.x += (desiredVelocity.x - body.velocity.x) * 0.28;
        body.velocity.y += (desiredVelocity.y - body.velocity.y) * 0.28;
        body.velocity.z += (desiredVelocity.z - body.velocity.z) * 0.28;
        const phase = index * 0.9;
        const targetSpin = {
          x: 18 + Math.sin(timestamp / 260 + phase) * 3,
          y: 21 + Math.cos(timestamp / 310 + phase) * 3.5,
          z: 16 + Math.sin(timestamp / 230 + phase) * 3,
        };
        body.angularVelocity.x += (targetSpin.x - body.angularVelocity.x) * 0.09;
        body.angularVelocity.y += (targetSpin.y - body.angularVelocity.y) * 0.09;
        body.angularVelocity.z += (targetSpin.z - body.angularVelocity.z) * 0.09;
      });
    }
    if (diceRolling || diceHolding) dicePhysics.world.step(1 / 120, delta, 8);
    getActiveDice().forEach(({ mesh, outline, body }) => {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
      outline.position.copy(mesh.position);
      outline.position.y += 0.009;
      outline.quaternion.copy(mesh.quaternion);
    });
    dicePhysics.renderer.render(dicePhysics.scene, dicePhysics.camera);

    const elapsed = timestamp - diceRollStartedAt;
    const slowEnough = getActiveDice().every(({ body }) => (
      body.velocity.lengthSquared() < 0.015
      && body.angularVelocity.lengthSquared() < 0.025
    ));
    if (diceRolling && !diceHolding) {
      if (elapsed > 550 && slowEnough) {
        if (!diceSettledAt) diceSettledAt = timestamp;
        if (timestamp - diceSettledAt >= 700) finishPhysicalDiceRoll();
      } else {
        diceSettledAt = 0;
      }
      if (diceRolling && elapsed > 3500) finishPhysicalDiceRoll();
    }
  }

  requestAnimationFrame(animatePhysicalDice);
}

function finishPhysicalDiceRoll() {
  diceRolling = false;
  const activeDice = getActiveDice();
  activeDice.forEach(({ body }) => body.sleep());
  const results = activeDice.map(({ body }) => getTopDiceFace(body.quaternion));
  const result = results.reduce((sum, value) => sum + value, 0);
  diceResult.classList.remove("rolling");
  diceResult.textContent = String(result);
  diceResult.classList.add("show");
  if (results.length === 2) {
    diceBreakdown.textContent = `${results[0]} + ${results[1]}`;
    diceBreakdown.classList.add("show");
  } else {
    diceBreakdown.classList.remove("show");
    diceBreakdown.textContent = "";
  }
}

function getTopDiceFace(quaternion) {
  const faces = [
    { normal: new CANNON.Vec3(1, 0, 0), value: 3 },
    { normal: new CANNON.Vec3(-1, 0, 0), value: 4 },
    { normal: new CANNON.Vec3(0, 1, 0), value: 1 },
    { normal: new CANNON.Vec3(0, -1, 0), value: 6 },
    { normal: new CANNON.Vec3(0, 0, 1), value: 2 },
    { normal: new CANNON.Vec3(0, 0, -1), value: 5 },
  ];
  let topFace = faces[0];
  let highestY = -Infinity;

  faces.forEach((face) => {
    const worldNormal = quaternion.vmult(face.normal);
    if (worldNormal.y > highestY) {
      highestY = worldNormal.y;
      topFace = face;
    }
  });
  return topFace.value;
}

async function loadCellMask() {
  const image = new Image();
  image.src = CELL_MASK_SRC;
  await image.decode();

  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  source.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);

  const imageData = source.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, source.width, source.height);
  const labels = new Int16Array(source.width * source.height).fill(-1);
  const components = [];

  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel] !== -1 || !isMaskPixel(imageData.data, pixel)) continue;
    const component = readMaskComponent(pixel, imageData.data, labels, source.width, source.height, components.length);

    if (component.pixels.length >= 3000) {
      components.push(component);
    } else {
      component.pixels.forEach((componentPixel) => {
        labels[componentPixel] = -2;
      });
    }
  }

  const ordered = orderComponents(components);
  const orderBySourceIndex = new Int16Array(components.length);
  ordered.forEach((component, index) => {
    orderBySourceIndex[component.sourceIndex] = index;
  });

  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel] >= 0) labels[pixel] = orderBySourceIndex[labels[pixel]];
  }

  cells = ordered;
  cellInfo = cells.map((_, index) => ({
    title: `Сектор ${index + 1}`,
    text: "Позже здесь будет описание этого сектора.",
  }));
  cellInfo[0] = {
    title: "Сектор 1",
    genre: "Любой жанр на выбор",
    modifier: "Лёгкие деньги",
    effect: "При попадании на этот сектор вы получаете +50 к золоту",
    note: "Работает многократно",
  };
  cellInfo[1] = {
    title: "Сектор 2",
    genre: "Все жанры",
    modifier: "Подоходный налог",
    effect: "Официально трудоустроенные получают на 13% меньше золота, самозанятые — на 6% меньше",
    note: "Тунеядцы кайфуют, у них 0%",
  };
  cellInfo[2] = {
    title: "Сектор 3",
    genre: "Все жанры",
    modifier: "Старая школа",
    effect: "Роллятся игры до 2010 года включительно",
  };
  cellMask = { width: source.width, height: source.height, labels, components: ordered };
  drawCellMask();
}

function isMaskPixel(data, pixel) {
  const offset = pixel * 4;
  return data[offset] > 220 && data[offset + 1] < 80 && data[offset + 2] < 80;
}

function readMaskComponent(start, data, labels, width, height, sourceIndex) {
  const queue = [start];
  const pixels = [];
  let head = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  labels[start] = sourceIndex;

  while (head < queue.length) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    pixels.push(pixel);
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    const neighbors = [];
    if (x > 0) neighbors.push(pixel - 1);
    if (x < width - 1) neighbors.push(pixel + 1);
    if (y > 0) neighbors.push(pixel - width);
    if (y < height - 1) neighbors.push(pixel + width);

    neighbors.forEach((neighbor) => {
      if (labels[neighbor] === -1 && isMaskPixel(data, neighbor)) {
        labels[neighbor] = sourceIndex;
        queue.push(neighbor);
      }
    });
  }

  return {
    sourceIndex,
    pixels,
    x: sumX / pixels.length,
    y: sumY / pixels.length,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function orderComponents(components) {
  const remaining = [...components];
  const ordered = [];
  let current = takeClosestComponent(remaining, 9, 36);

  while (current) {
    ordered.push(current);
    current = takeClosestComponent(remaining, current.x, current.y);
  }

  return ordered;
}

function takeClosestComponent(components, x, y) {
  if (!components.length) return null;
  let closestIndex = 0;
  let closestDistance = Infinity;

  components.forEach((component, index) => {
    const distance = (component.x - x) ** 2 + (component.y - y) ** 2;
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });

  return components.splice(closestIndex, 1)[0];
}

function drawCellMask(timestamp = performance.now()) {
  if (!cellMask) return;
  const { width, height, labels, components } = cellMask;
  const activeHoverIndex = hoveredCellIndex >= 0 ? hoveredCellIndex : exitingCellIndex;
  const transitionStart = hoveredCellIndex >= 0 ? hoverAnimationStartTime : hoverAnimationExitTime;
  const transitionProgress = Math.min(Math.max(timestamp - transitionStart, 0) / 100, 1);
  const easedTransition = 1 - (1 - transitionProgress) ** 3;
  const hoverStrength = hoveredCellIndex >= 0 ? easedTransition : 1 - easedTransition;
  const overlay = cellContext.createImageData(width, height);
  const hoveredMask = activeHoverIndex >= 0 ? cellContext.createImageData(width, height) : null;

  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const label = labels[pixel];
    if (label < 0) continue;
    const offset = pixel * 4;
    const isSelected = label === selectedCellIndex;
    const isHovered = label === activeHoverIndex;

    if (isHovered) {
      overlay.data[offset] = 255;
      overlay.data[offset + 1] = 235;
      overlay.data[offset + 2] = 242;
      overlay.data[offset + 3] = Math.round(34 * hoverStrength);
      hoveredMask.data[offset] = 0;
      hoveredMask.data[offset + 1] = 0;
      hoveredMask.data[offset + 2] = 0;
      hoveredMask.data[offset + 3] = 255;
    } else if (isSelected) {
      overlay.data[offset] = 255;
      overlay.data[offset + 1] = 92;
      overlay.data[offset + 2] = 138;
      overlay.data[offset + 3] = 142;
    }
  }

  cellLayer.width = width;
  cellLayer.height = height;
  cellContext.putImageData(overlay, 0, 0);
  if (hoveredMask) {
    const pulse = (Math.sin(timestamp / 420) + 1) / 2;
    const scale = 1 + (0.105 + pulse * 0.01) * hoverStrength;
    const hoveredComponent = components[activeHoverIndex];
    drawMagnifiedCell(hoveredMask, hoveredComponent, width, height, scale, activeHoverIndex, hoverStrength);
    drawExpandedOutline(
      hoveredMask,
      width,
      height,
      pulse,
      hoveredComponent,
      scale,
      hoverStrength,
      activeHoverIndex,
    );
  }
  cellContext.fillStyle = "#000";
  cellContext.font = "bold 24px Arial";
  cellContext.textAlign = "center";
  cellContext.textBaseline = "middle";
  components.forEach((component, index) => {
    cellContext.fillText(index + 1, component.x, component.y);
  });
}

function drawMagnifiedCell(mask, component, width, height, scale, activeHoverIndex, hoverStrength) {
  if (!boardMap.complete || !component) return;

  if (!magnifiedCellCache || magnifiedCellCache.index !== activeHoverIndex) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCanvas.getContext("2d").putImageData(mask, 0, 0);

    const sectorCanvas = document.createElement("canvas");
    sectorCanvas.width = width;
    sectorCanvas.height = height;
    const sectorContext = sectorCanvas.getContext("2d");
    sectorContext.drawImage(boardMap, 0, 0, width, height);
    sectorContext.globalCompositeOperation = "destination-in";
    sectorContext.drawImage(maskCanvas, 0, 0);
    magnifiedCellCache = { index: activeHoverIndex, canvas: sectorCanvas };
  }

  cellContext.save();
  cellContext.globalAlpha = 0.94 * hoverStrength;
  cellContext.translate(component.x, component.y);
  cellContext.scale(scale, scale);
  cellContext.drawImage(magnifiedCellCache.canvas, -component.x, -component.y);
  cellContext.restore();
}

function drawExpandedOutline(
  mask,
  width,
  height,
  pulse = 0.5,
  component,
  scale = 1,
  hoverStrength = 1,
  activeHoverIndex = -1,
) {
  if (!component) return;

  if (!outlineCellCache || outlineCellCache.index !== activeHoverIndex) {
    outlineCellCache = createSupersampledOutline(mask, width, height, component, activeHoverIndex);
  }

  const outline = outlineCellCache;

  cellContext.save();
  cellContext.imageSmoothingEnabled = true;
  cellContext.imageSmoothingQuality = "high";
  cellContext.translate(component.x, component.y);
  cellContext.scale(scale, scale);
  cellContext.translate(-component.x, -component.y);
  cellContext.globalAlpha = (0.1 + pulse * 0.08) * hoverStrength;
  cellContext.filter = `blur(${6 + pulse * 2.5}px)`;
  drawCachedOutline(outline);
  cellContext.globalAlpha = (0.2 + pulse * 0.16) * hoverStrength;
  cellContext.filter = `blur(${2.8 + pulse * 1.8}px)`;
  drawCachedOutline(outline);
  cellContext.globalAlpha = (0.38 + pulse * 0.18) * hoverStrength;
  cellContext.filter = "blur(1px)";
  drawCachedOutline(outline);
  cellContext.filter = "blur(0.2px)";
  cellContext.globalAlpha = (0.36 + pulse * 0.12) * hoverStrength;
  drawCachedOutline(outline);
  cellContext.restore();
}

function drawCachedOutline(outline) {
  cellContext.drawImage(
    outline.canvas,
    0,
    0,
    outline.canvas.width,
    outline.canvas.height,
    outline.x,
    outline.y,
    outline.width,
    outline.height,
  );
}

function createSupersampledOutline(mask, width, height, component, index) {
  const supersample = 4;
  const radius = 4;
  const padding = 10;
  const x = Math.max(0, component.minX - padding);
  const y = Math.max(0, component.minY - padding);
  const right = Math.min(width, component.maxX + padding + 1);
  const bottom = Math.min(height, component.maxY + padding + 1);
  const cropWidth = right - x;
  const cropHeight = bottom - y;

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = cropWidth;
  sourceCanvas.height = cropHeight;
  sourceCanvas.getContext("2d").putImageData(mask, -x, -y);

  const highWidth = cropWidth * supersample;
  const highHeight = cropHeight * supersample;
  const highMaskCanvas = document.createElement("canvas");
  highMaskCanvas.width = highWidth;
  highMaskCanvas.height = highHeight;
  const highMaskContext = highMaskCanvas.getContext("2d");
  highMaskContext.imageSmoothingEnabled = true;
  highMaskContext.imageSmoothingQuality = "high";
  highMaskContext.drawImage(sourceCanvas, 0, 0, highWidth, highHeight);

  const outlineCanvas = document.createElement("canvas");
  outlineCanvas.width = highWidth;
  outlineCanvas.height = highHeight;
  const outlineContext = outlineCanvas.getContext("2d");
  outlineContext.imageSmoothingEnabled = true;
  outlineContext.imageSmoothingQuality = "high";
  const highRadius = radius * supersample;

  for (let offsetY = -highRadius; offsetY <= highRadius; offsetY += 1) {
    for (let offsetX = -highRadius; offsetX <= highRadius; offsetX += 1) {
      const distance = Math.hypot(offsetX, offsetY);
      if (distance === 0 || distance > highRadius) continue;
      outlineContext.globalAlpha = distance > highRadius - supersample ? 0.6 : 0.95;
      outlineContext.drawImage(highMaskCanvas, offsetX, offsetY);
    }
  }

  outlineContext.globalAlpha = 1;
  outlineContext.globalCompositeOperation = "destination-out";
  outlineContext.drawImage(highMaskCanvas, 0, 0);
  outlineContext.globalCompositeOperation = "source-in";
  outlineContext.fillStyle = "#FF5C8A";
  outlineContext.fillRect(0, 0, highWidth, highHeight);
  outlineContext.globalCompositeOperation = "source-over";

  return { index, canvas: outlineCanvas, x, y, width: cropWidth, height: cropHeight };
}

function animateHoveredCell(timestamp) {
  if (hoveredCellIndex < 0 && exitingCellIndex < 0) {
    hoverAnimationFrame = null;
    return;
  }

  if (hoveredCellIndex < 0 && timestamp - hoverAnimationExitTime >= 100) {
    exitingCellIndex = -1;
    magnifiedCellCache = null;
    drawCellMask(timestamp);
    hoverAnimationFrame = null;
    return;
  }

  if (timestamp - lastHoverFrameTime >= 20) {
    lastHoverFrameTime = timestamp;
    drawCellMask(timestamp);
  }

  hoverAnimationFrame = requestAnimationFrame(animateHoveredCell);
}

function startHoverAnimation() {
  if (hoverAnimationFrame === null) {
    hoverAnimationFrame = requestAnimationFrame(animateHoveredCell);
  }
}

function renderPieces() {
  pieceLayer.innerHTML = "";
  pieces.forEach((piece, index) => {
    const token = document.createElement("button");
    token.className = "game-piece";
    token.type = "button";
    token.dataset.index = index;
    token.dataset.playerId = `player-${index + 1}`;
    token.style.setProperty("--piece-color", piece.color);
    token.setAttribute("aria-label", `Фигурка ${piece.label}`);
    movePiece(token, positions[index]);
    token.addEventListener("pointerdown", startDrag);
    pieceLayer.append(token);
  });

  connectPlayerBadgesToPieces();
}

function connectPlayerBadgesToPieces() {
  const setPieceHighlight = (playerId, highlighted) => {
    const token = pieceLayer.querySelector(`.game-piece[data-player-id="${playerId}"]`);
    token?.classList.toggle("player-highlighted", highlighted);
  };

  playerBadges.forEach((badge) => {
    const playerId = badge.dataset.playerId;
    badge.addEventListener("pointerenter", () => setPieceHighlight(playerId, true));
    badge.addEventListener("pointerleave", () => setPieceHighlight(playerId, false));
    badge.addEventListener("focus", () => setPieceHighlight(playerId, true));
    badge.addEventListener("blur", () => setPieceHighlight(playerId, false));
  });
}

function movePiece(token, position) {
  token.style.left = `${position.x}%`;
  token.style.top = `${position.y}%`;
}

function startDrag(event) {
  const token = event.currentTarget;
  token.setPointerCapture(event.pointerId);
  token.classList.add("dragging");
  activePiece = {
    token,
    index: Number(token.dataset.index),
    pointerId: event.pointerId,
  };
  dragPiece(event);
}

function dragPiece(event) {
  if (!activePiece || activePiece.pointerId !== event.pointerId) return;

  const point = getPointerPercent(event);
  positions[activePiece.index] = point;
  movePiece(activePiece.token, point);
}

function stopDrag(event) {
  if (!activePiece || activePiece.pointerId !== event.pointerId) return;

  dragPiece(event);
  activePiece.token.classList.remove("dragging");
  activePiece = null;
  savePositions();
}

function openCellModal(index) {
  const info = cellInfo[index];
  cellModalTitle.textContent = info.title;
  cellModalText.replaceChildren();

  if (info.genre) {
    const genreLabel = document.createElement("span");
    genreLabel.className = "cell-detail-label";
    genreLabel.textContent = "Жанр";

    const genreValue = document.createElement("span");
    genreValue.className = "cell-genre-badge";
    genreValue.textContent = info.genre;

    const modifierCard = document.createElement("span");
    modifierCard.className = "cell-modifier-card";

    const modifierLabel = document.createElement("span");
    modifierLabel.className = "cell-detail-label";
    modifierLabel.textContent = "Дополнительный модификатор";

    const modifierTitle = document.createElement("strong");
    modifierTitle.className = "cell-modifier-title";
    modifierTitle.textContent = info.modifier;

    const modifierEffect = document.createElement("span");
    modifierEffect.className = "cell-modifier-effect";
    modifierEffect.textContent = info.effect;

    const noteLabel = document.createElement("span");
    noteLabel.className = "cell-detail-label cell-modifier-note-label";
    noteLabel.textContent = "Примечание";

    const noteCard = document.createElement("span");
    noteCard.className = "cell-note-card";
    noteCard.textContent = info.note;

    modifierCard.append(modifierTitle, modifierEffect);
    if (info.note) modifierCard.append(noteLabel, noteCard);
    cellModalText.append(genreLabel, genreValue, modifierLabel, modifierCard);
  } else {
    cellModalText.textContent = info.text;
  }
  cellModal.hidden = false;
}

function closeModal() {
  cellModal.hidden = true;
  selectedCellIndex = -1;
  drawCellMask();
}

function navigateCell(direction) {
  if (!cells.length) return;
  const currentIndex = selectedCellIndex >= 0 ? selectedCellIndex : 0;
  selectedCellIndex = (currentIndex + direction + cells.length) % cells.length;
  drawCellMask();
  openCellModal(selectedCellIndex);
}

function getPointerPercent(event) {
  const rect = stage.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  return {
    x: clamp(x, 2, 98),
    y: clamp(y, 4, 96),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCellIndexFromPointer(event) {
  if (!cellMask) return -1;
  const rect = cellLayer.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * cellMask.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * cellMask.height);
  if (x < 0 || x >= cellMask.width || y < 0 || y >= cellMask.height) return -1;
  return cellMask.labels[y * cellMask.width + x];
}

stage.addEventListener("pointerdown", startMapDiceMagnet, true);
stage.addEventListener("pointermove", moveMapDiceMagnet, true);
stage.addEventListener("pointerup", releaseMapDiceMagnet, true);
stage.addEventListener("pointercancel", releaseMapDiceMagnet, true);
stage.addEventListener("pointermove", dragPiece);
stage.addEventListener("pointerup", stopDrag);
stage.addEventListener("pointercancel", stopDrag);
cellLayer.addEventListener("pointermove", (event) => {
  const index = getCellIndexFromPointer(event);
  const nextHoveredCellIndex = index >= 0 ? index : -1;
  if (nextHoveredCellIndex === hoveredCellIndex) return;

  const now = performance.now();
  if (nextHoveredCellIndex >= 0) {
    hoveredCellIndex = nextHoveredCellIndex;
    exitingCellIndex = -1;
    hoverAnimationStartTime = now;
    magnifiedCellCache = null;
  } else if (hoveredCellIndex >= 0) {
    exitingCellIndex = hoveredCellIndex;
    hoveredCellIndex = -1;
    hoverAnimationExitTime = now;
  }
  drawCellMask();
  startHoverAnimation();
});
cellLayer.addEventListener("pointerleave", () => {
  if (hoveredCellIndex === -1) return;
  exitingCellIndex = hoveredCellIndex;
  hoveredCellIndex = -1;
  hoverAnimationExitTime = performance.now();
  drawCellMask();
  startHoverAnimation();
});
cellLayer.addEventListener("click", (event) => {
  const index = getCellIndexFromPointer(event);
  if (index >= 0) {
    hoveredCellIndex = -1;
    exitingCellIndex = -1;
    magnifiedCellCache = null;
    if (hoverAnimationFrame !== null) cancelAnimationFrame(hoverAnimationFrame);
    hoverAnimationFrame = null;
    selectedCellIndex = index;
    drawCellMask();
    openCellModal(index);
  }
});
closeCellModal.addEventListener("click", closeModal);
previousCell.addEventListener("click", () => navigateCell(-1));
nextCell.addEventListener("click", () => navigateCell(1));
boardRollButton.addEventListener("click", handleBoardRoll);
boardDoubleDiceButton.addEventListener("click", () => {
  setDoubleDiceMode(!doubleDiceToggle.checked);
});
closeDiceModal.addEventListener("click", closeDiceWindow);
doubleDiceToggle.addEventListener("change", () => {
  boardDoubleDiceButton.setAttribute("aria-pressed", String(doubleDiceToggle.checked));
  resetDiceForMode();
});
diceCube.addEventListener("pointerdown", startDiceMagnet);
diceCube.addEventListener("pointermove", moveDiceMagnet);
diceCube.addEventListener("pointerup", releaseDiceMagnet);
diceCube.addEventListener("pointercancel", releaseDiceMagnet);
diceDragHandle.addEventListener("pointerdown", startDiceWindowDrag);
diceDragHandle.addEventListener("pointermove", dragDiceWindow);
diceDragHandle.addEventListener("pointerup", stopDiceWindowDrag);
diceDragHandle.addEventListener("pointercancel", stopDiceWindowDrag);
cellModal.addEventListener("click", (event) => {
  if (event.target === cellModal) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    closeDiceWindow();
    closeMapDiceMode();
  }
});
window.addEventListener("focus", loadPlayerBalances);
function handleDiceViewportResize() {
  if (!diceModal.hidden) {
    updateDiceWindowScale();
    setDiceWindowPosition(diceWindowPosition.x, diceWindowPosition.y);
    resizeDiceRenderer();
  }
  if (!mapDiceLayer.hidden) resizeDiceRenderer();
}

window.addEventListener("resize", handleDiceViewportResize);
window.visualViewport?.addEventListener("resize", handleDiceViewportResize);

loadPlayerBalances();
loadCellMask()
  .catch((error) => console.error("Не удалось загрузить разметку секторов", error))
  .finally(renderPieces);
