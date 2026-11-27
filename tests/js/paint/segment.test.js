import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentObject, refineEdges, applyMatte, normalizeRect } from '../../../app/js/paint/core/segment.js';

function scene({ width = 200, height = 150, cx = 100.3, cy = 75.6, r = 45, fg = [30, 110, 200], noise = 8, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const data = new Uint8ClampedArray(width * height * 4);
  const coverage = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let c = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if ((x + (sx + 0.5) / 4 - cx) ** 2 + (y + (sy + 0.5) / 4 - cy) ** 2 < r * r) c++;
      c /= 16;
      coverage[y * width + x] = c;
      const bg = [235 + (rnd() - 0.5) * noise, 238 + (rnd() - 0.5) * noise, 242];
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = fg[k] * c + bg[k] * (1 - c);
      data[i + 3] = 255;
    }
  }
  return { image: { width, height, data }, coverage };
}

test('objeto: acha sozinho, sem retângulo nem clique', () => {
  const { image, coverage } = scene();
  const r = segmentObject(image);
  assert.ok(r.bounds);
  let gross = 0;
  for (let p = 0; p < coverage.length; p++) {
    if (coverage[p] === 1 && r.alpha[p] < 200) gross++;
    if (coverage[p] === 0 && r.alpha[p] > 60) gross++;
  }
  assert.equal(gross, 0);
});

test('objeto: borda suave acompanha a cobertura real do pixel (sem serrilhado)', () => {
  const { image, coverage } = scene();
  const r = segmentObject(image);
  let err = 0;
  let n = 0;
  let partial = 0;
  for (let p = 0; p < coverage.length; p++) {
    if (r.alpha[p] > 0 && r.alpha[p] < 255) partial++;
    if ((coverage[p] > 0 && coverage[p] < 1) || (r.alpha[p] > 0 && r.alpha[p] < 255)) {
      err += Math.abs(r.alpha[p] / 255 - coverage[p]);
      n++;
    }
  }
  assert.ok(partial > 200, 'a borda tem pixels semitransparentes');
  assert.ok(err / n < 0.08, `erro médio do alfa na borda: ${(err / n).toFixed(3)}`);
});

test('objeto: a descontaminação tira o halo da cor do fundo', () => {
  const { image } = scene();
  const r = segmentObject(image);
  const out = { ...image, data: image.data.slice() };
  applyMatte(out, r.alpha);
  let error = 0;
  let n = 0;
  for (let p = 0; p < r.alpha.length; p++) {
    const a = out.data[p * 4 + 3];
    if (a > 0 && a < 255) {
      error += Math.abs(out.data[p * 4] - 30) + Math.abs(out.data[p * 4 + 1] - 110) + Math.abs(out.data[p * 4 + 2] - 200);
      n++;
    }
  }
  assert.ok(error / n / 3 < 15, `erro de cor na borda: ${(error / n / 3).toFixed(1)}`);
});

test('objeto: o clique escolhe só o objeto clicado', () => {
  const width = 120;
  const height = 60;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const square = (x0, color) => {
    for (let y = 20; y < 40; y++) for (let x = x0; x < x0 + 20; x++) data.set([...color, 255], (y * width + x) * 4);
  };
  square(15, [200, 0, 0]);
  square(80, [0, 0, 200]);
  const r = segmentObject({ width, height, data }, { point: { x: 90, y: 30 }, softEdges: false });
  assert.equal(r.bounds.x, 80);
  assert.equal(r.alpha[30 * width + 20], 0);
});

test('objeto: o retângulo limita a busca e fundo transparente vira fundo', () => {
  const width = 50;
  const height = 50;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) data.set([0, 200, 0, 255], (y * width + x) * 4);
  const r = segmentObject({ width, height, data }, { rect: { x: 5, y: 5, width: 30, height: 30 }, softEdges: false });
  assert.deepEqual(r.bounds, { x: 10, y: 10, width: 20, height: 20 });
  assert.deepEqual(normalizeRect({ x: -5, y: -5, width: 500, height: 3 }, 50, 50), { x: 0, y: 0, width: 50, height: 1 });
});

test('objeto: imagem lisa não tem objeto', () => {
  const data = new Uint8ClampedArray(40 * 40 * 4).fill(200);
  assert.equal(segmentObject({ width: 40, height: 40, data }).bounds, null);
});

test('objeto: o refinamento alisa degraus de um contorno binário', () => {
  const width = 60;
  const height = 60;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x + y < 60) mask[y * width + x] = 1;
  const alpha = refineEdges({ width, height, data }, mask, { x: 0, y: 0, width, height });
  const partial = [...alpha].filter((a) => a > 0 && a < 255).length;
  assert.ok(partial >= 50);
  assert.equal(alpha[10 * width + 10], 255);
  assert.equal(alpha[55 * width + 55], 0);
});
