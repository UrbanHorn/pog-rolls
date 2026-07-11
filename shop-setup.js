const shopPlayerNumber = Number(new URLSearchParams(window.location.search).get("player"));
const validPlayerNumber = Number.isInteger(shopPlayerNumber) && shopPlayerNumber >= 1 && shopPlayerNumber <= 5 ? shopPlayerNumber : 1;

document.body.dataset.playerNumber = String(validPlayerNumber);
document.querySelector("#backToProfile").href = `player-${validPlayerNumber}.html`;
