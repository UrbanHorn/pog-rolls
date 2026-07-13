const shopPlayerNumber = Number(new URLSearchParams(window.location.search).get("player"));
const validPlayerNumber = Number.isInteger(shopPlayerNumber) && shopPlayerNumber >= 1 && shopPlayerNumber <= 5 ? shopPlayerNumber : 1;

document.body.dataset.playerNumber = String(validPlayerNumber);
document.querySelector("#backToProfile").href = `player-${validPlayerNumber}.html`;

const traderGreetings = Array.from(
  { length: 6 },
  (_, index) => `assets/trader-greeting-${index + 1}.ogg`,
);
const traderGreeting = new Audio(
  traderGreetings[Math.floor(Math.random() * traderGreetings.length)],
);
const shopTrader = document.querySelector("#shopTrader");
const traderMouthFrames = [1, 2, 3, 2].map(
  (frame) => `assets/trader-talk-${frame}.png`,
);
let mouthFrameIndex = 0;
let mouthAnimationTimer;

traderGreeting.preload = "auto";
traderMouthFrames.forEach((source) => {
  const image = new Image();
  image.src = source;
});

function animateTraderMouth() {
  shopTrader.src = traderMouthFrames[mouthFrameIndex];
  mouthFrameIndex = (mouthFrameIndex + 1) % traderMouthFrames.length;
  mouthAnimationTimer = window.setTimeout(animateTraderMouth, 85 + Math.random() * 80);
}

function startTraderMouthAnimation() {
  window.clearTimeout(mouthAnimationTimer);
  mouthFrameIndex = 0;
  animateTraderMouth();
}

function stopTraderMouthAnimation() {
  window.clearTimeout(mouthAnimationTimer);
  mouthFrameIndex = 0;
  shopTrader.src = traderMouthFrames[0];
}

traderGreeting.addEventListener("play", startTraderMouthAnimation);
traderGreeting.addEventListener("pause", stopTraderMouthAnimation);
traderGreeting.addEventListener("ended", stopTraderMouthAnimation);
traderGreeting.addEventListener("error", stopTraderMouthAnimation);

const monitorArrows = document.querySelector("#monitorArrows");
const monitorArrowFrames = Array.from(
  { length: 4 },
  (_, index) => `assets/monitor-arrows-${index + 1}.png`,
);
let monitorArrowFrameIndex = 0;
let monitorArrowAnimationTimer;

monitorArrowFrames.forEach((source) => {
  const image = new Image();
  image.src = source;
});

function advanceMonitorArrows() {
  monitorArrowFrameIndex = (monitorArrowFrameIndex + 1) % monitorArrowFrames.length;
  monitorArrows.src = monitorArrowFrames[monitorArrowFrameIndex];
}

function startMonitorArrowAnimation() {
  if (monitorArrowAnimationTimer) return;
  monitorArrowAnimationTimer = window.setInterval(advanceMonitorArrows, 110);
}

function stopMonitorArrowAnimation() {
  window.clearInterval(monitorArrowAnimationTimer);
  monitorArrowAnimationTimer = undefined;
}

monitorArrows.addEventListener("pointerenter", startMonitorArrowAnimation);
monitorArrows.addEventListener("pointerleave", stopMonitorArrowAnimation);

async function playTraderGreeting() {
  try {
    await traderGreeting.play();
    removeGreetingFallback();
  } catch {
    // Browsers can block sound until the visitor interacts with the page.
  }
}

function removeGreetingFallback() {
  document.removeEventListener("pointerdown", playTraderGreeting);
  document.removeEventListener("keydown", playTraderGreeting);
}

document.addEventListener("pointerdown", playTraderGreeting, { once: true });
document.addEventListener("keydown", playTraderGreeting, { once: true });
playTraderGreeting();
