export function petScale(canvasWidth, canvasHeight, minSize = 64, maxSize = 128) {
  const dimension = Math.max(1, Math.min(Number(canvasWidth) || 1, Number(canvasHeight) || 1));
  return Math.min(maxSize, Math.max(minSize, dimension * 2));
}

export function petFacing(baseFlip, movingLeft) {
  return (movingLeft !== baseFlip) ? 1 : 0;
}

// 草稿封面（服务端存的 {w,h,data: base64 RGBA} JSON）转 <img> 可用的 dataURL；坏数据返回 ""
export function coverToThumbURL(cover) {
  try {
    const o = typeof cover === "string" ? JSON.parse(cover) : cover;
    if (!o || !o.data || !(o.w >= 1) || !(o.h >= 1)) return "";
    const bin = atob(String(o.data));
    const u8 = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const cv = document.createElement("canvas");
    cv.width = o.w;
    cv.height = o.h;
    cv.getContext("2d").putImageData(new ImageData(u8, o.w, o.h), 0, 0);
    return cv.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function togglePetFlip(run) {
  const nextFlip = run?.dataset.baseFlip !== "1";
  if (run) run.dataset.baseFlip = String(Number(nextFlip));
  return nextFlip;
}

function randomRange(random, min, max) {
  return min + Math.max(0, Math.min(1, random())) * (max - min);
}

export function jumpPet(run, now = performance.now()) {
  if (!run || now < (run.jumpUntil || 0)) return false;
  run.jumpUntil = now + 650;
  return true;
}

export function petStep(state, now, dt, max, random = Math.random) {
  const next = { ...state };
  if (now < next.jumpUntil) {
    next.state = "jump";
    return next;
  }
  if (now < next.restUntil) {
    next.state = "rest";
    return next;
  }

  next.state = "walk";
  if (!Number.isFinite(next.speed) || next.speed <= 0) next.speed = 0.045;
  if (!Number.isFinite(next.speedUntil) || now >= next.speedUntil) {
    next.speed = random() < 0.5 ? 0.025 : 0.075;
    next.speedUntil = now + randomRange(random, 1800, 5000);
  }

  next.x += next.dir * dt * next.speed;
  const hitEdge = next.x <= 8 || next.x >= max;
  if (hitEdge) {
    next.x = Math.min(max, Math.max(8, next.x));
    next.dir *= -1;
    if (random() < 0.3) {
      next.restUntil = now + randomRange(random, 1200, 6000);
      next.state = "rest";
      return next;
    }
  }
  if (random() < 0.0008) {
    next.restUntil = now + randomRange(random, 1200, 6000);
    next.state = "rest";
  }
  return next;
}

export function wirePet(run, { random = Math.random, initialState } = {}) {
  const facing = run?.querySelector(".pet-facing");
  const pet = facing?.querySelector(".pet-sprite");
  if (!run || !facing || !pet || run._pet) return;
  run._pet = true;
  const canvasWidth = Number(run.dataset.canvasWidth);
  const canvasHeight = Number(run.dataset.canvasHeight);
  const size = petScale(canvasWidth, canvasHeight);
  run.style.setProperty("--pet-size", `${size}px`);
  run.style.height = `${size + 12}px`;
  facing.style.width = `${size}px`;
  facing.style.height = `${size}px`;
  pet.style.width = `${size}px`;
  pet.style.height = `${size}px`;
  let motion = initialState || { x: 8, dir: 1, restUntil: 0, jumpUntil: 0, speed: 0.045, speedUntil: 0 };
  let last = performance.now();
  pet.draggable = false;
  pet.addEventListener("dragstart", (event) => event.preventDefault());
  pet.addEventListener("click", () => {
    if (jumpPet(run)) motion.jumpUntil = run.jumpUntil;
  });
  const step = (now) => {
    if (!run.isConnected) return;
    const dt = Math.min(40, now - last);
    last = now;
    const max = Math.max(8, run.clientWidth - facing.offsetWidth - 8);
    motion = petStep(motion, now, dt, max, random);
    run.dataset.state = motion.state;
    const baseFlip = run.dataset.baseFlip === "1";
    facing.dataset.flip = String(petFacing(baseFlip, motion.dir < 0));
    facing.style.transform = facing.dataset.flip === "1" ? "scaleX(-1)" : "scaleX(1)";
    if (motion.state === "jump") {
      const box = run.getBoundingClientRect();
      facing.style.position = "fixed";
      facing.style.zIndex = "40";
      facing.style.left = `${box.left + motion.x}px`;
      facing.style.top = `${box.bottom - size - 2}px`;
    } else {
      facing.style.position = "";
      facing.style.zIndex = "";
      facing.style.top = "";
      facing.style.left = `${motion.x}px`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

