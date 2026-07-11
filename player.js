const playerNumber = Number(document.body.dataset.playerNumber || "1");
let profileState = null;

const nodes = {
  profileName: document.querySelector("#profileName"),
  profileBalance: document.querySelector("#profileBalance"),
  profileInventory: document.querySelector("#profileInventory"),
  currentGame: document.querySelector("#profileCurrentGame"),
  gameTimer: document.querySelector("#profileGameTimer"),
  timerDisplay: document.querySelector("#profileTimerDisplay"),
  timerStatus: document.querySelector("#profileTimerStatus"),
  timerStartButton: document.querySelector("#profileTimerStart"),
  timerPauseButton: document.querySelector("#profileTimerPause"),
  completedGames: document.querySelector("#profileCompletedGames"),
  shopList: document.querySelector("#profileShopList"),
  slotMachine: document.querySelector(".slot-machine"),
  slotCost: document.querySelector("#profileSlotCost"),
  spinButton: document.querySelector("#profileSpinButton"),
  slotResult: document.querySelector("#profileSlotResult"),
  prizeList: document.querySelector("#profilePrizeList"),
  slotPrizeWindow: null,
  slotGoldDisplay: null,
  slotImageButton: null,
  reels: [
    document.querySelector("#profileSlotA"),
    document.querySelector("#profileSlotB"),
    document.querySelector("#profileSlotC"),
  ],
};

if (nodes.slotMachine) createSlotOverlay();

let timerTick = null;
let timerSnapshot = {
  gameId: null,
  elapsedSeconds: 0,
  syncedAt: Date.now(),
  running: false,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Player-Number": String(playerNumber),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function formatMoney(amount) {
  return `${amount.toLocaleString("ru-RU")} монет`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadProfile() {
  profileState = await api("/api/player/me");
  renderProfile();
}

function renderProfile() {
  const { player, shopItems, slotCost, prizes } = profileState;

  if (nodes.profileName) {
    nodes.profileName.textContent = player.name;
    document.title = player.name;
  }
  if (nodes.profileBalance) nodes.profileBalance.textContent = formatMoney(player.balance);
  if (nodes.slotGoldDisplay) nodes.slotGoldDisplay.textContent = player.balance.toLocaleString("ru-RU");
  if (nodes.profileInventory) renderInventory(player.inventory, [...shopItems, ...prizes]);
  renderGames(player);
  renderTimer(player.currentGame);
  if (nodes.slotCost) nodes.slotCost.textContent = formatMoney(slotCost);

  if (nodes.shopList) {
    nodes.shopList.innerHTML = "";
    shopItems.forEach((item) => {
      const row = document.createElement("article");
      row.className = "shop-item";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <div class="price">${formatMoney(item.price)}</div>
        </div>
        <button type="button">Купить</button>
      `;
      row.querySelector("button").addEventListener("click", () => buyItem(item.id));
      nodes.shopList.append(row);
    });
  }

  if (nodes.prizeList) {
    const totalWeight = prizes.reduce((sum, prize) => sum + prize.weight, 0);
    nodes.prizeList.innerHTML = "";
    prizes.forEach((prize) => {
      const chance = totalWeight ? Math.round((prize.weight / totalWeight) * 100) : 0;
      const row = document.createElement("article");
      row.className = "prize-item";
      row.innerHTML = `
        <div class="prize-preview">
          ${prize.image ? `<img src="${escapeHtml(prize.image)}" alt="" />` : ""}
          <strong>${escapeHtml(prize.name)}</strong>
        </div>
        <span class="chance">шанс около ${chance}%</span>
      `;
      nodes.prizeList.append(row);
    });
  }
}

function renderTimer(game) {
  if (!nodes.gameTimer) return;

  syncTimerSnapshot(game);
  const hasGame = Boolean(game);
  const isRunning = Boolean(game?.timerRunning);
  nodes.timerDisplay.textContent = formatTimer(getVisibleElapsedSeconds());
  nodes.timerStatus.textContent = hasGame
    ? isRunning ? "Идет прохождение" : "Пауза"
    : "Выберите текущую игру";
  nodes.timerStartButton.disabled = !hasGame || isRunning;
  nodes.timerPauseButton.disabled = !hasGame || !isRunning;
  updateTimerTick();
}

function renderGames(player) {
  if (nodes.currentGame) {
    nodes.currentGame.innerHTML = player.currentGame
      ? `
        <p class="current-game-status">Сейчас играет</p>
        <div class="current-game-details">
          <div class="current-game-cover">
            ${player.currentGame.imageUrl
              ? `<img src="${escapeHtml(player.currentGame.imageUrl)}" alt="Обложка игры ${escapeHtml(player.currentGame.title)}" />`
              : `<span>Нет обложки</span>`}
          </div>
          <dl class="current-game-stats">
            <div class="current-game-name">
              <dt>Игра</dt>
              <dd>${escapeHtml(player.currentGame.title)}</dd>
            </div>
            <div>
              <dt>Время HLTB</dt>
              <dd>${escapeHtml(formatHours(player.currentGame.hours))}</dd>
            </div>
            <div>
              <dt>Рейтинг HLTB</dt>
              <dd>${player.currentGame.rating === null || player.currentGame.rating === undefined ? "-" : `${escapeHtml(player.currentGame.rating)}%`}</dd>
            </div>
            <div>
              <dt>Год выпуска</dt>
              <dd>${player.currentGame.releaseYear || "-"}</dd>
            </div>
          </dl>
        </div>
        <div class="current-game-actions">
          <button id="completeCurrentGame" type="button">Игра пройдена</button>
          <button id="dropCurrentGame" type="button">Дроп игры</button>
        </div>
      `
      : `<div class="current-game-empty">Текущая игра не выбрана</div>`;

    if (player.currentGame) {
      nodes.currentGame.querySelector("#completeCurrentGame")
        .addEventListener("click", () => finishGame("complete"));
      nodes.currentGame.querySelector("#dropCurrentGame")
        .addEventListener("click", () => finishGame("drop"));
    }
  }

  if (nodes.completedGames) {
    const games = player.completedGames
      .map((game) => {
        const status = game.result === "dropped" ? "Дроп игры" : "Игра пройдена";
        return `
          <article class="completed-game-card">
            <div class="completed-game-cover">
              ${game.imageUrl ? `<img src="${escapeHtml(game.imageUrl)}" alt="" />` : `<span>Нет обложки</span>`}
            </div>
            <div class="completed-game-info">
              <strong>${escapeHtml(game.title)}</strong>
              <span class="completed-game-status ${game.result === "dropped" ? "is-dropped" : ""}">${status}</span>
            </div>
            <div class="completed-game-timer">
              <span>Время таймера</span>
              <strong>${formatTimer(game.elapsedSeconds || 0)}</strong>
            </div>
          </article>
        `;
      })
      .join("");
    nodes.completedGames.innerHTML = `
      <div class="profile-games-title">Список пройденных игр</div>
      <div class="completed-games-list">${games}</div>
    `;
  }
}

async function finishGame(action) {
  const message = action === "complete"
    ? "Завершить игру и начислить награду?"
    : "Дропнуть игру? Она останется в списке, но награда не будет начислена.";
  if (!confirm(message)) return;

  try {
    await api("/api/player/game/finish", {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    await loadProfile();
  } catch (error) {
    alert(error.message);
  }
}

function formatHours(hours) {
  return `${Number(hours).toLocaleString("ru-RU")} ч.`;
}

function formatTimer(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function syncTimerSnapshot(game) {
  timerSnapshot = {
    gameId: game?.id || null,
    elapsedSeconds: Number.isFinite(Number(game?.elapsedSeconds)) ? Number(game.elapsedSeconds) : 0,
    syncedAt: Date.now(),
    running: Boolean(game?.timerRunning),
  };
}

function getVisibleElapsedSeconds() {
  if (!timerSnapshot.running) return timerSnapshot.elapsedSeconds;
  return timerSnapshot.elapsedSeconds + Math.floor((Date.now() - timerSnapshot.syncedAt) / 1000);
}

function updateTimerTick() {
  if (timerTick) {
    window.clearInterval(timerTick);
    timerTick = null;
  }
  if (!timerSnapshot.running || !nodes.timerDisplay) return;
  timerTick = window.setInterval(() => {
    nodes.timerDisplay.textContent = formatTimer(getVisibleElapsedSeconds());
  }, 1000);
}

async function setGameTimer(action) {
  try {
    const data = await api("/api/player/timer", {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    profileState.player = data.player;
    renderProfile();
  } catch (error) {
    alert(error.message);
  }
}

function renderInventory(inventory, catalog) {
  if (!inventory.length) {
    nodes.profileInventory.innerHTML = "";
    return;
  }

  nodes.profileInventory.innerHTML = inventory
    .slice(0, 6)
    .map((itemName) => {
      const item = findCatalogItem(itemName, catalog);
      return renderInventoryItem({ name: itemName, image: item?.image || "", count: 1 });
    })
    .join("");
}

function findCatalogItem(itemName, catalog) {
  return catalog.find((item) => item.name === itemName);
}

function renderInventoryItem(item) {
  const icon = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />`
    : `<span class="inventory-fallback">${escapeHtml(item.name.trim().charAt(0) || "?")}</span>`;
  const count = item.count > 1 ? `<span class="inventory-count">x${item.count}</span>` : "";

  return `
    <article class="inventory-card" title="${escapeHtml(item.name)}">
      <div class="inventory-icon">
        ${icon}
        ${count}
      </div>
      <strong>${escapeHtml(item.name)}</strong>
    </article>
  `;
}

function createSlotOverlay() {
  nodes.slotMachine.insertAdjacentHTML(
    "beforeend",
    `
      <div id="slotPrizeWindow" class="slot-prize-window">?</div>
      <button id="slotImageButton" class="slot-image-button" type="button">КРУТИТЬ</button>
      <div id="slotGoldDisplay" class="slot-gold-display">0</div>
    `,
  );

  nodes.slotPrizeWindow = document.querySelector("#slotPrizeWindow");
  nodes.slotGoldDisplay = document.querySelector("#slotGoldDisplay");
  nodes.slotImageButton = document.querySelector("#slotImageButton");
}

async function buyItem(itemId) {
  try {
    await api("/api/player/buy", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    });
    await loadProfile();
  } catch (error) {
    alert(error.message);
  }
}

async function spinSlot() {
  const prizes = profileState?.prizes || [];
  setSpinDisabled(true);
  startPrizeAnimation(prizes);

  try {
    const data = await api("/api/player/spin", { method: "POST" });
    await stopPrizeAnimation(data.prize, prizes);
    nodes.slotResult.textContent = `Вы выиграли "${data.prize.name}"!`;
    await loadProfile();
  } catch (error) {
    await stopPrizeAnimation(null, prizes);
    nodes.slotResult.textContent = error.message;
  } finally {
    setSpinDisabled(false);
  }
}

let reelAnimation = null;
let reelTimer = null;
let reelIndex = 0;

function startPrizeAnimation(prizes) {
  if (!prizes.length) {
    renderPrizeWindow(null);
    return;
  }

  clearReelTimer();
  nodes.slotPrizeWindow.classList.add("spinning");
  reelIndex = 0;
  showRollingPrize(prizes[reelIndex], 70);

  reelTimer = window.setInterval(() => {
    reelIndex = (reelIndex + 1) % prizes.length;
    showRollingPrize(prizes[reelIndex], 70);
  }, 82);
}

async function stopPrizeAnimation(finalPrize, prizes) {
  cancelReelAnimation();
  clearReelTimer();

  if (!finalPrize) {
    nodes.slotPrizeWindow.classList.remove("spinning");
    renderPrizeWindow(null);
    return;
  }

  await slowDownReel(prizes, finalPrize);
  nodes.slotPrizeWindow.classList.remove("spinning");
  renderPrizeWindow(finalPrize);
  nodes.slotPrizeWindow.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.92)", opacity: 0.6 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
    ],
    { duration: 260, easing: "ease-out" },
  );
}

async function slowDownReel(prizes, finalPrize) {
  const steps = [90, 120, 155, 205, 270, 360];
  for (let index = 0; index < steps.length; index += 1) {
    const prize = index === steps.length - 1
      ? finalPrize
      : prizes[(reelIndex + index + 1) % prizes.length];
    showRollingPrize(prize, steps[index]);
    await wait(steps[index]);
  }
}

function showRollingPrize(prize, duration) {
  cancelReelAnimation();
  nodes.slotPrizeWindow.innerHTML = renderPrizeMarkup(prize, false);
  const item = nodes.slotPrizeWindow.querySelector(".slot-reel-item");
  reelAnimation = item.animate(
    [
      { transform: "translateY(-24%) scale(0.92)", opacity: 0.25, filter: "blur(5px)" },
      { transform: "translateY(0) scale(1)", opacity: 1, filter: "blur(0)" },
    ],
    {
      duration,
      easing: "linear",
    },
  );
}

function cancelReelAnimation() {
  if (reelAnimation) {
    reelAnimation.cancel();
    reelAnimation = null;
  }
}

function clearReelTimer() {
  if (reelTimer) {
    window.clearInterval(reelTimer);
    reelTimer = null;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function renderPrizeWindow(prize) {
  if (!prize) {
    nodes.slotPrizeWindow.innerHTML = `<span class="slot-prize-placeholder">?</span>`;
    return;
  }

  nodes.slotPrizeWindow.innerHTML = renderPrizeMarkup(prize, true);
}

function renderPrizeMarkup(prize, isFinal) {
  return `
    <div class="slot-reel-item${isFinal ? " final" : ""}">
    ${prize.image ? `<img src="${escapeHtml(prize.image)}" alt="${escapeHtml(prize.name)}" />` : ""}
    <span>${escapeHtml(prize.name)}</span>
    </div>
  `;
}

function setSpinDisabled(disabled) {
  nodes.spinButton.disabled = disabled;
  nodes.slotImageButton.disabled = disabled;
}

if (nodes.spinButton) nodes.spinButton.addEventListener("click", spinSlot);
if (nodes.slotImageButton) nodes.slotImageButton.addEventListener("click", spinSlot);
if (nodes.timerStartButton) nodes.timerStartButton.addEventListener("click", () => setGameTimer("start"));
if (nodes.timerPauseButton) nodes.timerPauseButton.addEventListener("click", () => setGameTimer("pause"));

loadProfile().catch((error) => {
  alert(`Не удалось загрузить профиль: ${error.message}`);
});
