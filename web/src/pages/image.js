// canvas/图像小工具（无依赖叶节点）
export function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export function canvasToB64(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("encode"));
      resolve(await blobToB64(blob));
    });
  });
}

export function extractPalette(pixels) {
  const count = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    count.set(key, (count.get(key) || 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k]) => `#${k.toString(16).padStart(6, "0")}`);
}
