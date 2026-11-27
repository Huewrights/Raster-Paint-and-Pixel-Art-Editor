export const MODES = [
  { id: 'paint', label: 'Paint', hint: 'Editor de imagens no estilo do Paint' },
  { id: 'pixel', label: 'Pixel Art', hint: 'Editor de pixel art em matriz' },
];

export const UI_PALETTES = [
  { id: 'matiz', colors: ['#ECE8E1', '#C9D2DE', '#F2D27A', '#2B3F8C'] },
  { id: '2', colors: ['#E6DDCE', '#A3B4BE', '#F6E4A6', '#5D1C16'] },
  { id: '3', colors: ['#F5F4F4', '#BAB7B6', '#4D4B4B', '#000000'] },
  { id: '4', colors: ['#F3F1EC', '#7FA7B8', '#17212B', '#A8235A'] },
  { id: '5', colors: ['#E8E8E8', '#D9D1CE', '#AB9D9D', '#000000'] },
];

export const SHARED_KEYS = { theme: 'matiz.theme', palette: 'matiz.uiPalette', mode: 'matiz.mode' };

function parentWindow() {
  try {
    return window.parent && window.parent !== window ? window.parent : null;
  } catch {
    return null;
  }
}

function readFrom(target, key) {
  try {
    return target?.[key] ?? null;
  } catch {
    return null;
  }
}

export function shellHost() {
  return readFrom(parentWindow(), 'matizShell') ?? readFrom(window, 'matizShell');
}

export function desktopBridge() {
  for (const target of [window, parentWindow()]) {
    const bridge = readFrom(target, 'matizDesktop');
    if (typeof bridge?.toggleFullscreen === 'function') return bridge;
  }
  return null;
}

export function readShared(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function writeShared(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function installModeSwitch(current, container = document.getElementById('mode-switch')) {
  if (!container) return;
  const buttons = MODES.map((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(mode.id === current));
    button.tabIndex = mode.id === current ? 0 : -1;
    button.title = mode.hint;
    button.dataset.mode = mode.id;
    button.textContent = mode.label;
    button.addEventListener('click', () => {
      if (mode.id !== current) shellHost()?.setMode(mode.id);
    });
    return button;
  });
  container.replaceChildren(...buttons);
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = buttons[(buttons.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  });
}

export function shellTheme(applyTheme, applyPalette) {
  window.addEventListener('storage', (e) => {
    if (e.key === SHARED_KEYS.theme) applyTheme(readShared(SHARED_KEYS.theme, 'system'));
    else if (e.key === SHARED_KEYS.palette) applyPalette(readShared(SHARED_KEYS.palette, 'matiz'));
  });
}
