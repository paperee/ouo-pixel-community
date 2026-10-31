import { strict as assert } from "node:assert";
import { jumpPet, petFacing, petScale, petStep, togglePetFlip, wirePet } from "./pet.js";

assert.equal(petFacing(false, false), 0);
assert.equal(petFacing(false, true), 1);
assert.equal(petFacing(true, true), 0);
assert.equal(petFacing(true, false), 1);
// 宠物大小与画布成比例：取最短边 ×2，最小 64 起，最大 128 封顶
assert.equal(petScale(32, 32), 64);
assert.equal(petScale(64, 64), 128);
assert.equal(petScale(16, 16), 64);
assert.equal(petScale(128, 128), 128);
assert.equal(petScale(32, 64), 64);
assert.equal(petScale(0, 0), 64);
const flipSettings = { dataset: { baseFlip: "0" } };
assert.equal(togglePetFlip(flipSettings), true);
assert.equal(flipSettings.dataset.baseFlip, "1");
assert.equal(togglePetFlip(flipSettings), false);
assert.equal(flipSettings.dataset.baseFlip, "0");

const pacedWalk = petStep({ x: 10, dir: 1, restUntil: 0, speed: 0.045, speedUntil: 2000 }, 1000, 100, 200, () => 1);
assert.ok(Math.abs(pacedWalk.x - 14.5) < 1e-9);
assert.equal(pacedWalk.speed, 0.045);

const fastPace = petStep({ x: 10, dir: 1, restUntil: 0, speed: 0.09, speedUntil: 3000 }, 1000, 100, 200, () => 1);
assert.ok(Math.abs(fastPace.x - 19) < 1e-9);
assert.equal(fastPace.speed, 0.09);

const expiredPace = petStep({ x: 10, dir: 1, restUntil: 0, speed: 0.09, speedUntil: 900 }, 1000, 100, 200, () => 0.1);
assert.ok(Math.abs(expiredPace.x - 12.5) < 1e-9);
assert.equal(expiredPace.speed, 0.025);
assert.ok(expiredPace.speedUntil > 1000);

const randomPause = petStep({ x: 10, dir: 1, restUntil: 0, jumpUntil: 0, speed: 0.045, speedUntil: 9000 }, 1000, 100, 200, (() => { let calls = 0; return () => (++calls === 2 ? 0 : 0); })());
assert.equal(randomPause.state, "rest");
assert.ok(randomPause.x > 10);
assert.ok(randomPause.restUntil > 1000);
assert.ok(randomPause.restUntil <= 1000 + 6000);

const landed = { jumpUntil: 500 };
assert.equal(jumpPet(landed, 1000), true);
assert.ok(landed.jumpUntil > 1000);
assert.equal(jumpPet(landed, 1100), false);
assert.ok(landed.jumpUntil > 1100);

const walked = petStep({ x: 10, dir: 1, restUntil: 0, speed: 0.045, speedUntil: 2000 }, 1000, 100, 200, () => 1);
assert.equal(walked.state, "walk");
assert.ok(walked.x > 10);
assert.equal(walked.dir, 1);

const bounced = petStep({ x: 196, dir: 1, restUntil: 0, speed: 0.045, speedUntil: 2000 }, 1000, 100, 200, () => 0);
assert.equal(bounced.x, 200);
assert.equal(bounced.dir, -1);
assert.ok(bounced.restUntil > 1000 && bounced.restUntil <= 7000);

const resting = petStep({ x: 40, dir: -1, restUntil: 5000, jumpUntil: 0, speed: 0.045, speedUntil: 9000 }, 1000, 100, 200, () => 0);
assert.equal(resting.state, "rest");
assert.equal(resting.x, 40);
assert.equal(resting.dir, -1);
const jumpedDuringRest = petStep({ ...resting, jumpUntil: 1650 }, 1100, 16, 200, () => 1);
assert.equal(jumpedDuringRest.state, "jump");
assert.equal(jumpedDuringRest.x, resting.x);

const resumed = petStep(resting, 5000, 100, 200, () => 1);
assert.equal(resumed.state, "walk");
assert.equal(resumed.x, 35.5);
assert.equal(resumed.dir, -1);

let now = 0;
const frames = [];
const mkStyle = () => ({ setProperty(k, v) { this[k] = v; } });
const pet = { offsetWidth: 36, style: mkStyle(), addEventListener() {} };
const facing = { offsetWidth: 36, dataset: {}, style: mkStyle(), querySelector: () => pet };
const run = {
  dataset: { baseFlip: "0", canvasWidth: "32", canvasHeight: "32" },
  style: mkStyle(),
  clientWidth: 300,
  isConnected: true,
  addEventListener() {},
  querySelector: (selector) => selector === ".pet-facing" ? facing : pet,
};
globalThis.window = { matchMedia: () => ({ matches: true }) };
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
wirePet(run, { random: () => 1, initialState: { x: 255, dir: 1, restUntil: 0 } });
for (let i = 0; i < 3; i += 1) {
  now += 40;
  frames.shift()(now);
}
assert.equal(run.dataset.baseFlip, "0");
assert.equal(facing.dataset.flip, "1");
assert.ok(Number.parseFloat(facing.style.left) < 256);
assert.equal(facing.style.transform, "scaleX(-1)");
assert.equal(togglePetFlip(run), true);
now += 40;
frames.shift()(now);
assert.equal(run.dataset.baseFlip, "1");
assert.equal(facing.dataset.flip, "0");
assert.equal(facing.style.transform, "scaleX(1)");
assert.ok(Number.parseFloat(facing.style.left) < 256);
// 32x32 画布 → 宠物 64px，跑道高度跟着撑开
assert.equal(facing.style.width, "64px");
assert.equal(pet.style.width, "64px");
assert.equal(run.style["--pet-size"], "64px");
assert.ok(Number.parseFloat(run.style.height) >= 64);

const interactivePet = { style: {}, draggable: true, addEventListener(type, handler) { this.handlers ??= {}; this.handlers[type] = handler; } };
const interactiveFacing = { offsetWidth: 36, dataset: {}, style: mkStyle(), querySelector: () => interactivePet };
const interactiveRun = {
  dataset: { baseFlip: "0", canvasWidth: "32", canvasHeight: "32" },
  style: mkStyle(),
  clientWidth: 300,
  isConnected: true,
  getBoundingClientRect: () => ({ left: 40, top: 120, bottom: 196, right: 340, width: 300, height: 76 }),
  addEventListener() {},
  querySelector: (selector) => selector === ".pet-facing" ? interactiveFacing : interactivePet,
};
const interactiveFrameIndex = frames.length;
wirePet(interactiveRun, { random: () => 1, initialState: { x: 20, dir: 1, restUntil: 0, jumpUntil: 0, speed: 0.045, speedUntil: 10000 } });
assert.equal(interactivePet.draggable, false);
let prevented = false;
interactivePet.handlers.dragstart({ preventDefault() { prevented = true; } });
assert.equal(prevented, true);
interactivePet.handlers.click();
const first = frames[interactiveFrameIndex];
now += 16;
first(now);
assert.equal(interactiveRun.dataset.state, "jump");
assert.ok(interactiveRun.jumpUntil > now);
assert.equal(interactiveFacing.style.position, "fixed");
assert.equal(interactiveFacing.style.zIndex, "40");
assert.ok(interactiveFacing.style.top);
now += 700;
first(now);
assert.equal(interactiveRun.dataset.state, "walk");
assert.equal(interactiveFacing.style.position, "");
assert.equal(interactiveFacing.style.zIndex, "");
