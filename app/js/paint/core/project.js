import { validateSize } from './raster.js';
import { normalizeHex, CUSTOM_SLOTS } from './color.js';

export const PROJECT_FORMAT = 'matiz-paint';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'matiz';
export const MAX_LAYERS = 64;
export const MAX_NAME = 120;
const PNG_BASE64 = /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;

export function cleanName(name, fallback = 'Sem título') {
  const text = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME);
  return text || fallback;
}

export function baseName(fileName) {
  return cleanName(String(fileName ?? '').replace(/\.[^.]+$/, ''));
}

export function serializeProject({ name, width, height, dpi, transparent, activeLayer, colors, layers }) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: cleanName(name),
    width,
    height,
    dpi,
    transparent: Boolean(transparent),
    activeLayer,
    colors,
    layers: layers.map((l) => ({ name: cleanName(l.name, 'Camada'), visible: Boolean(l.visible), opacity: l.opacity, png: l.png })),
  };
}

export function parseProject(input) {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('O arquivo não é um projeto válido do Matiz.');
    }
  }
  if (!data || typeof data !== 'object' || data.format !== PROJECT_FORMAT) throw new Error('O arquivo não é um projeto do Matiz (aba Paint).');
  if (!Number.isInteger(data.version) || data.version < 1) throw new Error('A versão do projeto é inválida.');
  if (data.version > PROJECT_VERSION) throw new Error('Este projeto foi salvo por uma versão mais nova do Matiz.');
  const { width, height } = validateSize(data.width, data.height);
  if (!Array.isArray(data.layers) || !data.layers.length) throw new Error('O projeto não tem camadas.');
  if (data.layers.length > MAX_LAYERS) throw new Error(`O projeto tem camadas demais (máximo ${MAX_LAYERS}).`);
  const layers = data.layers.map((l, i) => {
    if (!l || typeof l !== 'object') throw new Error(`A camada ${i + 1} é inválida.`);
    if (typeof l.png !== 'string' || !PNG_BASE64.test(l.png)) throw new Error(`A imagem da camada ${i + 1} não é um PNG válido.`);
    const opacity = Number(l.opacity);
    return {
      name: cleanName(l.name, `Camada ${i + 1}`),
      visible: l.visible !== false,
      opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1,
      png: l.png,
    };
  });
  const dpi = Number(data.dpi);
  const colors = data.colors && typeof data.colors === 'object' ? data.colors : {};
  const custom = Array.isArray(colors.custom) ? colors.custom.slice(0, CUSTOM_SLOTS).map((c) => (c === null ? null : normalizeHex(c))) : [];
  return {
    name: cleanName(data.name),
    width,
    height,
    dpi: Number.isFinite(dpi) && dpi >= 1 && dpi <= 2400 ? Math.round(dpi) : 96,
    transparent: Boolean(data.transparent),
    activeLayer: Number.isInteger(data.activeLayer) && data.activeLayer >= 0 && data.activeLayer < layers.length ? data.activeLayer : layers.length - 1,
    colors: {
      primary: normalizeHex(colors.primary) ?? '#000000',
      secondary: normalizeHex(colors.secondary) ?? '#ffffff',
      custom: [...custom, ...Array(Math.max(0, CUSTOM_SLOTS - custom.length)).fill(null)],
    },
    layers,
  };
}
