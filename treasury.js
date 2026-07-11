let state = {
  players: [],
  log: [],
};

const nodes = {
  playersList: document.querySelector("#playersList"),
  moneyForm: document.querySelector("#moneyForm"),
  moneyPlayerSelect: document.querySelector("#moneyPlayerSelect"),
  moneyAmountInput: document.querySelector("#moneyAmountInput"),
  moneyReasonInput: document.querySelector("#moneyReasonInput"),
  gameForm: document.querySelector("#gameForm"),
  gamePlayerSelect: document.querySelector("#gamePlayerSelect"),
  gameTitleInput: document.querySelector("#gameTitleInput"),
  gameSearchResults: document.querySelector("#gameSearchResults"),
  selectedGameCard: document.querySelector("#selectedGameCard"),
  logList: document.querySelector("#logList"),
  clearLog: document.querySelector("#clearLog"),
  resetGame: document.querySelector("#resetGame"),
};

let gameSearchTimer;
let gameSearchRequest = 0;
let searchGamesById = new Map();
let selectedGame = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

async function loadState() {
  state = await api("/api/state");
  render();
}

function formatMoney(amount) {
  return `${amount.toLocaleString("ru-RU")} монет`;
}

function render() {
  renderPlayers();
  renderSelects();
  renderLog();
}

function renderPlayers() {
  nodes.playersList.innerHTML = "";

  state.players.forEach((player, index) => {
    const card = document.querySelector("#playerTemplate").content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = player.name;
    card.querySelector("strong").textContent = formatMoney(player.balance);
    card.querySelector(".inventory").textContent = player.inventory.length
      ? `Инвентарь: ${player.inventory.join(", ")}`
      : "Инвентарь пуст";
    card.querySelector(".profile-link").href = `player-${index + 1}.html`;
    nodes.playersList.append(card);
  });
}

function renderSelects() {
  nodes.moneyPlayerSelect.innerHTML = state.players
    .map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} (${formatMoney(player.balance)})</option>`)
    .join("");
  nodes.gamePlayerSelect.innerHTML = state.players
    .map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}${player.currentGame ? ` — ${escapeHtml(player.currentGame.title)}` : ""}</option>`)
    .join("");

  nodes.moneyForm.querySelectorAll("button").forEach((button) => {
    button.disabled = state.players.length === 0;
  });
  nodes.gameForm.querySelectorAll("button").forEach((button) => {
    button.disabled = state.players.length === 0;
  });
}

function renderLog() {
  nodes.logList.innerHTML = "";

  if (!state.log.length) {
    nodes.logList.append(emptyMessage("Здесь появятся покупки, выигрыши и выдача денег."));
    return;
  }

  state.log.forEach((entry) => {
    const row = document.createElement("article");
    row.className = "log-item";
    row.innerHTML = `<span><strong>${escapeHtml(entry.time)}</strong> ${escapeHtml(entry.text)}</span>`;
    nodes.logList.append(row);
  });
}

function emptyMessage(text) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = text;
  return element;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function changeMoney(playerId, amount, reason) {
  state = await api("/api/admin/money", {
    method: "POST",
    body: JSON.stringify({ playerId, amount, reason }),
  });
  render();
}

function calculateGamePoints(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.max(50, Math.round(hours * 100));
}

function formatHours(hours) {
  return hours ? `${hours.toLocaleString("ru-RU")} ч.` : "Время не указано";
}

function clearGameSearchResults() {
  nodes.gameSearchResults.replaceChildren();
  nodes.gameSearchResults.hidden = true;
  nodes.gameForm.classList.remove("has-search-results");
  nodes.gameForm.closest(".panel").classList.remove("has-game-search-results");
}

function renderGameSearchResults(games) {
  searchGamesById = new Map(games.map((game) => [game.id, game]));
  nodes.gameSearchResults.replaceChildren();
  nodes.gameSearchResults.hidden = games.length === 0;
  nodes.gameForm.classList.toggle("has-search-results", games.length > 0);
  nodes.gameForm.closest(".panel").classList.toggle("has-game-search-results", games.length > 0);

  games.forEach((game) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-search-result";
    button.dataset.gameId = game.id;

    if (game.imageUrl) {
      const image = document.createElement("img");
      image.src = game.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      button.append(image);
    }

    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = game.title;
    const hours = document.createElement("small");
    hours.textContent = `Основной сюжет: ${formatHours(game.mainHours)}`;
    text.append(title, hours);
    button.append(text);
    nodes.gameSearchResults.append(button);
  });
}

function renderSelectedGame() {
  nodes.selectedGameCard.replaceChildren();
  nodes.selectedGameCard.hidden = !selectedGame;
  if (!selectedGame) return;

  if (selectedGame.imageUrl) {
    const image = document.createElement("img");
    image.src = selectedGame.imageUrl;
    image.alt = "";
    nodes.selectedGameCard.append(image);
  }

  const details = document.createElement("div");
  details.className = "selected-game-details";
  const title = document.createElement("h3");
  title.textContent = selectedGame.title;
  const stats = document.createElement("dl");
  [
    ["Рейтинг HLTB", selectedGame.rating === null ? "-" : `${selectedGame.rating}%`],
    ["Год выпуска", selectedGame.releaseYear || "-"],
    ["Время HLTB", formatHours(selectedGame.mainHours)],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    item.append(term, description);
    stats.append(item);
  });
  details.append(title, stats);
  nodes.selectedGameCard.append(details);
}

async function searchGames() {
  const query = nodes.gameTitleInput.value.trim();
  if (query.length < 2) {
    clearGameSearchResults();
    return;
  }

  const requestId = ++gameSearchRequest;
  try {
    const data = await api(`/api/games/search?q=${encodeURIComponent(query)}`);
    if (requestId !== gameSearchRequest) return;
    renderGameSearchResults(data.games || []);
  } catch (error) {
    if (requestId !== gameSearchRequest) return;
    clearGameSearchResults();
    console.error(error);
  }
}

async function assignCurrentGame() {
  if (!selectedGame) {
    alert("Выберите игру из списка HowLongToBeat.");
    return;
  }

  state = await api("/api/admin/game/current", {
    method: "POST",
    body: JSON.stringify({
      playerId: nodes.gamePlayerSelect.value,
      title: selectedGame.title,
      hours: selectedGame.mainHours,
      points: calculateGamePoints(selectedGame.mainHours),
      imageUrl: selectedGame.imageUrl,
      rating: selectedGame.rating,
      releaseYear: selectedGame.releaseYear,
    }),
  });
  nodes.gameTitleInput.value = "";
  selectedGame = null;
  renderSelectedGame();
  render();
}

nodes.moneyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = event.submitter.dataset.action;
  const amount = Number(nodes.moneyAmountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) return;

  const signedAmount = action === "earn" ? amount : -amount;
  await changeMoney(nodes.moneyPlayerSelect.value, signedAmount, nodes.moneyReasonInput.value.trim());
  nodes.moneyReasonInput.value = "";
});

nodes.gameTitleInput.addEventListener("input", () => {
  selectedGame = null;
  renderSelectedGame();
  clearTimeout(gameSearchTimer);
  gameSearchTimer = setTimeout(searchGames, 300);
});

nodes.gameSearchResults.addEventListener("click", (event) => {
  const result = event.target.closest(".game-search-result");
  if (!result) return;

  selectedGame = searchGamesById.get(result.dataset.gameId) || null;
  if (!selectedGame) return;
  nodes.gameTitleInput.value = selectedGame.title;
  renderSelectedGame();
  clearGameSearchResults();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".game-search")) clearGameSearchResults();
});

nodes.gameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await assignCurrentGame();
});

nodes.clearLog.addEventListener("click", async () => {
  state = await api("/api/admin/clear-log", { method: "POST" });
  render();
});

nodes.resetGame.addEventListener("click", async () => {
  const confirmed = confirm("Сбросить деньги, инвентарь и историю?");
  if (!confirmed) return;

  state = await api("/api/admin/reset", { method: "POST" });
  render();
});

loadState().catch((error) => {
  alert(`Не удалось загрузить казну: ${error.message}`);
});
