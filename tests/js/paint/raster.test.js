import test from 'node:test';
import assert from 'node:assert/strict';
import { createImage, validateSize, floodMask, invertColors, borderBackgroundMask, rotate90, rotate180, flip, crop, maskBounds, contentBounds, skewSize, constrainRect, snapAngle, linePoints, clipRect, MAX_SIDE } from '../../../app/js/paint/core/raster.js';

const px = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

function numbered(w, h) {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([i, i * 2, i * 3, 255], i * 4);
  return img;
}

test('raster: tamanho válido, recusa zero, negativo e acima do limite', () => {
  assert.deepEqual(validateSize(10.4, 3), { width: 10, height: 3 });
  assert.throws(() => validateSize(0, 5));
  assert.throws(() => validateSize(-3, 5));
  assert.throws(() => validateSize(MAX_SIDE + 1, 5));
  assert.throws(() => validateSize(12000, 12000));
  assert.throws(() => validateSize('abc', 5));
});

test('raster: balde respeita bordas, tolerância e modo não contíguo', () => {
  const img = createImage(5, 5, [255, 255, 255, 255]);
  for (let y = 0; y < 5; y++) img.data.set([0, 0, 0, 255], (y * 5 + 2) * 4);
  img.data.set([250, 250, 250, 255], (0 * 5 + 0) * 4);
  const exact = floodMask(img, 1, 1);
  assert.equal(exact.count, 9);
  assert.deepEqual(exact.bounds, { x: 0, y: 0, width: 2, height: 5 });
  assert.equal(floodMask(img, 1, 1, { tolerance: 5 }).count, 10);
  assert.equal(floodMask(img, 1, 1, { tolerance: 5, contiguous: false }).count, 20);
  assert.equal(floodMask(img, 9, 9).count, 0);
});

test('raster: inverter cores mantém o alfa e respeita a máscara', () => {
  const img = createImage(2, 1, [10, 20, 30, 128]);
  invertColors(img, Uint8Array.from([1, 0]));
  assert.deepEqual(px(img, 0, 0), [245, 235, 225, 128]);
  assert.deepEqual(px(img, 1, 0), [10, 20, 30, 128]);
});

test('raster: fundo encostado nas bordas é detectado e o miolo fica', () => {
  const img = createImage(6, 6, [255, 255, 255, 255]);
  for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) img.data.set([200, 0, 0, 255], (y * 6 + x) * 4);
  const mask = borderBackgroundMask(img, 10);
  assert.equal(mask.reduce((a, b) => a + b, 0), 32);
  assert.equal(mask[2 * 6 + 2], 0);
});

test('raster: girar e virar preservam os pixels', () => {
  const img = numbered(3, 2);
  const right = rotate90(img, true);
  assert.equal(right.width, 2);
  assert.equal(right.height, 3);
  assert.deepEqual(px(right, 1, 0), px(img, 0, 0));
  const back = rotate90(rotate90(rotate90(right, true), true), true);
  assert.deepEqual(Array.from(back.data), Array.from(img.data));
  assert.deepEqual(Array.from(rotate180(rotate180(img)).data), Array.from(img.data));
  assert.deepEqual(px(flip(img, 'horizontal'), 0, 0), px(img, 2, 0));
  assert.deepEqual(px(flip(img, 'vertical'), 0, 0), px(img, 0, 1));
});

test('raster: recorte fora da imagem fica transparente', () => {
  const img = numbered(3, 3);
  const c = crop(img, 2, 2, 2, 2);
  assert.deepEqual(px(c, 0, 0), px(img, 2, 2));
  assert.deepEqual(px(c, 1, 1), [0, 0, 0, 0]);
});

test('raster: limites da máscara e do conteúdo', () => {
  const mask = new Uint8Array(16);
  assert.equal(maskBounds(mask, 4, 4), null);
  mask[5] = 1;
  mask[10] = 1;
  assert.deepEqual(maskBounds(mask, 4, 4), { x: 1, y: 1, width: 2, height: 2 });
  const img = createImage(4, 4);
  img.data[(3 * 4 + 3) * 4 + 3] = 255;
  assert.deepEqual(contentBounds(img), { x: 3, y: 3, width: 1, height: 1 });
});

test('raster: geometria de formas, ângulo de 45° e linha sem buracos', () => {
  assert.deepEqual(constrainRect(10, 10, 4, 30, { square: true }), { x: -10, y: 10, width: 20, height: 20 });
  assert.deepEqual(constrainRect(10, 10, 14, 13, { fromCenter: true }), { x: 6, y: 7, width: 8, height: 6 });
  assert.deepEqual(snapAngle(0, 0, 10, 1), { x: 10, y: 0 });
  const p = snapAngle(0, 0, 10, 9);
  assert.equal(p.x, p.y);
  const pts = [];
  linePoints(0, 0, 7, 3, (x, y) => pts.push([x, y]));
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts.at(-1), [7, 3]);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) <= 1 && Math.abs(pts[i][1] - pts[i - 1][1]) <= 1);
  assert.deepEqual(clipRect({ x: -5, y: 2, width: 10, height: 100 }, 20, 20), { x: 0, y: 2, width: 5, height: 18 });
  assert.equal(clipRect({ x: 30, y: 2, width: 10, height: 10 }, 20, 20), null);
  const skew = skewSize(100, 50, 45, 0);
  assert.equal(skew.width, 150);
  assert.equal(skew.height, 50);
});
