const PIECES_KEY = "board-free-piece-positions-v1";
const CELL_MASK_SRC = "assets/board-cell-mask.png";

let cells = [];
let cellInfo = [];
let cellMask = null;
let selectedCellIndex = -1;
let hoveredCellIndex = -1;

const pieces = [
  { label: "1", color: "#d64545", start: { x: 8, y: 72 } },
  { label: "2", color: "#2878d7", start: { x: 11, y: 72 } },
  { label: "3", color: "#2f9e44", start: { x: 14, y: 72 } },
  { label: "4", color: "#7b3fc4", start: { x: 17, y: 72 } },
  { label: "5", color: "#e09f1f", start: { x: 20, y: 72 } },
];

const stage = document.querySelector("#boardStage");
const cellLayer = document.querySelector("#cellLayer");
const cellContext = cellLayer.getContext("2d");
const pieceLayer = document.querySelector("#pieceLayer");
const cellModal = document.querySelector("#cellModal");
const cellModalTitle = document.querySelector("#cellModalTitle");
const cellModalText = document.querySelector("#cellModalText");
const closeCellModal = document.querySelector("#closeCellModal");

let positions = loadPositions();
let activePiece = null;

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
    title: `Клетка ${index + 1}`,
    text: "Позже здесь будет описание этой клетки.",
  }));
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
  labels[start] = sourceIndex;

  while (head < queue.length) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    pixels.push(pixel);
    sumX += x;
    sumY += y;

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

  return { sourceIndex, pixels, x: sumX / pixels.length, y: sumY / pixels.length };
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

function drawCellMask() {
  if (!cellMask) return;
  const { width, height, labels, components } = cellMask;
  const overlay = cellContext.createImageData(width, height);
  const hoveredMask = hoveredCellIndex >= 0 ? cellContext.createImageData(width, height) : null;

  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const label = labels[pixel];
    if (label < 0) continue;
    const offset = pixel * 4;
    const isSelected = label === selectedCellIndex;
    const isHovered = label === hoveredCellIndex;

    if (isHovered) {
      overlay.data[offset] = 0;
      overlay.data[offset + 1] = 0;
      overlay.data[offset + 2] = 0;
      overlay.data[offset + 3] = 70;
      hoveredMask.data[offset] = 0;
      hoveredMask.data[offset + 1] = 0;
      hoveredMask.data[offset + 2] = 0;
      hoveredMask.data[offset + 3] = 255;
    } else {
      overlay.data[offset] = isSelected ? 255 : 73;
      overlay.data[offset + 1] = isSelected ? 203 : 214;
      overlay.data[offset + 2] = isSelected ? 73 : 167;
      overlay.data[offset + 3] = isSelected ? 142 : 54;
    }
  }

  cellLayer.width = width;
  cellLayer.height = height;
  cellContext.putImageData(overlay, 0, 0);
  if (hoveredMask) drawExpandedOutline(hoveredMask, width, height);
  cellContext.fillStyle = "#000";
  cellContext.font = "bold 24px Arial";
  cellContext.textAlign = "center";
  cellContext.textBaseline = "middle";
  components.forEach((component, index) => {
    cellContext.fillText(index + 1, component.x, component.y);
  });
}

function drawExpandedOutline(mask, width, height) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  maskCanvas.getContext("2d").putImageData(mask, 0, 0);

  const outlineCanvas = document.createElement("canvas");
  outlineCanvas.width = width;
  outlineCanvas.height = height;
  const outlineContext = outlineCanvas.getContext("2d");
  const radius = 3;

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = Math.hypot(x, y);
      if (distance === 0 || distance > radius) continue;
      outlineContext.globalAlpha = distance > radius - 1 ? 0.55 : 0.95;
      outlineContext.drawImage(maskCanvas, x, y);
    }
  }

  outlineContext.globalAlpha = 1;
  outlineContext.globalCompositeOperation = "destination-out";
  outlineContext.drawImage(maskCanvas, 0, 0);
  outlineContext.globalCompositeOperation = "source-in";
  outlineContext.fillStyle = "#9b4dff";
  outlineContext.fillRect(0, 0, width, height);
  outlineContext.globalCompositeOperation = "source-over";

  cellContext.save();
  cellContext.globalAlpha = 0.28;
  cellContext.filter = "blur(2.2px)";
  cellContext.drawImage(outlineCanvas, 0, 0);
  cellContext.globalAlpha = 0.48;
  cellContext.filter = "blur(0.9px)";
  cellContext.drawImage(outlineCanvas, 0, 0);
  cellContext.filter = "none";
  cellContext.globalAlpha = 0.42;
  cellContext.drawImage(outlineCanvas, 0, 0);
  cellContext.restore();
}

function renderPieces() {
  pieceLayer.innerHTML = "";
  pieces.forEach((piece, index) => {
    const token = document.createElement("button");
    token.className = "game-piece";
    token.type = "button";
    token.textContent = piece.label;
    token.dataset.index = index;
    token.style.setProperty("--piece-color", piece.color);
    token.setAttribute("aria-label", `Фигурка ${piece.label}`);
    movePiece(token, positions[index]);
    token.addEventListener("pointerdown", startDrag);
    pieceLayer.append(token);
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
  cellModalText.textContent = info.text;
  cellModal.hidden = false;
}

function closeModal() {
  cellModal.hidden = true;
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

stage.addEventListener("pointermove", dragPiece);
stage.addEventListener("pointerup", stopDrag);
stage.addEventListener("pointercancel", stopDrag);
cellLayer.addEventListener("pointermove", (event) => {
  const index = getCellIndexFromPointer(event);
  const nextHoveredCellIndex = index >= 0 ? index : -1;
  if (nextHoveredCellIndex === hoveredCellIndex) return;

  hoveredCellIndex = nextHoveredCellIndex;
  drawCellMask();
});
cellLayer.addEventListener("pointerleave", () => {
  if (hoveredCellIndex === -1) return;
  hoveredCellIndex = -1;
  drawCellMask();
});
cellLayer.addEventListener("click", (event) => {
  const index = getCellIndexFromPointer(event);
  if (index >= 0) {
    selectedCellIndex = index;
    drawCellMask();
    openCellModal(index);
  }
});
closeCellModal.addEventListener("click", closeModal);
cellModal.addEventListener("click", (event) => {
  if (event.target === cellModal) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

loadCellMask()
  .catch((error) => console.error("Не удалось загрузить разметку клеток", error))
  .finally(renderPieces);
