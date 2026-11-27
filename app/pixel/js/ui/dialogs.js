import { PixelDocument, MAX_SIDE } from '../core/document.js';
import { hexToColor } from '../core/colors.js';
import { DATA_FORMATS, buildMatrices, generateData, flattenBackground } from '../core/export.js';
import { fileNameFor } from '../core/format.js';
import { encodeGIF } from '../core/gif.js';
import { scaleNearest } from '../core/export.js';
import { scaleDetection } from '../core/geometry.js';
import { PRESET_PALETTES } from '../core/palettes.js';
import { el, notify, downloadBlob, downloadText, saveLabel, pickFile, numberField, selectField, checkboxField, formatDate, formatBytes } from './util.js';
import { openDialog, confirm } from './dialog.js';
import { pixelsToCanvas, canvasToBlob, fileToPixels, downscale, crop } from './image.js';
import { icon } from './icons.js';
import { TOOLS } from './tools.js';

const SIZES = [8, 16, 24, 32, 48, 64, 96, 128, 256];

function sizePresets(widthInput, heightInput) {
  return el(
    'div',
    { class: 'presets' },
    SIZES.map((t) =>
      el(
        'button',
        {
          type: 'button',
          class: 'button small',
          onclick: () => {
            widthInput.value = t;
            heightInput.value = t;
            widthInput.dispatchEvent(new Event('input'));
          },
        },
        `${t}×${t}`,
      ),
    ),
  );
}

function readSide(input) {
  const n = Math.round(+input.value);
  if (!Number.isFinite(n) || n < 1 || n > MAX_SIDE) throw new Error(`Use tamanhos entre 1 e ${MAX_SIDE}.`);
  return n;
}

export async function newDialog(editor, open = (d) => editor.load(d)) {
  const name = el('input', { type: 'text', value: 'Sem título', maxlength: 120 });
  const l = numberField('Largura', 32, { max: MAX_SIDE });
  const a = numberField('Altura', 32, { max: MAX_SIDE });
  const background = selectField('Fundo', [['transparent', 'Transparente'], ['secondary', 'Cor secundária'], ['white', 'Branco']], 'transparent');
  const palette = selectField('Paleta', PRESET_PALETTES.map((p) => [p.slug, p.name]), PRESET_PALETTES.some((p) => p.slug === editor.state.palette) ? editor.state.palette : 'matiz');
  const error = el('p', { class: 'error', role: 'alert' });
  const doc = await openDialog({
    title: 'Novo projeto',
    body: el('div', { class: 'form-grid' }, el('label', { class: 'field wide' }, el('span', {}, 'Nome'), name), l.label, a.label, sizePresets(l.input, a.input), background.label, palette.label, error),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'Criar',
        primary: true,
        send: true,
        action: () => {
          try {
            const d = new PixelDocument(readSide(l.input), readSide(a.input), { name: name.value.trim() || 'Sem título' });
            const color = background.select.value === 'secondary' ? editor.state.secondaryColor : background.select.value === 'white' ? hexToColor('#ffffff') : 0;
            if (color) d.cell(d.frames[0].id, d.layers[0].id).fill(color);
            return d;
          } catch (e) {
            error.textContent = e.message;
            return false;
          }
        },
      },
    ],
  });
  if (!doc) return;
  editor.setState('palette', palette.select.value);
  open(doc);
}

export async function resizeDialog(editor) {
  const { doc } = editor;
  const l = numberField('Largura', doc.width, { max: MAX_SIDE });
  const a = numberField('Altura', doc.height, { max: MAX_SIDE });
  const mode = selectField('Como mudar', [['anchor', 'Recortar ou expandir a área'], ['scale', 'Escalar o desenho (vizinho mais próximo)']], 'anchor');
  let anchor = [0.5, 0.5];
  const grid = el('div', { class: 'anchor', role: 'radiogroup', 'aria-label': 'Âncora' });
  const names = ['Topo à esquerda', 'Topo', 'Topo à direita', 'Esquerda', 'Centro', 'Direita', 'Base à esquerda', 'Base', 'Base à direita'];
  const mark = () => [...grid.children].forEach((b, i) => b.setAttribute('aria-checked', String(i % 3 === anchor[0] * 2 && Math.floor(i / 3) === anchor[1] * 2)));
  for (let i = 0; i < 9; i++) {
    grid.append(
      el('button', {
        type: 'button',
        role: 'radio',
        title: names[i],
        'aria-label': names[i],
        onclick: () => {
          anchor = [(i % 3) / 2, Math.floor(i / 3) / 2];
          mark();
        },
      }),
    );
  }
  mark();
  const anchorBlock = el('div', { class: 'field' }, el('span', {}, 'Âncora (centralizar ou expandir para um lado)'), grid);
  mode.select.addEventListener('change', () => (anchorBlock.hidden = mode.select.value === 'scale'));
  const error = el('p', { class: 'error', role: 'alert' });
  const r = await openDialog({
    title: 'Tamanho da matriz',
    body: el('div', { class: 'form-grid' }, el('p', { class: 'wide hint' }, `Agora: ${doc.width} × ${doc.height} pixels.`), l.label, a.label, sizePresets(l.input, a.input), mode.label, anchorBlock, error),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'Aplicar',
        primary: true,
        send: true,
        action: () => {
          try {
            return { L: readSide(l.input), A: readSide(a.input), mode: mode.select.value };
          } catch (e) {
            error.textContent = e.message;
            return false;
          }
        },
      },
    ],
  });
  if (!r) return;
  if (r.L === doc.width && r.A === doc.height) return;
  editor.editStructure(r.mode === 'scale' ? 'Escalar desenho' : 'Tamanho da matriz', (d) => {
    if (r.mode === 'scale') d.scale(r.L, r.A);
    else d.resize(r.L, r.A, anchor[0], anchor[1]);
  });
  editor.emit('document', { isNew: true });
}

function preview(canvas, maximum = 320) {
  const c = el('canvas', { class: 'export-preview' });
  const side = Math.max(canvas.width, canvas.height);
  const scale = side <= maximum ? Math.max(1, Math.min(8, Math.floor(maximum / side))) : maximum / side;
  c.width = Math.max(1, Math.round(canvas.width * scale));
  c.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

export async function exportImageDialog(editor, initialFormat = 'png') {
  const { doc } = editor;
  const format = selectField('Formato', [['png', 'PNG (mantém a transparência)'], ['jpeg', 'JPEG'], ['gif', 'GIF (até 256 cores)']], initialFormat);
  const scale = numberField('Escala', Math.max(1, Math.min(16, Math.floor(512 / Math.max(doc.width, doc.height)))), { min: 1, max: 64 });
  const background = el('input', { type: 'color', value: '#ffffff', 'aria-label': 'Cor de fundo do JPEG' });
  const quality = numberField('Qualidade JPEG (%)', 92, { min: 10, max: 100 });
  const jpegBlock = el('div', { class: 'form-grid wide' }, el('label', { class: 'field' }, el('span', {}, 'Fundo do JPEG'), background), quality.label);
  const info = el('p', { class: 'hint wide' });
  const area = el('div', { class: 'preview-area wide' });
  const frameIndex = editor.state.frame;
  const update = () => {
    const s = Math.max(1, Math.min(64, Math.round(+scale.input.value) || 1));
    jpegBlock.hidden = format.select.value !== 'jpeg';
    info.textContent = `Resultado: ${doc.width * s} × ${doc.height * s} pixels${s === 1 ? ' (tamanho real, pixel art pura)' : ` (cada pixel vira um bloco de ${s}×${s})`}.`;
    let px = doc.composite(frameIndex);
    if (format.select.value === 'jpeg') px = flattenBackground(px, hexToColor(background.value));
    area.replaceChildren(preview(pixelsToCanvas(px, doc.width, doc.height, Math.min(s, 8))));
  };
  for (const i of [format.select, scale.input, background]) i.addEventListener('input', update);
  update();
  await openDialog({
    title: 'Exportar imagem',
    body: el('div', { class: 'form-grid' }, format.label, scale.label, jpegBlock, info, area),
    actions: [
      { label: 'Fechar', value: null },
      {
        label: saveLabel(),
        primary: true,
        send: true,
        action: async () => {
          const s = Math.max(1, Math.min(64, Math.round(+scale.input.value) || 1));
          const suffix = s > 1 ? `-x${s}` : '';
          if (format.select.value === 'gif') {
            if (doc.width * s > 4096 || doc.height * s > 4096) {
              notify('O GIF pode ter no máximo 4096 pixels de lado. Diminua a escala.', 'warning');
              return false;
            }
            const gif = encodeGIF([scaleNearest(doc.composite(frameIndex), doc.width, doc.height, s)], doc.width * s, doc.height * s, { delays: [0] });
            return (await downloadBlob(new Blob([gif], { type: 'image/gif' }), fileNameFor(doc.name + suffix, 'gif'), { title: 'Exportar GIF' })) !== null;
          }
          const jpeg = format.select.value === 'jpeg';
          let px = doc.composite(frameIndex);
          if (jpeg) px = flattenBackground(px, hexToColor(background.value));
          const canvas = pixelsToCanvas(px, doc.width, doc.height, s);
          const blob = await canvasToBlob(canvas, jpeg ? 'image/jpeg' : 'image/png', (+quality.input.value || 92) / 100);
          return (await downloadBlob(blob, fileNameFor(doc.name + suffix, jpeg ? 'jpg' : 'png'), { title: 'Exportar imagem' })) !== null;
        },
      },
    ],
  });
}

export async function exportDataDialog(editor, currentPalette) {
  const { doc } = editor;
  const format = selectField('Formato', Object.entries(DATA_FORMATS).map(([k, v]) => [k, v.name]), 'json');
  const mode = selectField('Valores', [['indices', 'Índices de paleta (-1 = transparente)'], ['hex', 'Cores em hexadecimal']], 'indices');
  const usePalette = checkboxField(`Seguir a ordem da paleta "${currentPalette.name}"`, false);
  const text = el('textarea', { class: 'code', readonly: true, spellcheck: 'false', rows: 16, 'aria-label': 'Prévia do código exportado' });
  const info = el('p', { class: 'hint wide' });
  const generate = () => {
    const indices = [editor.state.frame];
    const data = buildMatrices(
      indices.map((i) => doc.composite(i)),
      doc.width,
      doc.height,
      { mode: mode.select.value, palette: usePalette.input.checked ? currentPalette.colors : null },
    );
    return generateData(format.select.value, data, doc.name);
  };
  const update = () => {
    usePalette.label.hidden = mode.select.value !== 'indices';
    const t = generate();
    text.value = t.length > 200000 ? t.slice(0, 200000) + '\n…' : t;
    info.textContent = `${formatBytes(new Blob([t]).size)} · ${doc.width} × ${doc.height}`;
  };
  for (const i of [format.select, mode.select, usePalette.input]) i.addEventListener('input', update);
  update();
  await openDialog({
    title: 'Exportar dados da matriz',
    className: 'wide',
    body: el('div', { class: 'form-grid' }, format.label, mode.label, el('div', { class: 'wide' }, usePalette.label), el('div', { class: 'wide' }, text), info),
    actions: [
      { label: 'Fechar', value: null },
      {
        label: 'Copiar',
        action: async () => {
          try {
            await navigator.clipboard.writeText(generate());
            notify('Código copiado.', 'success');
          } catch {
            text.select();
            notify('Selecione e copie com Ctrl+C.', 'warning');
          }
          return undefined;
        },
      },
      {
        label: saveLabel(),
        primary: true,
        send: true,
        action: async () => {
          const f = format.select.value;
          const name = f === 'java' ? generate().match(/class (\w+)/)[1] + '.java' : fileNameFor(doc.name, DATA_FORMATS[f].extension);
          return (await downloadText(generate(), name, 'text/plain', { title: 'Exportar dados' })) !== null;
        },
      },
    ],
  });
}

export async function importImageDialog(editor, { file = null, open = (d) => editor.load(d) } = {}) {
  file = file ?? (await pickFile('image/png,image/jpeg,image/gif,image/webp,image/bmp'));
  if (!file) return;
  let img;
  try {
    img = await fileToPixels(file);
  } catch (error) {
    notify('Não deu para ler a imagem: ' + error.message, 'error');
    return;
  }
  const detected = scaleDetection(img.pixels, img.width, img.height);
  const dest = selectField('Abrir como', [['project', 'Novo projeto'], ['layer', 'Nova camada no projeto atual']], 'project');
  const factor = numberField('Tamanho de cada pixel na imagem', detected, { min: 1, max: 64 });
  const frameWidth = numberField('Largura de cada quadro', Math.min(img.width, 32), { min: 1, max: MAX_SIDE });
  const frameHeight = numberField('Altura de cada quadro', Math.min(img.height, 32), { min: 1, max: MAX_SIDE });
  const sheetBlock = el('div', { class: 'form-grid wide' }, frameWidth.label, frameHeight.label);
  const info = el('p', { class: 'hint wide' });
  const area = el('div', { class: 'preview-area wide' }, preview(pixelsToCanvas(img.pixels, img.width, img.height), 280));
  const update = () => {
    const f = Math.max(1, +factor.input.value || 1);
    sheetBlock.hidden = dest.select.value !== 'sheet';
    const L = Math.floor(img.width / f);
    const A = Math.floor(img.height / f);
    info.textContent = `Imagem: ${img.width} × ${img.height}. ${f > 1 ? `Reduzida ${f}× fica com ${L} × ${A}.` : ''} ${detected > 1 ? `O Matiz detectou blocos de ${detected}×${detected}.` : ''}`;
  };
  for (const i of [dest.select, factor.input]) i.addEventListener('input', update);
  update();
  const error = el('p', { class: 'error', role: 'alert' });
  const r = await openDialog({
    title: `Importar ${file.name}`,
    body: el('div', { class: 'form-grid' }, dest.label, factor.label, sheetBlock, info, area, error),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'Importar',
        primary: true,
        send: true,
        action: () => {
          const f = Math.max(1, Math.round(+factor.input.value) || 1);
          const reduced = downscale(img.pixels, img.width, img.height, f);
          if (reduced.width > MAX_SIDE || reduced.height > MAX_SIDE) {
            error.textContent = `A imagem reduzida ainda passa de ${MAX_SIDE} pixels. Aumente o tamanho do pixel.`;
            return false;
          }
          return { ...reduced, dest: dest.select.value, fw: +frameWidth.input.value, fh: +frameHeight.input.value };
        },
      },
    ],
  });
  if (!r) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  if (r.dest === 'project') {
    const d = new PixelDocument(r.width, r.height, { name });
    d.cell(d.frames[0].id, d.layers[0].id).set(r.pixels);
    open(d);
  } else if (r.dest === 'layer') {
    editor.editStructure('Importar imagem', (d) => {
      const c = d.addLayer(name);
      const destPx = d.cell(editor.currentFrame.id, c.id);
      const L = Math.min(d.width, r.width);
      const A = Math.min(d.height, r.height);
      for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) destPx[y * d.width + x] = r.pixels[y * r.width + x];
      editor.state.layerId = c.id;
    });
    if (r.width > editor.doc.width || r.height > editor.doc.height) notify('A imagem é maior que a matriz e foi cortada. Use Imagem → Tamanho da matriz para ampliar.', 'warning', 5000);
  } else {
    const fw = Math.max(1, Math.min(r.width, r.fw));
    const fh = Math.max(1, Math.min(r.height, r.fh));
    const cols = Math.floor(r.width / fw);
    const rows = Math.floor(r.height / fh);
    const d = new PixelDocument(fw, fh, { name, empty: true });
    const layer = d.addLayer('Camada 1');
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const px = crop(r.pixels, r.width, i * fw, j * fh, fw, fh);
        if (!px.some((v) => v >>> 24)) continue;
        const q = d.addFrame();
        d.cell(q.id, layer.id).set(px);
      }
    }
    if (!d.frames.length) d.addFrame();
    open(d);
    notify(`${d.frames.length} quadro(s) importados.`, 'success');
  }
}

export async function projectsDialog(editor, storage, open) {
  const list = el('ul', { class: 'project-list' });
  let closeDialog;
  const load = async () => {
    list.replaceChildren(el('li', { class: 'empty' }, 'Carregando...'));
    let projects;
    try {
      projects = await storage.listProjects();
    } catch (error) {
      list.replaceChildren(el('li', { class: 'error' }, error.message));
      return;
    }
    if (!projects.length) {
      list.replaceChildren(el('li', { class: 'empty' }, 'Nenhum projeto salvo ainda. Use Arquivo → Salvar (Ctrl+S).'));
      return;
    }
    list.replaceChildren(
      ...projects.map((p) => {
        const image = p.thumbnail || p.thumbnail_url;
        return el(
          'li',
          { class: 'project' },
          image ? el('img', { src: image, alt: '', width: 56, height: 56 }) : el('div', { class: 'no-thumbnail' }),
          el('div', { class: 'project-info' }, el('strong', {}, p.name), el('span', { class: 'hint' }, `${p.width} × ${p.height} · ${p.layers} camada(s) · ${formatDate(p.updated_at)}`)),
          el(
            'div',
            { class: 'row-actions' },
            storage.type === 'server' ? el('button', { type: 'button', class: 'button small', onclick: () => revisionsDialog(editor, storage, p, open).then(() => closeDialog?.(null)) }, 'Versões') : null,
            el(
              'button',
              {
                type: 'button',
                class: 'button small danger',
                onclick: async () => {
                  if (!(await confirm('Excluir projeto', `"${p.name}" será apagado de ${storage.name}.`, 'Excluir', true))) return;
                  await storage.deleteProject(p.id);
                  if (editor.project.id === p.id || editor.project.local === p.id) editor.project = { id: null, local: null, revision: null };
                  load();
                },
              },
              'Excluir',
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'button small primary',
                onclick: async () => {
                  closeDialog?.(null);
                  await open(p.id);
                },
              },
              'Abrir',
            ),
          ),
        );
      }),
    );
  };
  load();
  await openDialog({
    title: `Projetos salvos em ${storage.name}`,
    className: 'wide',
    body: list,
    actions: [{ label: 'Fechar', value: null }],
    onOpen: (_, close) => (closeDialog = close),
  });
}

async function revisionsDialog(editor, storage, project, open) {
  const revisions = await storage.listRevisions(project.id);
  const list = el(
    'ul',
    { class: 'project-list' },
    revisions.length
      ? revisions.map((r) =>
          el(
            'li',
            { class: 'project' },
            el('div', { class: 'project-info' }, el('strong', {}, `Versão ${r.number}`), el('span', { class: 'hint' }, `${formatDate(r.created_at)} · ${formatBytes(r.size_bytes)}`)),
            el(
              'button',
              {
                type: 'button',
                class: 'button small',
                onclick: async () => {
                  if (!(await confirm('Restaurar versão', `O projeto volta para a versão ${r.number}. A versão atual fica guardada no histórico.`, 'Restaurar'))) return;
                  await storage.restoreRevision(project.id, r.number);
                  await open(project.id);
                  notify(`Versão ${r.number} restaurada.`, 'success');
                },
              },
              'Restaurar',
            ),
          ),
        )
      : el('li', { class: 'empty' }, 'Este projeto ainda não tem versões anteriores. Cada vez que você salva, a versão anterior fica guardada aqui.'),
  );
  await openDialog({ title: `Versões de "${project.name}"`, body: list, actions: [{ label: 'Fechar', value: null }] });
}

export const SHORTCUTS = [
  ...TOOLS.map((f) => [f.shortcut, f.name]),
  ['Alt + clique', 'Pegar cor com qualquer ferramenta de desenho'],
  ['Clique direito', 'Desenhar com a cor secundária'],
  ['Shift (lápis)', 'Linha reta a partir do último ponto'],
  ['Shift (formas)', 'Linha a 45°, quadrado ou círculo perfeito'],
  ['Alt (formas)', 'Desenhar a partir do centro'],
  ['Clique direito (clarear e escurecer)', 'Escurecer em vez de clarear'],
  ['Setas (mover pixels)', 'Mover a seleção 1 px (Shift: 8 px)'],
  ['Ctrl + A', 'Selecionar tudo'],
  ['Ctrl + D ou Esc', 'Desmarcar'],
  ['Shift / Alt / Shift + Alt (seleção)', 'Somar, subtrair ou fazer a interseção com a seleção atual'],
  ['Ctrl + Shift + D', 'Reselecionar'],
  ['Ctrl + Shift + I', 'Inverter a seleção'],
  ['Ctrl + B', 'Usar a seleção como pincel'],
  ['Enter, duplo clique ou Esc', 'Fechar ou cancelar polígono, laço poligonal e curva'],
  ['Shift + N', 'Nova camada'],
  ['F2', 'Propriedades da camada'],
  ['Ctrl + U', 'Matiz, saturação e luminosidade'],
  ['Ctrl + M', 'Curva de cores'],
  ['Ctrl + C, X e V', 'Copiar, recortar e colar'],
  ['Delete', 'Apagar a seleção (ou limpar a camada)'],
  ['T', 'Modo ladrilho'],
  ['Shift + T', 'Deslocar meia matriz (ladrilho)'],
  ['Shift + H e Shift + V', 'Espelhar a seleção (ou a camada) na horizontal e na vertical'],
  ['X', 'Trocar cor principal e secundária'],
  ['[ e ]', 'Diminuir e aumentar o pincel'],
  ['M', 'Alternar o modo de simetria'],
  ['G', 'Mostrar ou ocultar a grade'],
  ['Espaço + arrastar', 'Mover a visão'],
  ['Roda do mouse', 'Zoom no ponto do cursor'],
  ['+ e -', 'Aproximar e afastar'],
  ['0', 'Ajustar à tela'],
  ['1', 'Zoom 100%'],
  ['Ctrl + Z', 'Desfazer'],
  ['Ctrl + Y ou Ctrl + Shift + Z', 'Refazer'],
  ['Ctrl + S', 'Salvar (na primeira vez, o Windows pergunta em qual pasta)'],
  ['Ctrl + Shift + S', 'Salvar como (escolher outra pasta ou outro nome)'],
  ['Ctrl + O', 'Abrir arquivo (.matizpx, .crivo ou .ase) em uma nova aba'],
  ['Ctrl + Tab e Ctrl + Shift + Tab', 'Próxima aba e aba anterior'],
  ['F7', 'Mostrar ou ocultar a pré-visualização'],
  ['Ctrl + E', 'Exportar imagem'],
  ['Ctrl + Shift + E', 'Exportar dados da matriz'],
];

export function shortcutsDialog() {
  return openDialog({
    title: 'Atalhos do teclado',
    body: el('table', { class: 'shortcuts-table' }, el('tbody', {}, SHORTCUTS.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d))))),
    actions: [{ label: 'Fechar', value: null }],
  });
}

export function aboutDialog(version, storage) {
  return openDialog({
    title: 'Sobre o Matiz',
    body: el(
      'div',
      { class: 'about' },
      el('div', { class: 'about-logo', html: icon('logo', 72) }),
      el('p', {}, el('strong', {}, `Matiz ${version}`), ' · editor de imagens no estilo do Paint, com uma aba dedicada à pixel art.'),
      el('p', {}, `Projetos e paletas ficam salvos em ${storage.name}.`),
      el('p', {}, 'Copyright (©) 2026 Erik Pimenta. Todos os direitos reservados. Uso gratuito; não é permitido modificar nem copiar o Matiz.'),
      el('p', {}, el('a', { href: 'https://github.com/ravelroot/Raster-Paint-and-Pixel-Art-Editor', target: '_blank', rel: 'noopener' }, 'github.com/ravelroot/Raster-Paint-and-Pixel-Art-Editor')),
    ),
    actions: [{ label: 'Fechar', value: null }],
  });
}
