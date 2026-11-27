import { openDialog } from '../../../pixel/js/ui/dialog.js';
import { el } from '../../../pixel/js/ui/util.js';
import { parseHex, toHex, rgbToHsv, hsvToRgb, normalizeHex } from '../core/color.js';
import { MAX_SIDE } from '../core/raster.js';
import { makeCanvas } from './document.js';

const UNITS = { px: 1, cm: 2.54, in: 1 };

function numberInput(value, { min = 1, max = MAX_SIDE, step = 1, label }) {
  return el('input', { type: 'number', value, min, max, step, inputmode: 'decimal', 'aria-label': label });
}

function field(label, control, hint = null) {
  return el('label', { class: 'field' }, el('span', {}, label), control, hint ? el('small', { class: 'hint' }, hint) : null);
}

function radioGroup(name, options, value) {
  const wrap = el('div', { class: 'radio-group', role: 'radiogroup' });
  for (const [v, text] of options) {
    wrap.append(el('label', { class: 'radio' }, el('input', { type: 'radio', name, value: v, checked: v === value }), el('span', {}, text)));
  }
  return { wrap, get value() {
    return wrap.querySelector('input:checked')?.value ?? value;
  } };
}

export function confirmSaveDialog(name) {
  return openDialog({
    title: 'Matiz',
    body: el('p', {}, `Deseja salvar as alterações em "${name}"?`),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Não salvar', value: 'discard' },
      { label: 'Salvar', primary: true, send: true, action: () => 'save' },
    ],
  });
}

export function newImageDialog({ width = 1152, height = 648, background = 'white' } = {}) {
  const w = numberInput(width, { label: 'Largura em pixels' });
  const h = numberInput(height, { label: 'Altura em pixels' });
  const bg = radioGroup('fundo', [['white', 'Branco'], ['transparent', 'Transparente (PNG)'], ['secondary', 'Cor 2']], background);
  const presets = el(
    'div',
    { class: 'chips' },
    [
      [800, 600],
      [1152, 648],
      [1280, 720],
      [1920, 1080],
      [1080, 1080],
      [512, 512],
    ].map(([pw, ph]) =>
      el('button', { type: 'button', class: 'chip', onclick: () => ((w.value = pw), (h.value = ph)) }, `${pw} × ${ph}`),
    ),
  );
  return openDialog({
    title: 'Nova imagem',
    body: el('div', { class: 'form-grid' }, field('Largura (px)', w), field('Altura (px)', h), el('div', { class: 'wide' }, presets), el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Fundo'), bg.wrap)),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'Criar',
        primary: true,
        send: true,
        action: () => {
          const width = Math.round(+w.value);
          const height = Math.round(+h.value);
          if (!(width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE)) return false;
          return { width, height, background: bg.value };
        },
      },
    ],
  });
}

export function propertiesDialog(app) {
  const doc = app.doc;
  let unit = 'px';
  const dpi = numberInput(doc.dpi, { min: 1, max: 2400, label: 'Resolução' });
  const w = numberInput(doc.width, { min: 0.01, step: 'any', label: 'Largura' });
  const h = numberInput(doc.height, { min: 0.01, step: 'any', label: 'Altura' });
  const toUnit = (px) => (unit === 'px' ? px : Math.round(((px / +dpi.value) * UNITS[unit]) * 100) / 100);
  const fromUnit = (v) => (unit === 'px' ? Math.round(v) : Math.round((v / UNITS[unit]) * +dpi.value));
  const units = radioGroup('unidade', [['px', 'Pixels'], ['in', 'Polegadas'], ['cm', 'Centímetros']], 'px');
  units.wrap.addEventListener('change', () => {
    const pw = fromUnit(+w.value);
    const ph = fromUnit(+h.value);
    unit = units.value;
    w.value = toUnit(pw);
    h.value = toUnit(ph);
  });
  const transparent = el('input', { type: 'checkbox', checked: doc.transparent });
  const saved = app.file.savedAt ? new Date(app.file.savedAt).toLocaleString('pt-BR') : 'Não disponível';
  const size = app.file.size ? `${(app.file.size / 1024).toFixed(1).replace('.', ',')} KB` : 'Não disponível';
  return openDialog({
    title: 'Propriedades da imagem',
    body: el(
      'div',
      { class: 'form-grid' },
      el('dl', { class: 'facts wide' }, el('dt', {}, 'Salvo pela última vez'), el('dd', {}, saved), el('dt', {}, 'Tamanho no disco'), el('dd', {}, size), el('dt', {}, 'Camadas'), el('dd', {}, String(doc.layers.length))),
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Unidades'), units.wrap),
      field('Largura', w),
      field('Altura', h),
      field('Resolução (DPI)', dpi),
      el('label', { class: 'option wide' }, transparent, el('span', {}, 'Fundo transparente (a borracha e o Excluir deixam a área transparente)')),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'OK',
        primary: true,
        send: true,
        action: () => {
          const width = fromUnit(+w.value);
          const height = fromUnit(+h.value);
          if (!(width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE)) return false;
          return { width, height, dpi: Math.max(1, Math.min(2400, Math.round(+dpi.value) || 96)), transparent: transparent.checked };
        },
      },
    ],
  });
}

export function resizeDialog({ width, height, selection = false }) {
  const by = radioGroup('por', [['percent', 'Porcentagem'], ['pixels', 'Pixels']], 'percent');
  const hInput = numberInput(100, { min: 1, max: 5000, step: 'any', label: 'Horizontal' });
  const vInput = numberInput(100, { min: 1, max: 5000, step: 'any', label: 'Vertical' });
  const keep = el('input', { type: 'checkbox', checked: true });
  const pixels = el('input', { type: 'checkbox', checked: false });
  const skewH = numberInput(0, { min: -89, max: 89, label: 'Inclinação horizontal' });
  const skewV = numberInput(0, { min: -89, max: 89, label: 'Inclinação vertical' });
  const info = el('p', { class: 'hint wide' });
  const isPercent = () => by.value === 'percent';
  const result = () => ({
    width: isPercent() ? Math.round((width * +hInput.value) / 100) : Math.round(+hInput.value),
    height: isPercent() ? Math.round((height * +vInput.value) / 100) : Math.round(+vInput.value),
  });
  const update = () => {
    const r = result();
    info.textContent = `Resultado: ${r.width} × ${r.height} pixels${selection ? ' (só a seleção)' : ''}.`;
  };
  by.wrap.addEventListener('change', () => {
    if (isPercent()) {
      hInput.value = 100;
      vInput.value = 100;
    } else {
      hInput.value = width;
      vInput.value = height;
    }
    update();
  });
  hInput.addEventListener('input', () => {
    if (keep.checked) vInput.value = isPercent() ? hInput.value : Math.round((+hInput.value * height) / width);
    update();
  });
  vInput.addEventListener('input', () => {
    if (keep.checked) hInput.value = isPercent() ? vInput.value : Math.round((+vInput.value * width) / height);
    update();
  });
  update();
  return openDialog({
    title: 'Redimensionar e inclinar',
    body: el(
      'div',
      { class: 'form-grid' },
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Redimensionar por'), by.wrap),
      field('Horizontal', hInput),
      field('Vertical', vInput),
      el('label', { class: 'option wide' }, keep, el('span', {}, 'Manter a proporção')),
      el('label', { class: 'option wide' }, pixels, el('span', {}, 'Sem suavizar (bom para pixel art)')),
      el('h3', { class: 'wide subtitle' }, 'Inclinar (graus)'),
      field('Horizontal', skewH),
      field('Vertical', skewV),
      info,
    ),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'OK',
        primary: true,
        send: true,
        action: () => {
          const r = result();
          if (!(r.width >= 1 && r.height >= 1 && r.width <= MAX_SIDE && r.height <= MAX_SIDE)) return false;
          return { ...r, skewX: Math.max(-89, Math.min(89, +skewH.value || 0)), skewY: Math.max(-89, Math.min(89, +skewV.value || 0)), keepPixels: pixels.checked };
        },
      },
    ],
  });
}

export function editColorsDialog(initial = '#000000') {
  let hsv = rgbToHsv(parseHex(initial) ?? { r: 0, g: 0, b: 0 });
  const area = makeCanvas(240, 160);
  area.className = 'spectrum';
  const hue = el('input', { type: 'range', min: 0, max: 360, value: Math.round(hsv.h), class: 'hue-slider', 'aria-label': 'Matiz' });
  const preview = el('div', { class: 'color-preview' });
  const hex = el('input', { type: 'text', maxlength: 7, class: 'mono', 'aria-label': 'Hexadecimal' });
  const r = numberInput(0, { min: 0, max: 255, label: 'Vermelho' });
  const g = numberInput(0, { min: 0, max: 255, label: 'Verde' });
  const b = numberInput(0, { min: 0, max: 255, label: 'Azul' });
  const hh = numberInput(0, { min: 0, max: 360, label: 'Matiz' });
  const ss = numberInput(0, { min: 0, max: 100, label: 'Saturação' });
  const vv = numberInput(0, { min: 0, max: 100, label: 'Valor' });
  const drawArea = () => {
    const ctx = area.getContext('2d');
    const base = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    const white = ctx.createLinearGradient(0, 0, area.width, 0);
    white.addColorStop(0, '#ffffff');
    white.addColorStop(1, base);
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, area.width, area.height);
    const black = ctx.createLinearGradient(0, 0, 0, area.height);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, '#000000');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, area.width, area.height);
    const x = hsv.s * area.width;
    const y = (1 - hsv.v) * area.height;
    ctx.strokeStyle = hsv.v > 0.5 ? '#000' : '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  };
  const sync = (from = null) => {
    const rgb = hsvToRgb(hsv);
    const value = toHex(rgb);
    preview.style.background = value;
    if (from !== 'hex') hex.value = value;
    if (from !== 'rgb') {
      r.value = rgb.r;
      g.value = rgb.g;
      b.value = rgb.b;
    }
    if (from !== 'hsv') {
      hh.value = Math.round(hsv.h);
      ss.value = Math.round(hsv.s * 100);
      vv.value = Math.round(hsv.v * 100);
    }
    if (from !== 'hue') hue.value = Math.round(hsv.h);
    drawArea();
  };
  let dragging = false;
  const pick = (e) => {
    const rect = area.getBoundingClientRect();
    hsv = { ...hsv, s: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), v: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)) };
    sync();
  };
  area.addEventListener('pointerdown', (e) => {
    dragging = true;
    area.setPointerCapture(e.pointerId);
    pick(e);
  });
  area.addEventListener('pointermove', (e) => dragging && pick(e));
  area.addEventListener('pointerup', () => (dragging = false));
  hue.addEventListener('input', () => {
    hsv = { ...hsv, h: +hue.value };
    sync('hue');
  });
  hex.addEventListener('input', () => {
    const c = parseHex(hex.value);
    if (!c) return;
    hsv = rgbToHsv(c);
    sync('hex');
  });
  for (const i of [r, g, b]) {
    i.addEventListener('input', () => {
      hsv = rgbToHsv({ r: +r.value || 0, g: +g.value || 0, b: +b.value || 0 });
      sync('rgb');
    });
  }
  for (const i of [hh, ss, vv]) {
    i.addEventListener('input', () => {
      hsv = { h: +hh.value || 0, s: Math.min(100, +ss.value || 0) / 100, v: Math.min(100, +vv.value || 0) / 100 };
      sync('hsv');
    });
  }
  sync();
  return openDialog({
    title: 'Editar cores',
    className: 'color-dialog',
    body: el(
      'div',
      { class: 'color-editor' },
      el('div', { class: 'color-left' }, area, hue),
      el(
        'div',
        { class: 'color-right' },
        preview,
        field('Hex', hex),
        el('div', { class: 'triple' }, field('R', r), field('G', g), field('B', b)),
        el('div', { class: 'triple' }, field('H', hh), field('S %', ss), field('V %', vv)),
      ),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'OK', primary: true, send: true, action: () => normalizeHex(hex.value) ?? toHex(hsvToRgb(hsv)) },
    ],
  });
}

export function transparencyDialog(previewFn) {
  const tolerance = el('input', { type: 'range', min: 0, max: 60, value: 12, 'aria-label': 'Tolerância' });
  const out = el('output', { class: 'mono' }, '12%');
  const canvas = makeCanvas(1, 1);
  canvas.className = 'transparency-preview';
  const draw = () => {
    out.textContent = `${tolerance.value}%`;
    const image = previewFn(+tolerance.value);
    const scale = Math.min(1, 360 / image.width, 240 / image.height);
    const full = makeCanvas(image.width, image.height);
    full.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  };
  let timer = null;
  tolerance.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 60);
  });
  draw();
  return openDialog({
    title: 'Tornar fundo transparente',
    body: el(
      'div',
      { class: 'form-grid' },
      el('p', { class: 'hint wide' }, 'O Matiz tira a cor que encosta nas bordas da camada atual. Aumente a tolerância para levar junto as variações do fundo (sombras, ruído e degradês suaves).'),
      el('label', { class: 'field wide' }, el('span', {}, 'Tolerância'), el('div', { class: 'range-row' }, tolerance, out)),
      el('div', { class: 'preview-area wide checker' }, canvas),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Aplicar', primary: true, send: true, action: () => +tolerance.value },
    ],
  });
}

export function pageSetupDialog(settings) {
  const orientation = radioGroup('orientacao', [['portrait', 'Retrato'], ['landscape', 'Paisagem']], settings.orientation);
  const paper = el('select', { 'aria-label': 'Papel' }, [['A4', 'A4 (210 × 297 mm)'], ['Letter', 'Carta (216 × 279 mm)'], ['A3', 'A3 (297 × 420 mm)'], ['Legal', 'Ofício (216 × 356 mm)']].map(([v, t]) => el('option', { value: v, selected: v === settings.paper }, t)));
  const margin = numberInput(settings.margin, { min: 0, max: 50, label: 'Margens (mm)' });
  const scaling = radioGroup('escala', [['fit', 'Ajustar à página'], ['percent', 'Ajustar a porcentagem']], settings.scaling);
  const percent = numberInput(settings.percent, { min: 10, max: 400, label: 'Porcentagem' });
  const centerH = el('input', { type: 'checkbox', checked: settings.centerH });
  const centerV = el('input', { type: 'checkbox', checked: settings.centerV });
  return openDialog({
    title: 'Configurar página',
    body: el(
      'div',
      { class: 'form-grid' },
      field('Papel', paper),
      field('Margens (mm)', margin),
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Orientação'), orientation.wrap),
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Dimensionamento'), scaling.wrap, field('Porcentagem', percent)),
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Centralizar'), el('label', { class: 'option' }, centerH, el('span', {}, 'Horizontalmente')), el('label', { class: 'option' }, centerV, el('span', {}, 'Verticalmente'))),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'OK',
        primary: true,
        send: true,
        action: () => ({
          orientation: orientation.value,
          paper: paper.value,
          margin: Math.max(0, Math.min(50, +margin.value || 0)),
          scaling: scaling.value,
          percent: Math.max(10, Math.min(400, +percent.value || 100)),
          centerH: centerH.checked,
          centerV: centerV.checked,
        }),
      },
    ],
  });
}

export const PAPERS = { A4: [210, 297], Letter: [215.9, 279.4], A3: [297, 420], Legal: [215.9, 355.6] };

export function printLayout(settings, image, dpi) {
  const [pw, ph] = PAPERS[settings.paper] ?? PAPERS.A4;
  const [pageW, pageH] = settings.orientation === 'landscape' ? [ph, pw] : [pw, ph];
  const areaW = pageW - settings.margin * 2;
  const areaH = pageH - settings.margin * 2;
  const natW = (image.width / dpi) * 25.4;
  const natH = (image.height / dpi) * 25.4;
  const scale = settings.scaling === 'fit' ? Math.min(areaW / natW, areaH / natH) : settings.percent / 100;
  const w = natW * scale;
  const h = natH * scale;
  const x = settings.margin + (settings.centerH ? (areaW - w) / 2 : 0);
  const y = settings.margin + (settings.centerV ? (areaH - h) / 2 : 0);
  return { pageW, pageH, x, y, w, h };
}

export function printPreviewDialog(settings, canvas, dpi) {
  const layout = printLayout(settings, canvas, dpi);
  const scale = 300 / Math.max(layout.pageW, layout.pageH);
  const page = el('div', { class: 'print-page', style: { width: `${layout.pageW * scale}px`, height: `${layout.pageH * scale}px` } });
  const thumb = makeCanvas(Math.max(1, Math.round(layout.w * scale)), Math.max(1, Math.round(layout.h * scale)));
  const ctx = thumb.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  thumb.style.left = `${layout.x * scale}px`;
  thumb.style.top = `${layout.y * scale}px`;
  page.append(thumb);
  return openDialog({
    title: 'Visualizar impressão',
    body: el('div', { class: 'print-preview' }, page, el('p', { class: 'hint' }, `${settings.paper}, ${settings.orientation === 'landscape' ? 'paisagem' : 'retrato'}, margens de ${settings.margin} mm.`)),
    actions: [
      { label: 'Fechar', value: null },
      { label: 'Configurar página…', value: 'setup' },
      { label: 'Imprimir…', primary: true, send: true, action: () => 'print' },
    ],
  });
}

export function cameraDialog() {
  const video = el('video', { autoplay: true, playsinline: true, muted: true, class: 'camera-video' });
  const status = el('p', { class: 'hint' }, 'Pedindo acesso à câmera…');
  let stream = null;
  const stop = () => stream?.getTracks().forEach((t) => t.stop());
  return openDialog({
    title: 'Importar da câmera',
    body: el('div', { class: 'camera' }, video, status),
    onOpen: async (dialog, close) => {
      dialog.addEventListener('close', stop, { once: true });
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
        status.textContent = 'Clique em Capturar para colar a foto na tela.';
      } catch {
        status.textContent = 'Não foi possível usar a câmera. Confira a permissão do navegador ou do Windows.';
        setTimeout(() => close(null), 2600);
      }
    },
    actions: [
      { label: 'Cancelar', value: null, action: () => (stop(), null) },
      {
        label: 'Capturar',
        primary: true,
        send: true,
        action: () => {
          if (!video.videoWidth) return false;
          const canvas = makeCanvas(video.videoWidth, video.videoHeight);
          canvas.getContext('2d').drawImage(video, 0, 0);
          stop();
          return canvas;
        },
      },
    ],
  });
}

export function settingsDialog({ theme, palette, palettes, version }) {
  const themes = radioGroup('tema', [['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Usar o tema do sistema']], theme);
  const list = el('div', { class: 'palette-choices', role: 'radiogroup' });
  palettes.forEach((p, i) => {
    list.append(
      el(
        'label',
        { class: 'palette-choice' },
        el('input', { type: 'radio', name: 'paleta', value: p.id, checked: p.id === palette, 'aria-label': `Paleta ${i + 1}` }),
        el('span', { class: 'swatches' }, ...p.colors.map((c) => el('i', { style: { background: c } }))),
      ),
    );
  });
  return openDialog({
    title: 'Configurações',
    body: el(
      'div',
      { class: 'form-grid' },
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Tema'), themes.wrap),
      el('fieldset', { class: 'wide plain' }, el('legend', {}, 'Cores da interface'), list),
      el('p', { class: 'hint wide' }, `Matiz ${version}`),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'OK', primary: true, send: true, action: () => ({ theme: themes.value, palette: list.querySelector('input:checked')?.value ?? palette }) },
    ],
  });
}

export function aboutDialog(version, logoSvg) {
  return openDialog({
    title: 'Sobre o Matiz',
    body: el(
      'div',
      { class: 'about' },
      el('div', { class: 'about-logo', html: logoSvg }),
      el('p', {}, el('strong', {}, `Matiz ${version}`), ' · editor de imagens no estilo do Paint, com uma aba dedicada à pixel art.'),
      el('p', {}, 'Tudo roda neste aparelho: nada é enviado para servidores.'),
      el('p', {}, 'Copyright (©) 2026 Erik Pimenta. Todos os direitos reservados. Uso gratuito; não é permitido modificar nem copiar o Matiz.'),
      el('p', {}, el('a', { href: 'https://github.com/ravelroot/Raster-Paint-and-Pixel-Art-Editor', target: '_blank', rel: 'noopener' }, 'github.com/ravelroot/Raster-Paint-and-Pixel-Art-Editor')),
    ),
    actions: [{ label: 'Fechar', value: null }],
  });
}

export const SHORTCUTS = [
  ['Ctrl + N', 'Nova imagem'],
  ['Ctrl + O', 'Abrir'],
  ['Ctrl + S', 'Salvar'],
  ['F12 ou Ctrl + Shift + S', 'Salvar como'],
  ['Ctrl + P', 'Imprimir'],
  ['Ctrl + E', 'Propriedades da imagem'],
  ['Ctrl + Z / Ctrl + Y', 'Desfazer / refazer'],
  ['Ctrl + X, C e V', 'Recortar, copiar e colar'],
  ['Ctrl + A', 'Selecionar tudo'],
  ['Ctrl + Shift + A', 'Inverter seleção'],
  ['Delete', 'Excluir a seleção'],
  ['Ctrl + W', 'Redimensionar e inclinar'],
  ['Ctrl + Shift + X', 'Cortar para a seleção'],
  ['Ctrl + Shift + I', 'Inverter cores'],
  ['Ctrl + R', 'Réguas'],
  ['Ctrl + G', 'Linhas de grade'],
  ['F11', 'Tela inteira'],
  ['Ctrl + roda do mouse, Ctrl + PgUp / PgDn', 'Ampliar e reduzir'],
  ['Ctrl + 0 / Ctrl + 1', 'Ajustar à janela / 100%'],
  ['Ctrl + + / Ctrl + -', 'Aumentar e diminuir o tamanho do pincel'],
  ['Espaço + arrastar ou botão do meio', 'Mover a visão'],
  ['Setas', 'Mover a seleção ou a forma (Shift: 10 px)'],
  ['Shift ao desenhar', 'Linha a 45°, quadrado e círculo perfeitos'],
  ['Alt ao desenhar formas', 'Desenhar a partir do centro'],
  ['Enter / Esc', 'Aplicar / cancelar a forma ou o polígono'],
  ['X', 'Trocar a Cor 1 e a Cor 2'],
  ['S, O, P, F, T, E, I, Z, B, U', 'Seleção, objeto, lápis, balde, texto, borracha, seletor de cores, lupa, pincéis, formas'],
];

export function shortcutsDialog() {
  return openDialog({
    title: 'Atalhos do teclado',
    body: el('table', { class: 'shortcuts-table' }, el('tbody', {}, SHORTCUTS.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d))))),
    actions: [{ label: 'Fechar', value: null }],
  });
}
