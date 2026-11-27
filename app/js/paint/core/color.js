export const BASIC_COLORS = [
  ['#000000', 'Preto'],
  ['#7f7f7f', 'Cinza 50%'],
  ['#880015', 'Vermelho escuro'],
  ['#ed1c24', 'Vermelho'],
  ['#ff7f27', 'Laranja'],
  ['#fff200', 'Amarelo'],
  ['#22b14c', 'Verde'],
  ['#00a2e8', 'Turquesa'],
  ['#3f48cc', 'Índigo'],
  ['#a349a4', 'Roxo'],
  ['#ffffff', 'Branco'],
  ['#c3c3c3', 'Cinza 25%'],
  ['#b97a57', 'Marrom'],
  ['#ffaec9', 'Rosa'],
  ['#ffc90e', 'Ouro'],
  ['#efe4b0', 'Amarelo claro'],
  ['#b5e61d', 'Verde-limão'],
  ['#99d9ea', 'Turquesa claro'],
  ['#7092be', 'Azul-acinzentado'],
  ['#c8bfe7', 'Lavanda'],
];

export const CUSTOM_SLOTS = 10;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function parseHex(text) {
  if (typeof text !== 'string') return null;
  let h = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function normalizeHex(text) {
  const c = parseHex(text);
  return c ? toHex(c) : null;
}

export function rgbToHsv({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function rgbToOklab(r, g, b) {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function contrastText(hex) {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const luminance = 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
  return luminance > 0.4 ? '#000000' : '#ffffff';
}
