import { startPaint } from './paint/index.js';
import { icon } from './paint/ui/icons.js';
import { showPopup, closePopup } from './paint/ui/popup.js';
import { el } from '../pixel/js/ui/util.js';
import { installModeSwitch, shellTheme, desktopBridge, UI_PALETTES, SHARED_KEYS, readShared, writeShared } from '../shared/shell.js';

const VERSION = '1.0.0';
const desktop = desktopBridge();
const frame = document.getElementById('pixel-frame');
const paintRoot = document.getElementById('paint');
let mode = 'paint';
let paintTitle = 'Matiz';
let titleObserver = null;

function effectiveTheme(theme) {
  return theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
}

function applyTheme(theme) {
  const value = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  const effective = effectiveTheme(value);
  document.documentElement.dataset.theme = effective;
  const button = document.getElementById('theme');
  button.innerHTML = icon(effective === 'dark' ? 'sun' : 'moon', 18);
  button.setAttribute('aria-label', effective === 'dark' ? 'Usar tema claro' : 'Usar tema escuro');
  button.title = button.getAttribute('aria-label');
  paint?.stage.drawOverlay();
}

function applyPalette(id) {
  const palette = UI_PALETTES.find((p) => p.id === id) ?? UI_PALETTES[0];
  if (palette === UI_PALETTES[0]) delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = palette.id;
  paint?.stage.drawOverlay();
  return palette.id;
}

const theme = {
  palettes: UI_PALETTES,
  get: () => ({ theme: readShared(SHARED_KEYS.theme, 'system'), palette: readShared(SHARED_KEYS.palette, 'matiz') }),
  set(nextTheme, nextPalette) {
    writeShared(SHARED_KEYS.theme, nextTheme);
    writeShared(SHARED_KEYS.palette, nextPalette);
    applyTheme(nextTheme);
    applyPalette(nextPalette);
    try {
      frame.contentWindow?.matizPixel?.applyTheme(nextTheme);
      frame.contentWindow?.matizPixel?.applyPalette(nextPalette);
    } catch {
      return;
    }
  },
};

function decodeEmbedded() {
  const source = document.getElementById('pixel-source');
  if (!source) return null;
  const bytes = Uint8Array.from(atob(source.textContent.trim()), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function loadPixel() {
  if (frame.dataset.loaded) return;
  frame.dataset.loaded = 'true';
  const embedded = decodeEmbedded();
  if (embedded) frame.srcdoc = embedded;
  else frame.src = 'pixel/index.html';
  frame.addEventListener('load', () => {
    try {
      const doc = frame.contentDocument;
      const title = doc?.querySelector('title');
      titleObserver?.disconnect();
      if (title) {
        titleObserver = new MutationObserver(() => mode === 'pixel' && (document.title = doc.title));
        titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
      }
      if (mode === 'pixel') {
        document.title = doc?.title ?? 'Pixel Art · Matiz';
        frame.contentWindow?.focus();
      }
    } catch {
      return;
    }
  });
}

function setMode(next) {
  if (next !== 'paint' && next !== 'pixel') return;
  closePopup();
  if (next === 'pixel') paint.tools.commitText();
  mode = next;
  writeShared(SHARED_KEYS.mode, next);
  paintRoot.hidden = next !== 'paint';
  frame.hidden = next !== 'pixel';
  document.getElementById('toasts').hidden = next !== 'paint';
  if (next === 'pixel') {
    loadPixel();
    try {
      document.title = frame.contentDocument?.title || 'Pixel Art · Matiz';
      frame.contentWindow?.focus();
    } catch {
      document.title = 'Pixel Art · Matiz';
    }
  } else {
    document.title = paintTitle;
    requestAnimationFrame(() => paint.stage.layout());
    document.getElementById('stage').focus({ preventScroll: true });
  }
}

window.matizShell = Object.freeze({ setMode, version: VERSION, mode: () => mode });

function installPaletteMenu() {
  const button = document.getElementById('palette');
  button.innerHTML = icon('palette', 18);
  button.addEventListener('click', () =>
    showPopup(button, (menu) => {
      const current = document.documentElement.dataset.palette || UI_PALETTES[0].id;
      UI_PALETTES.forEach((p, i) => {
        menu.append(
          el(
            'button',
            {
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': String(p.id === current),
              'aria-label': `Paleta ${i + 1}`,
              class: 'menu-item',
              onclick: () => {
                closePopup();
                theme.set(readShared(SHARED_KEYS.theme, 'system'), p.id);
              },
            },
            el('span', { class: 'check' }, p.id === current ? '✓' : ''),
            el('span', { class: 'swatches' }, ...p.colors.map((c) => el('i', { style: { background: c } }))),
          ),
        );
      });
    }, { align: 'right', className: 'palette-menu' }),
  );
}

const paint = startPaint({ version: VERSION, desktop, theme });
window.matiz = Object.freeze({ ...paint, version: VERSION });
paint.app.on('title', (title) => {
  paintTitle = title;
  if (mode === 'paint') document.title = title;
});

document.getElementById('logo').innerHTML = icon('logo', 18);
installModeSwitch('paint');
installPaletteMenu();
applyPalette(readShared(SHARED_KEYS.palette, 'matiz'));
applyTheme(readShared(SHARED_KEYS.theme, 'system'));
shellTheme(applyTheme, applyPalette);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (readShared(SHARED_KEYS.theme, 'system') === 'system') applyTheme('system');
});
document.getElementById('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  theme.set(next, readShared(SHARED_KEYS.palette, 'matiz'));
});

if (desktop) {
  window.__matizBeforeClose = async () => {
    await paint.beforeClose();
    try {
      await frame.contentWindow?.matizPixel?.saveDraftNow?.();
    } catch {
      return;
    }
  };
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F11' && e.shiftKey) {
        e.preventDefault();
        desktop.toggleFullscreen();
      }
    },
    true,
  );
}

paint.init().then(() => {
  document.body.classList.add('ready');
  if (readShared(SHARED_KEYS.mode, 'paint') === 'pixel') setMode('pixel');
});
