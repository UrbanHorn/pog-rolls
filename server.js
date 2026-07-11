const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { HowLongToBeatService } = require("howlongtobeat");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const INVENTORY_LIMIT = 6;
const HLTB_ENDPOINT = "https://howlongtobeat.com/api/bleed";
const HLTB_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36";
const hltbService = new HowLongToBeatService();
// The package still formats search results well, but its bundled endpoint is outdated.
hltbService.hltb.search = searchCurrentHowLongToBeat;

const fixedPlayers = [
  { id: "player-1", name: "Werd" },
  { id: "player-2", name: "Wiki" },
  { id: "player-3", name: "Kamatori" },
  { id: "player-4", name: "𝓡𝓾𝓫𝔂𝓖𝓾𝓷" },
  { id: "player-5", name: "17400" },
];

const slotPrizes = [
  { id: "slot-hook", name: "Хук Пуджа", weight: 20, image: "assets/slot-hook.png" },
  { id: "slot-money-vacuum", name: "Деньгасос", weight: 20, image: "assets/slot-money-vacuum.png" },
  { id: "slot-double-dice", name: "Двойной кубик", weight: 20, image: "assets/slot-double-dice.png" },
  { id: "slot-iron-maiden", name: "Железная дева", weight: 20, image: "assets/slot-iron-maiden.png" },
  { id: "slot-helping-hand", name: "Рука помощи", weight: 20, image: "assets/slot-helping-hand.png" },
];

const defaultState = {
  players: fixedPlayers.map((player) => ({ ...player, balance: 0, inventory: [], currentGame: null, completedGames: [] })),
  shopItems: [
    { id: id(), name: "Подсказка", price: 120 },
    { id: id(), name: "Переброс кубика", price: 180 },
    { id: id(), name: "Защита от штрафа", price: 250 },
  ],
  slotCost: 100,
  prizes: structuredClone(slotPrizes),
  log: [],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

ensureDb();

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      serveStatic(req, res, url);
    } catch (error) {
      sendJson(res, 500, { error: "Ошибка сервера" });
      console.error(error);
    }
  })
  .listen(PORT, () => {
    console.log(`Казна игры: http://localhost:${PORT}`);
  });

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const state = readState();
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/players") {
    const state = readState();
    sendJson(res, 200, {
      players: state.players.map((player) => ({ id: player.id, name: player.name })),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/games/search") {
    const query = String(url.searchParams.get("q") || "").trim();
    if (query.length < 2) {
      sendJson(res, 200, { games: [] });
      return;
    }

    try {
      const results = await hltbService.hltb.search(query.split(" "));
      const games = results.data.slice(0, 6).map((game) => ({
        id: String(game.game_id),
        title: game.game_name,
        imageUrl: game.game_image ? `https://howlongtobeat.com/games/${game.game_image}` : "",
        mainHours: normalizeHours(Number(game.comp_main) / 3600),
        extraHours: normalizeHours(Number(game.comp_plus) / 3600),
        completionistHours: normalizeHours(Number(game.comp_100) / 3600),
        rating: Number.isFinite(Number(game.review_score)) ? Number(game.review_score) : null,
        releaseYear: Number.isFinite(Number(game.release_world)) && Number(game.release_world) > 0 ? Number(game.release_world) : null,
      }));
      sendJson(res, 200, { games });
    } catch (error) {
      console.error("HowLongToBeat search failed:", error.message);
      sendJson(res, 502, { error: "Не удалось получить игры с HowLongToBeat. Попробуйте ещё раз." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/player/me") {
    const state = readState();
    const player = requirePlayer(req, state);
    if (!player) {
      sendJson(res, 403, { error: "Нет доступа к профилю" });
      return;
    }
    sendJson(res, 200, { player: publicPlayer(player), shopItems: state.shopItems, slotCost: state.slotCost, prizes: state.prizes });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/player/buy") {
    const body = await readBody(req);
    const state = readState();
    const player = requirePlayer(req, state);
    const item = state.shopItems.find((shopItem) => shopItem.id === body.itemId);
    if (!player || !item) {
      sendJson(res, 403, { error: "Покупка недоступна" });
      return;
    }
    if (player.balance < item.price) {
      sendJson(res, 400, { error: "Не хватает монет" });
      return;
    }
    if (player.inventory.length >= INVENTORY_LIMIT) {
      sendJson(res, 400, { error: `Инвентарь заполнен: максимум ${INVENTORY_LIMIT} предметов` });
      return;
    }
    player.balance -= item.price;
    player.inventory.push(item.name);
    addLog(state, `${player.name} покупает "${item.name}" за ${formatMoney(item.price)}.`);
    writeState(state);
    sendJson(res, 200, { player: publicPlayer(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/player/spin") {
    const state = readState();
    const player = requirePlayer(req, state);
    if (!player) {
      sendJson(res, 403, { error: "Слот недоступен" });
      return;
    }
    if (player.balance < state.slotCost) {
      sendJson(res, 400, { error: "Не хватает монет" });
      return;
    }
    if (player.inventory.length >= INVENTORY_LIMIT) {
      sendJson(res, 400, { error: `Инвентарь заполнен: максимум ${INVENTORY_LIMIT} предметов` });
      return;
    }
    const prize = pickPrize(state.prizes);
    player.balance -= state.slotCost;
    player.inventory.push(prize.name);
    addLog(state, `${player.name} крутит слот за ${formatMoney(state.slotCost)} и выигрывает "${prize.name}".`);
    writeState(state);
    sendJson(res, 200, { player: publicPlayer(player), prize });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/money") {
    const body = await readBody(req);
    const amount = Number(body.amount);
    const state = readState();
    const player = state.players.find((item) => item.id === body.playerId);
    if (!player || !Number.isFinite(amount)) {
      sendJson(res, 400, { error: "Проверьте игрока и сумму" });
      return;
    }
    player.balance += amount;
    const verb = amount >= 0 ? "получает" : "тратит";
    addLog(state, `${player.name} ${verb} ${formatMoney(Math.abs(amount))}${body.reason ? `: ${body.reason}` : ""}.`);
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/game/current") {
    const body = await readBody(req);
    const state = readState();
    const player = state.players.find((item) => item.id === body.playerId);
    const title = String(body.title || "").trim();
    const hours = Number(body.hours);
    const points = Number(body.points);
    if (!player || !title || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(points) || points < 0) {
      sendJson(res, 400, { error: "Укажите игрока, игру, время и очки" });
      return;
    }
    player.currentGame = {
      id: id(),
      title,
      hours,
      points: Math.round(points),
      imageUrl: String(body.imageUrl || ""),
      rating: body.rating === null || body.rating === undefined || body.rating === "" || !Number.isFinite(Number(body.rating))
        ? null
        : Number(body.rating),
      releaseYear: body.releaseYear === null || body.releaseYear === undefined || body.releaseYear === "" || !Number.isFinite(Number(body.releaseYear))
        ? null
        : Number(body.releaseYear),
      elapsedSeconds: 0,
      timerRunning: false,
      timerStartedAt: null,
      startedAt: new Date().toISOString(),
    };
    addLog(state, `${player.name}: текущая игра "${title}" (${hours} ч., ${Math.round(points)} очков).`);
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/player/timer") {
    const body = await readBody(req);
    const state = readState();
    const player = requirePlayer(req, state);
    const action = String(body.action || "");
    if (!player || !player.currentGame) {
      sendJson(res, 400, { error: "У игрока нет текущей игры" });
      return;
    }
    if (action === "start") {
      startGameTimer(player.currentGame);
    } else if (action === "pause") {
      pauseGameTimer(player.currentGame);
    } else {
      sendJson(res, 400, { error: "Неизвестное действие таймера" });
      return;
    }
    writeState(state);
    sendJson(res, 200, { player: publicPlayer(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/game/complete") {
    const body = await readBody(req);
    const state = readState();
    const player = state.players.find((item) => item.id === body.playerId);
    if (!player || !player.currentGame) {
      sendJson(res, 400, { error: "У игрока нет текущей игры" });
      return;
    }
    finishCurrentGame(player, state, "completed");
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/player/game/finish") {
    const body = await readBody(req);
    const state = readState();
    const player = requirePlayer(req, state);
    const result = body.action === "drop" ? "dropped" : "completed";
    if (!player || !player.currentGame) {
      sendJson(res, 400, { error: "У игрока нет текущей игры" });
      return;
    }
    finishCurrentGame(player, state, result);
    writeState(state);
    sendJson(res, 200, { player: publicPlayer(player) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/item") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const price = Number(body.price);
    if (!name || !Number.isFinite(price) || price <= 0) {
      sendJson(res, 400, { error: "Укажите предмет и цену" });
      return;
    }
    const state = readState();
    state.shopItems.push({ id: id(), name, price });
    addLog(state, `В магазин добавлен предмет "${name}" за ${formatMoney(price)}.`);
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/slot-cost") {
    const body = await readBody(req);
    const value = Number(body.slotCost);
    if (!Number.isFinite(value) || value <= 0) {
      sendJson(res, 400, { error: "Укажите цену слота" });
      return;
    }
    const state = readState();
    state.slotCost = value;
    addLog(state, `Цена слот-машины изменена на ${formatMoney(value)}.`);
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/clear-log") {
    const state = readState();
    state.log = [];
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/reset") {
    const state = structuredClone(defaultState);
    writeState(state);
    sendJson(res, 200, publicState(state));
    return;
  }

  sendJson(res, 404, { error: "Не найдено" });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Не найдено");
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeState(defaultState);
  else writeState(normalizeState(readState()));
}

function readState() {
  const rawState = fs.readFileSync(DB_FILE, "utf8").replace(/^\uFEFF/, "");
  return normalizeState(JSON.parse(rawState));
}

function writeState(state) {
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function requirePlayer(req, state) {
  const number = Number(req.headers["x-player-number"]);
  return state.players[number - 1];
}

function publicState(state) {
  return {
    ...state,
    players: state.players.map(publicPlayer),
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    balance: player.balance,
    inventory: player.inventory,
    currentGame: publicGame(player.currentGame),
    completedGames: player.completedGames,
  };
}

function publicGame(game) {
  if (!game) return null;
  return {
    ...game,
    elapsedSeconds: getGameElapsedSeconds(game),
  };
}

function finishCurrentGame(player, state, result) {
  pauseGameTimer(player.currentGame);
  const completedGame = {
    ...player.currentGame,
    result,
    completedAt: new Date().toISOString(),
  };
  player.completedGames.unshift(completedGame);
  player.completedGames = player.completedGames.slice(0, 30);
  player.currentGame = null;

  if (result === "completed") {
    player.balance += completedGame.points;
    addLog(state, `${player.name} завершает "${completedGame.title}" и получает ${formatMoney(completedGame.points)}.`);
  } else {
    addLog(state, `${player.name} дропает "${completedGame.title}".`);
  }
}

function startGameTimer(game) {
  if (game.timerRunning) return;
  game.elapsedSeconds = getGameElapsedSeconds(game);
  game.timerRunning = true;
  game.timerStartedAt = new Date().toISOString();
}

function pauseGameTimer(game) {
  if (!game.timerRunning) return;
  game.elapsedSeconds = getGameElapsedSeconds(game);
  game.timerRunning = false;
  game.timerStartedAt = null;
}

function getGameElapsedSeconds(game) {
  const baseSeconds = Number.isFinite(Number(game.elapsedSeconds)) ? Number(game.elapsedSeconds) : 0;
  if (!game.timerRunning || !game.timerStartedAt) return Math.max(0, Math.floor(baseSeconds));

  const startedAt = Date.parse(game.timerStartedAt);
  if (!Number.isFinite(startedAt)) return Math.max(0, Math.floor(baseSeconds));

  return Math.max(0, Math.floor(baseSeconds + (Date.now() - startedAt) / 1000));
}

function addLog(state, text) {
  state.log.unshift({
    id: id(),
    text,
    time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  });
  state.log = state.log.slice(0, 80);
}

function pickPrize(prizes) {
  const totalWeight = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const prize of prizes) {
    roll -= prize.weight;
    if (roll <= 0) return prize;
  }
  return prizes.at(-1);
}

function formatMoney(amount) {
  return `${amount.toLocaleString("ru-RU")} монет`;
}

function normalizeHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 10) / 10 : null;
}

async function searchCurrentHowLongToBeat(searchTerms) {
  const baseHeaders = {
    "User-Agent": HLTB_USER_AGENT,
    Referer: "https://howlongtobeat.com/",
    Origin: "https://howlongtobeat.com",
  };
  const initResponse = await fetch(`${HLTB_ENDPOINT}/init?t=${Date.now()}`, { headers: baseHeaders });
  if (!initResponse.ok) throw new Error(`HLTB init request failed (${initResponse.status})`);

  const auth = await initResponse.json();
  if (!auth.token || !auth.hpKey || !auth.hpVal) throw new Error("HLTB did not return a search token");

  const payload = {
    searchType: "games",
    searchTerms,
    searchPage: 1,
    size: 6,
    searchOptions: {
      games: {
        userId: 0,
        platform: "",
        sortCategory: "popular",
        rangeCategory: "main",
        rangeTime: { min: null, max: null },
        gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
        rangeYear: { min: "", max: "" },
        modifier: "",
      },
      users: { sortCategory: "postcount" },
      lists: { sortCategory: "follows" },
      filter: "",
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
    [auth.hpKey]: auth.hpVal,
  };

  const searchResponse = await fetch(HLTB_ENDPOINT, {
    method: "POST",
    headers: {
      ...baseHeaders,
      "Content-Type": "application/json",
      "x-auth-token": auth.token,
      "x-hp-key": auth.hpKey,
      "x-hp-val": auth.hpVal,
    },
    body: JSON.stringify(payload),
  });
  if (!searchResponse.ok) throw new Error(`HLTB search request failed (${searchResponse.status})`);
  return searchResponse.json();
}

function id() {
  return crypto.randomUUID();
}

function normalizeState(state) {
  const existingPlayers = Array.isArray(state.players) ? state.players : [];
  return {
    ...structuredClone(defaultState),
    ...state,
    players: fixedPlayers.map((fixedPlayer, index) => {
      const existing = existingPlayers[index] || existingPlayers.find((player) => player.id === fixedPlayer.id) || {};
      return {
        id: fixedPlayer.id,
        name: fixedPlayer.name,
        balance: Number.isFinite(Number(existing.balance)) ? Number(existing.balance) : 0,
        inventory: Array.isArray(existing.inventory) ? existing.inventory : [],
        currentGame: normalizeGame(existing.currentGame),
        completedGames: Array.isArray(existing.completedGames) ? existing.completedGames.map(normalizeGame).filter(Boolean) : [],
      };
    }),
    shopItems: Array.isArray(state.shopItems) && state.shopItems.length ? state.shopItems : structuredClone(defaultState.shopItems),
    prizes: structuredClone(slotPrizes),
    log: Array.isArray(state.log) ? state.log : [],
  };
}

function normalizeGame(game) {
  if (!game || typeof game !== "object") return null;
  const normalized = { ...game };
  normalized.elapsedSeconds = Number.isFinite(Number(game.elapsedSeconds)) ? Math.max(0, Math.floor(Number(game.elapsedSeconds))) : 0;
  normalized.timerRunning = Boolean(game.timerRunning);
  normalized.timerStartedAt = normalized.timerRunning && game.timerStartedAt ? String(game.timerStartedAt) : null;
  return normalized;
}
