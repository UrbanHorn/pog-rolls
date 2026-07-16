const machine = document.querySelector(".casino-machine");
const machineImage = machine?.querySelector(".casino-machine-image");
const coinSlotButton = machine?.querySelector(".coin-slot-button");
const startButton = machine?.querySelector(".casino-start-button");
const pressedStartImage = machine?.querySelector(".casino-start-pressed");
const casinoStatus = machine?.querySelector(".casino-status");

const activeMachineImage = new Image();
activeMachineImage.src = "assets/casino-machine-on.png";

const insertCoinSound = new Audio("assets/casino-insert-coin.mp3");
insertCoinSound.preload = "auto";
const coinInsertDelay = 1000;

function insertCoin() {
  if (!machine || !machineImage || !coinSlotButton) {
    return;
  }

  // Здесь позже можно добавить проверку баланса и списание стоимости активации.
  coinSlotButton.disabled = true;
  setTimeout(() => {
    coinSlotButton.disabled = false;
  }, coinInsertDelay);

  const coinCount = Number(machine.dataset.coins || 0) + 1;
  machine.dataset.coins = String(coinCount);

  insertCoinSound.currentTime = 0;
  insertCoinSound.play().catch(() => {});

  if (machine.dataset.state !== "active") {
    machine.dataset.state = "active";
    machineImage.src = activeMachineImage.src;
    machineImage.alt = "Активированный игровой автомат POG Rolls";

    if (startButton) {
      startButton.disabled = false;
    }

    machine.dispatchEvent(new CustomEvent("casino:activated"));
  }

  coinSlotButton.setAttribute("aria-label", "Вставить ещё одну монетку");
  coinSlotButton.title = "Вставить ещё одну монетку";

  if (casinoStatus) {
    casinoStatus.textContent = `Вставлено монет: ${coinCount}`;
  }

  machine.dispatchEvent(new CustomEvent("casino:coin-inserted", {
    detail: { coinCount },
  }));
}

coinSlotButton?.addEventListener("click", insertCoin);

let startButtonReleaseTimer;

function showPressedStartButton() {
  if (!pressedStartImage || startButton?.disabled) {
    return;
  }

  clearTimeout(startButtonReleaseTimer);
  pressedStartImage.hidden = false;
}

function hidePressedStartButton(delay = 0) {
  clearTimeout(startButtonReleaseTimer);
  startButtonReleaseTimer = setTimeout(() => {
    if (pressedStartImage) {
      pressedStartImage.hidden = true;
    }
  }, delay);
}

startButton?.addEventListener("pointerdown", (event) => {
  event.currentTarget.setPointerCapture?.(event.pointerId);
  showPressedStartButton();
});

startButton?.addEventListener("pointerup", () => hidePressedStartButton(90));
startButton?.addEventListener("pointercancel", () => hidePressedStartButton());
startButton?.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    showPressedStartButton();
  }
});
startButton?.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") {
    hidePressedStartButton(90);
  }
});
startButton?.addEventListener("click", () => {
  showPressedStartButton();
  hidePressedStartButton(180);
  machine?.dispatchEvent(new CustomEvent("casino:start"));
});
