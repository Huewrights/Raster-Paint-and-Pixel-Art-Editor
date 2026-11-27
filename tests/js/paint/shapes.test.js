import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, shapePath, flatten, pathBounds, isOpenShape, STROKE_STYLES, FILL_STYLES } from '../../../app/js/paint/core/shapes.js';
import { BRUSHES, StrokeEngine, random, textureAlpha, TEXTURES, STYLE_FINISH } from '../../../app/js/paint/core/brushes.js';

test('formas: as 23 formas do Paint, todas dentro da caixa', () => {
  assert.equal(SHAPES.length, 23);
  const box = { x: 10, y: 20, width: 100, height: 60 };
  for (const s of SHAPES) {
    const extra = s.id === 'curve' ? { points: [[10, 80], [110, 20], [40, 0], [80, 100]] } : s.id === 'polygon' ? { points: [[10, 20], [110, 20], [60, 80]] } : {};
    const path = shapePath(s.id, box, extra);
    assert.ok(path.length >= 2, s.id);
    const b = pathBounds(path);
    if (s.id === 'curve') continue;
    assert.ok(b.x >= box.x - 0.5 && b.y >= box.y - 0.5, s.id);
    assert.ok(b.x + b.width <= box.x + box.width + 0.5 && b.y + b.height <= box.y + box.height + 0.5, s.id);
    if (!isOpenShape(s.id)) assert.equal(path.at(-1)[0], 'Z', s.id);
  }
  assert.throws(() => shapePath('nada', box));
});

test('formas: o achatamento das curvas fecha o contorno', () => {
  const lines = flatten(shapePath('oval', { x: 0, y: 0, width: 100, height: 50 }));
  const first = lines[0][0];
  const last = lines[0].at(-1);
  assert.ok(Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01);
  assert.ok(lines[0].length > 20);
});

test('formas: estilos de contorno e preenchimento do Paint', () => {
  assert.deepEqual(STROKE_STYLES.map(([v]) => v), ['none', 'solid', 'crayon', 'marker', 'oil', 'pencil', 'watercolor']);
  assert.deepEqual(FILL_STYLES.map(([v]) => v), ['none', 'solid', 'crayon', 'marker', 'oil', 'pencil', 'watercolor']);
  for (const [v] of STROKE_STYLES.slice(1)) assert.ok(STYLE_FINISH[v], v);
});

function recorder() {
  const calls = [];
  return new Proxy(
    { calls },
    {
      get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    },
  );
}

test('pincéis: os nove pincéis desenham e marcam a área alterada', () => {
  assert.equal(BRUSHES.length, 9);
  for (const b of BRUSHES) {
    const ctx = recorder();
    const engine = new StrokeEngine(ctx, { kind: b.id, size: 10, color: '#336699', seed: 4 });
    engine.begin(10, 10);
    engine.to(40, 30);
    engine.tick();
    assert.ok(ctx.calls.length > 0, b.id);
    assert.ok(engine.dirty.x <= 10 && engine.dirty.x + engine.dirty.width >= 40, b.id);
  }
});

test('pincéis: o aerógrafo é determinístico com a mesma semente', () => {
  const run = () => {
    const ctx = recorder();
    const engine = new StrokeEngine(ctx, { kind: 'airbrush', size: 12, seed: 9 });
    engine.begin(50, 50);
    engine.tick();
    return JSON.stringify(ctx.calls);
  };
  assert.equal(run(), run());
  const r = random(1);
  for (let i = 0; i < 100; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test('pincéis: texturas de giz, lápis, aquarela e óleo', () => {
  for (const kind of Object.keys(TEXTURES)) {
    const { size, alpha } = textureAlpha(kind);
    assert.equal(alpha.length, size * size);
    const filled = alpha.filter((a) => a > 0).length / alpha.length;
    assert.ok(filled > 0.3 && filled <= 1, kind);
  }
  assert.throws(() => textureAlpha('nada'));
});
