import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBMP, encodeTIFF, encodeICO, quantize, flattenOn, withPngDpi, crc32 } from '../../../app/js/paint/core/encoders.js';
import { parseProject, serializeProject, cleanName, baseName, PROJECT_FORMAT, MAX_LAYERS } from '../../../app/js/paint/core/project.js';
import { History } from '../../../app/js/paint/core/history.js';
import { parseHex, toHex, rgbToHsv, hsvToRgb, normalizeHex, contrastText, BASIC_COLORS } from '../../../app/js/paint/core/color.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function image(w, h, rgba) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

test('BMP: cabeçalho, linhas alinhadas em 4 bytes e de baixo para cima', () => {
  const img = image(3, 2, [10, 20, 30, 255]);
  img.data.set([255, 0, 0, 255], 0);
  const bmp = encodeBMP(img);
  const view = new DataView(bmp.buffer);
  assert.equal(String.fromCharCode(bmp[0], bmp[1]), 'BM');
  assert.equal(view.getUint32(2, true), bmp.length);
  assert.equal(view.getInt32(18, true), 3);
  assert.equal(view.getUint16(28, true), 24);
  assert.equal(bmp.length, 54 + 12 * 2);
  assert.deepEqual([...bmp.slice(54 + 12, 54 + 15)], [0, 0, 255]);
});

test('BMP e JPEG: transparência vira branco', () => {
  const flat = flattenOn(image(1, 1, [0, 0, 0, 0]));
  assert.deepEqual([...flat.data], [255, 255, 255, 255]);
});

test('TIFF: little endian, RGBA sem compressão e com DPI', () => {
  const tif = encodeTIFF(image(2, 2, [1, 2, 3, 4]), 300);
  const view = new DataView(tif.buffer);
  assert.equal(String.fromCharCode(tif[0], tif[1]), 'II');
  assert.equal(view.getUint16(2, true), 42);
  const count = view.getUint16(8, true);
  const tags = new Map();
  for (let i = 0; i < count; i++) tags.set(view.getUint16(10 + i * 12, true), 10 + i * 12);
  assert.equal(view.getUint32(tags.get(256) + 8, true), 2);
  const strip = view.getUint32(tags.get(273) + 8, true);
  assert.deepEqual([...tif.slice(strip, strip + 4)], [1, 2, 3, 4]);
  const res = view.getUint32(tags.get(282) + 8, true);
  assert.equal(view.getUint32(res, true), 300);
});

test('ICO: diretório aponta para cada PNG', () => {
  const png = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  const ico = encodeICO([
    { size: 16, png },
    { size: 256, png },
  ]);
  const view = new DataView(ico.buffer);
  assert.equal(view.getUint16(2, true), 1);
  assert.equal(view.getUint16(4, true), 2);
  assert.equal(ico[6], 16);
  assert.equal(ico[6 + 16], 0);
  const offset = view.getUint32(6 + 16 + 12, true);
  assert.deepEqual([...ico.slice(offset, offset + 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('GIF: quantização para no máximo 255 cores e transparência preservada', () => {
  const w = 64;
  const img = image(w, w, [0, 0, 0, 255]);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) img.data.set([x * 4, y * 4, (x + y) * 2, 255], (y * w + x) * 4);
  img.data[3] = 0;
  const { pixels, palette } = quantize(img, 255);
  assert.ok(palette.length <= 255);
  assert.equal(pixels[0], 0);
  assert.ok(new Set(pixels).size <= 256);
});

test('PNG: o bloco pHYs com o DPI entra logo depois do IHDR com CRC certo', () => {
  const png = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  const out = withPngDpi(png, 96);
  assert.equal(out.length, png.length + 21);
  assert.equal(String.fromCharCode(...out.slice(37, 41)), 'pHYs');
  const view = new DataView(out.buffer);
  assert.equal(view.getUint32(41), 3780);
  assert.equal(view.getUint32(50), crc32(out.slice(37, 50)));
});

test('projeto .matiz: ida e volta, limites e nomes seguros', () => {
  const data = serializeProject({ name: 'Meu <desenho>.', width: 10, height: 8, dpi: 300, transparent: true, activeLayer: 1, colors: { primary: '#FF0000', secondary: '#00ff00', custom: ['#123456'] }, layers: [{ name: 'Fundo', visible: true, opacity: 1, png: PNG }, { name: 'Topo', visible: false, opacity: 0.5, png: PNG }] });
  assert.equal(data.format, PROJECT_FORMAT);
  assert.equal(data.name, 'Meu desenho');
  const p = parseProject(JSON.stringify(data));
  assert.equal(p.width, 10);
  assert.equal(p.layers.length, 2);
  assert.equal(p.layers[1].visible, false);
  assert.equal(p.colors.primary, '#ff0000');
  assert.equal(p.colors.custom.length, 10);
  assert.equal(p.activeLayer, 1);
  assert.throws(() => parseProject('não é json'));
  assert.throws(() => parseProject({ ...data, format: 'outro' }));
  assert.throws(() => parseProject({ ...data, version: 99 }));
  assert.throws(() => parseProject({ ...data, width: 0 }));
  assert.throws(() => parseProject({ ...data, layers: [] }));
  assert.throws(() => parseProject({ ...data, layers: Array(MAX_LAYERS + 1).fill(data.layers[0]) }));
  assert.throws(() => parseProject({ ...data, layers: [{ name: 'x', png: 'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' }] }));
  assert.equal(parseProject({ ...data, activeLayer: 99, dpi: -4 }).dpi, 96);
  assert.equal(cleanName('../../etc\u0000/passwd'), '....etcpasswd');
  assert.equal(baseName('foto.final.png'), 'foto.final');
});

test('histórico: desfazer, refazer, futuro apagado e limite de memória', () => {
  const h = new History({ maxBytes: 100, maxEntries: 3 });
  const log = [];
  const entry = (label, bytes = 10) => ({ label, bytes, undo: () => log.push(`-${label}`), redo: () => log.push(`+${label}`) });
  h.push(entry('a'));
  h.push(entry('b'));
  h.undo();
  h.push(entry('c'));
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.past.map((e) => e.label), ['a', 'c']);
  h.push(entry('d'));
  h.push(entry('e'));
  assert.deepEqual(h.past.map((e) => e.label), ['c', 'd', 'e']);
  h.push(entry('big', 500));
  assert.deepEqual(h.past.map((e) => e.label), ['big']);
  assert.throws(() => h.push({ label: 'x' }));
  h.undo();
  h.redo();
  assert.deepEqual(log, ['-b', '-big', '+big']);
});

test('cores: hex, HSV e contraste', () => {
  assert.deepEqual(parseHex('#abc'), { r: 170, g: 187, b: 204 });
  assert.equal(parseHex('#zzzzzz'), null);
  assert.equal(normalizeHex('FF8000'), '#ff8000');
  for (const [hex] of BASIC_COLORS) assert.equal(toHex(hsvToRgb(rgbToHsv(parseHex(hex)))), hex);
  assert.equal(contrastText('#ffffff'), '#000000');
  assert.equal(contrastText('#000000'), '#ffffff');
  assert.equal(BASIC_COLORS.length, 20);
});
