// 纯逻辑单测：node web/src/editor/paint.test.js（web 包需 type: module）
import { strict as assert } from "node:assert";
import {
  addLayer,
  composite,
  countOpaque,
  createDoc,
  deleteLayer,
  deserialize,
  getPixel,
  mergeDown,
  mergeVisible,
  moveLayer,
  moveLayerTo,
  insertLayerAbove,
  overPixel,
  serialize,
  setPixel,
  snapshot,
  restore,
} from "./doc.js";
import {
  ellipsePoints,
  floodFill,
  linePoints,
  coverOf,
  hsvToRgb,
  rgbToHsv,
  rgbToHex,
  pixelPerfectErase,
  rectPoints,
  rotate90CW,
  stampPixels,
} from "./paint.js";

// 直线
assert.deepEqual(linePoints(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
assert.equal(linePoints(0, 0, 2, 2).length, 3);

// 矩形：空心 3x3 = 8 点，实心 = 9 点
assert.equal(rectPoints(0, 0, 2, 2, false).length, 8);
assert.equal(rectPoints(0, 0, 2, 2, true).length, 9);

// 椭圆实心包含中心
const el = ellipsePoints(4, 4, 3, 2, true);
assert.ok(el.some(([x, y]) => x === 4 && y === 4));

// 笔刷：方形 2x2 = 4 点；圆形 3x3（四角 hypot 1.41 ≤ 半径 1.5，保留）= 9 点
assert.equal(stampPixels(5, 5, 2, false).length, 4);
assert.equal(stampPixels(5, 5, 3, true).length, 9);
assert.equal(stampPixels(5, 5, 1, true).length, 1);

// 填充：32x32 全透明画布从 (0,0) 填 = 1024；透明起点只填透明区（63，不吞 RGB 相近的不透明像素）
const doc = createDoc(32, 32);
assert.equal(floodFill(doc, 0, 0, 0, [255, 0, 0, 255], 0), 1024);
const red = [255, 0, 0, 255];
const docA = createDoc(8, 8);
setPixel(docA, 0, 3, 3, [8, 0, 0, 255]);
assert.equal(floodFill(docA, 0, 0, 0, red, 10), 63);
assert.deepEqual(getPixel(docA, 0, 3, 3), [8, 0, 0, 255]);
const docB = createDoc(8, 8);
setPixel(docB, 0, 3, 3, [8, 0, 0, 255]);
assert.equal(floodFill(docB, 0, 0, 0, red, 2), 63);
// 容差对不透明区仍有效：5 色差像素被一起填掉
const docT = createDoc(8, 8);
for (let y = 0; y < 8; y++)
  for (let x = 0; x < 8; x++) setPixel(docT, 0, x, y, [200, 0, 0, 255]);
setPixel(docT, 0, 3, 3, [205, 0, 0, 255]);
assert.equal(floodFill(docT, 0, 0, 0, [0, 0, 255, 255], 10), 64);

// 回归：已涂色区域用容差内近似色填充必须立即返回，不能死循环
const docC = createDoc(32, 32);
for (let y = 0; y < 32; y++)
  for (let x = 0; x < 32; x++) setPixel(docC, 0, x, y, [200, 0, 0, 255]);
assert.equal(floodFill(docC, 0, 0, 0, [205, 0, 0, 255], 10), 0);
// 回归：同色填充返回 0 且画布不变
assert.equal(floodFill(docC, 0, 0, 0, [200, 0, 0, 255], 0), 0);
assert.deepEqual(getPixel(docC, 0, 5, 5), [200, 0, 0, 255]);
// 回归：已涂色区域用容差外颜色填充正常结束（32x32 全填 = 1024）
assert.equal(floodFill(docC, 0, 0, 0, [0, 0, 255, 255], 10), 1024);
// 回归：橡皮擦过的地方油漆桶可浇，且不串色到未擦过的同色区
const docE = createDoc(16, 16);
for (let y = 0; y < 16; y++)
  for (let x = 0; x < 16; x++) setPixel(docE, 0, x, y, [255, 0, 0, 255]);
for (let y = 0; y < 16; y++)
  for (let x = 0; x < 8; x++) overPixel(docE, 0, x, y, [0, 0, 0, 0], 1);
assert.deepEqual(getPixel(docE, 0, 2, 2), [0, 0, 0, 0]);
assert.equal(floodFill(docE, 0, 2, 2, [0, 0, 255, 255], 10), 128);
assert.deepEqual(getPixel(docE, 0, 2, 2), [0, 0, 255, 255]);
assert.deepEqual(getPixel(docE, 0, 10, 2), [255, 0, 0, 255]);
// 回归：半透明色块可用同色油漆桶覆盖（alpha 不同不算白填）；盖完再盖才是白填
const docS = createDoc(8, 8);
for (let y = 0; y < 8; y++)
  for (let x = 0; x < 8; x++) setPixel(docS, 0, x, y, [255, 0, 0, 128]);
assert.equal(floodFill(docS, 0, 0, 0, [255, 0, 0, 255], 10), 64);
assert.deepEqual(getPixel(docS, 0, 0, 0), [255, 0, 0, 255]);
assert.equal(floodFill(docS, 0, 4, 4, [255, 0, 0, 255], 10), 0);

// 图层：在当前层上方插入新层；拖动排序搬层，选中跟随被搬的层
const docL = createDoc(4, 4);
addLayer(docL); // [图层 1, 图层 2]，选中顶层
docL.active = 0; // 选中底层
assert.equal(insertLayerAbove(docL, 0), 1);
assert.deepEqual(docL.layers.map((l) => l.name), ["图层 1", "图层 3", "图层 2"]);
assert.equal(docL.active, 1);
assert.equal(moveLayerTo(docL, 0, 2), true); // 底层搬到顶
assert.deepEqual(docL.layers.map((l) => l.name), ["图层 3", "图层 2", "图层 1"]);
assert.equal(docL.active, 0); // 原选中层（图层 3）跟随到新下标
docL.active = 2; // 改选被搬的图层 1
assert.equal(moveLayerTo(docL, 2, 0), true); // 再搬到底
assert.deepEqual(docL.layers.map((l) => l.name), ["图层 1", "图层 3", "图层 2"]);
assert.equal(docL.active, 0); // 选中跟随被搬层
assert.equal(moveLayerTo(docL, 1, 1), false); // 原地不动
assert.equal(moveLayerTo(docL, 5, 0), false); // 越界不动

// Pixel Perfect：直角拐擦拐角，直线不擦
assert.deepEqual(pixelPerfectErase([[0, 0], [1, 0], [1, 1]]), [1, 0]);
assert.equal(pixelPerfectErase([[0, 0], [1, 0], [2, 0]]), null);
assert.equal(pixelPerfectErase([[0, 0]]), null);

// 快照 / 恢复 / 序列化往返
const doc3 = createDoc(4, 4);
setPixel(doc3, 0, 1, 1, [1, 2, 3, 255]);
const snap = snapshot(doc3);
setPixel(doc3, 0, 2, 2, [9, 9, 9, 255]);
restore(doc3, snap);
assert.deepEqual(getPixel(doc3, 0, 2, 2), [0, 0, 0, 0]);
assert.deepEqual(getPixel(doc3, 0, 1, 1), [1, 2, 3, 255]);
const doc4 = deserialize(serialize(doc3));
assert.deepEqual(getPixel(doc4, 0, 1, 1), [1, 2, 3, 255]);
assert.equal(countOpaque(composite(doc4)), 1);

// 旋转：4x2 画布转成 2x4，像素不错位
const doc5 = createDoc(4, 2);
setPixel(doc5, 0, 3, 0, [7, 7, 7, 255]);
rotate90CW(doc5);
assert.equal(doc5.w, 2);
assert.equal(doc5.h, 4);
assert.deepEqual(getPixel(doc5, 0, 1, 3), [7, 7, 7, 255]);

// 混合模式：红正片叠底绿 = 黑；白叠加中灰 = 白
const doc6 = createDoc(2, 2);
doc6.layers[0].pixels.fill(0);
setPixel(doc6, 0, 0, 0, [0, 255, 0, 255]);
addLayer(doc6);
setPixel(doc6, 1, 0, 0, [255, 0, 0, 255]);
doc6.layers[1].blend = "multiply";
let px = composite(doc6);
assert.deepEqual([px[0], px[1], px[2], px[3]], [0, 0, 0, 255]);
doc6.layers[0].pixels.fill(0);
setPixel(doc6, 0, 0, 0, [128, 128, 128, 255]);
setPixel(doc6, 1, 0, 0, [255, 255, 255, 255]);
doc6.layers[1].blend = "overlay";
px = composite(doc6);
assert.deepEqual([px[0], px[1], px[2], px[3]], [255, 255, 255, 255]);

// 图层操作：上限 8、移动、删除、向下合并
const doc7 = createDoc(4, 4);
for (let i = 0; i < 10; i++) addLayer(doc7);
assert.equal(doc7.layers.length, 8);
assert.equal(addLayer(doc7), -1);
assert.equal(moveLayer(doc7, 7, -1), true);
assert.equal(doc7.active, 6);
assert.equal(deleteLayer(doc7, 0), true);
assert.equal(doc7.layers.length, 7);
setPixel(doc7, 1, 0, 0, [255, 0, 0, 255]);
assert.equal(mergeDown(doc7, 1), true);
assert.equal(doc7.layers.length, 6);
assert.deepEqual(getPixel(doc7, 0, 0, 0), [255, 0, 0, 255]);
assert.equal(mergeDown(doc7, 0), false);

// 笔刷不透明度：半透明橡皮只擦掉一半 alpha
const doc8 = createDoc(2, 2);
setPixel(doc8, 0, 0, 0, [10, 20, 30, 255]);
overPixel(doc8, 0, 0, 0, [0, 0, 0, 0], 0.5);
assert.ok(Math.abs(getPixel(doc8, 0, 0, 0)[3] - 128) <= 1);
overPixel(doc8, 0, 1, 1, [255, 0, 0, 255], 0.5);
assert.ok(Math.abs(getPixel(doc8, 0, 1, 1)[3] - 128) <= 1);

// 合并可见：隐藏层不动，可见层合成进最底层
const doc9 = createDoc(2, 2);
setPixel(doc9, 0, 0, 0, [0, 255, 0, 255]);
addLayer(doc9);
setPixel(doc9, 1, 0, 0, [255, 0, 0, 255]);
addLayer(doc9);
setPixel(doc9, 2, 0, 0, [0, 0, 255, 255]);
doc9.layers[1].visible = false;
assert.equal(mergeVisible(doc9), true);
assert.equal(doc9.layers.length, 2); // 底 + 隐藏层
assert.deepEqual(getPixel(doc9, 0, 0, 0), [0, 0, 255, 255]); // 蓝盖在绿上
assert.deepEqual(getPixel(doc9, 1, 0, 0), [255, 0, 0, 255]); // 隐藏的红还在

// 性能：64x64x8 层合成 20 次，每次应远小于 16ms
const docP = createDoc(64, 64);
for (let i = 0; i < 7; i++) addLayer(docP);
for (const l of docP.layers) l.pixels.fill(128);
const t0 = Date.now();
for (let i = 0; i < 20; i++) composite(docP);
const per = (Date.now() - t0) / 20;
console.log(`COMPOSITE_64x64x8: ${per.toFixed(2)}ms`);
assert.ok(per < 16, `too slow: ${per}ms`);

// 封面：64x64 压到 48x48，颜色抽样正确
const covPx = new Uint8ClampedArray(64 * 64 * 4);
covPx.fill(255);
const cov = coverOf(covPx, 64, 64);
assert.equal(cov.w, 48);
assert.equal(cov.h, 48);
assert.ok(cov.data.length > 100);

// HSV 往返：红绿蓝白黑 + 随机抽查
assert.deepEqual(hsvToRgb(0, 1, 1), [255, 0, 0]);
assert.deepEqual(hsvToRgb(1 / 3, 1, 1), [0, 255, 0]);
assert.deepEqual(hsvToRgb(2 / 3, 1, 1), [0, 0, 255]);
assert.deepEqual(hsvToRgb(0, 0, 1), [255, 255, 255]);
assert.deepEqual(hsvToRgb(0, 0, 0), [0, 0, 0]);
for (const [r, g, b] of [[255, 77, 109], [139, 92, 246], [62, 213, 152], [43, 43, 43]]) {
  const [h, s, v] = rgbToHsv(r, g, b);
  const [r2, g2, b2] = hsvToRgb(h, s, v);
  assert.ok(Math.abs(r - r2) <= 1 && Math.abs(g - g2) <= 1 && Math.abs(b - b2) <= 1, `roundtrip ${r},${g},${b}`);
}
assert.equal(rgbToHex(255, 77, 109), "#ff4d6d");

// 合成：最底层正片叠底/叠加对透明背底不再变黑
{
  const d = createDoc(4, 4);
  d.layers[0].blend = "multiply";
  setPixel(d, 0, 1, 1, [255, 0, 0, 255]);
  const m = composite(d);
  const i = (1 * 4 + 1) * 4;
  assert.deepEqual([m[i], m[i + 1], m[i + 2], m[i + 3]], [255, 0, 0, 255]);
  d.layers[0].blend = "overlay";
  const m2 = composite(d);
  assert.deepEqual([m2[i], m2[i + 1], m2[i + 2], m2[i + 3]], [255, 0, 0, 255]);
  // 上层正片叠底仍正常混合（红 × 蓝 = 黑，行为保留）
  addLayer(d, "上");
  setPixel(d, 1, 1, 1, [0, 0, 255, 255]);
  d.layers[1].blend = "multiply";
  const m3 = composite(d);
  assert.deepEqual([m3[i], m3[i + 1], m3[i + 2], m3[i + 3]], [0, 0, 0, 255]);
}

console.log("PAINT_TEST_OK");
