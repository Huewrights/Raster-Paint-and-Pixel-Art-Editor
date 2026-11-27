import { el, notify, pickFile, formatBytes, delay } from '../../pixel/js/ui/util.js';
import { openDialog, promptText } from '../../pixel/js/ui/dialog.js';
import { PaintApp } from './ui/app.js';
import { PaintDocument, makeCanvas } from './ui/document.js';
import { Stage } from './ui/view.js';
import { ToolController, TOOLS } from './ui/tools.js';
import { Operations } from './ui/operations.js';
import { Files, OPEN_ACCEPT, IMAGE_ACCEPT, FORMATS, decodeImage } from './ui/files.js';
import { listRecent, clearRecent } from './ui/storage.js';
import { Ribbon } from './ribbon.js';
import { icon } from './ui/icons.js';
import { showPopup, menuItem, closePopup, isPopupOpen } from './ui/popup.js';
import { BRUSH_IDS } from './core/brushes.js';
import { SHAPE_IDS } from './core/shapes.js';
import {
  confirmSaveDialog,
  newImageDialog,
  propertiesDialog,
  resizeDialog,
  editColorsDialog,
  transparencyDialog,
  pageSetupDialog,
  printPreviewDialog,
  printLayout,
  cameraDialog,
  settingsDialog,
  aboutDialog,
  shortcutsDialog,
} from './ui/dialogs.js';

const PREF_KEY = 'matiz.paint.preferences';
const PRINT_KEY = 'matiz.paint.print';
const ALLOWED_TOOLS = Object.keys(TOOLS);

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  return true;
}

export function startPaint({ version, desktop, theme }) {
  const $ = (id) => document.getElementById(id);
  const app = new PaintApp();
  restorePreferences(app);
  const stage = new Stage(app, {
    stage: $('stage'),
    sizer: $('sizer'),
    wrap: $('paper-wrap'),
    paper: $('paper'),
    overlay: $('overlay'),
    rulerTop: $('ruler-top'),
    rulerLeft: $('ruler-left'),
    workspace: $('workspace'),
  });
  const busy = $('busy');
  const tools = new ToolController(app, stage, { textEditor: $('text-editor'), onBusy: (on) => (busy.hidden = !on) });
  const ops = new Operations(app, notify);
  const confirmSave = async () => {
    const answer = await confirmSaveDialog(app.doc.name);
    if (answer === 'discard') return true;
    if (answer === 'save') return files.save().catch((e) => (notify(e.message, 'error', 6000), false));
    return false;
  };
  const files = new Files(app, { notify, confirmSave, desktop });
  app.on('notice', (text) => notify(text, 'info', 2400));

  const guard = (fn) => async (...args) => {
    try {
      tools.commitText();
      return await fn(...args);
    } catch (error) {
      notify(error?.message || String(error), 'error', 6000);
      return null;
    }
  };

  let printSettings = { orientation: 'landscape', paper: 'A4', margin: 10, scaling: 'fit', percent: 100, centerH: true, centerV: true, ...readJSON(PRINT_KEY, {}) };

  async function newImage() {
    if (app.modified && !(await confirmSave())) return;
    const r = await newImageDialog({ width: app.doc.width, height: app.doc.height });
    if (!r) return;
    const background = r.background === 'transparent' ? null : r.background === 'secondary' ? app.state.secondary : '#ffffff';
    app.load(new PaintDocument(r.width, r.height, { background }));
    stage.fit();
    files.forgetDraft();
  }

  async function openFile() {
    const file = await pickFile(OPEN_ACCEPT);
    if (!file) return;
    if (await files.open(file)) stage.fit();
  }

  async function pasteCanvas(canvas, label = 'Colar') {
    if (canvas.width > app.doc.width || canvas.height > app.doc.height) {
      const grow = await openDialog({
        title: 'Colar',
        body: el('p', {}, `A imagem colada (${canvas.width} × ${canvas.height}) é maior que a tela (${app.doc.width} × ${app.doc.height}). Deseja aumentar a tela?`),
        actions: [
          { label: 'Não aumentar', value: 'keep' },
          { label: 'Aumentar a tela', primary: true, send: true, action: () => 'grow' },
        ],
      });
      if (!grow) return;
      if (grow === 'grow') ops.resizeCanvas(Math.max(app.doc.width, canvas.width), Math.max(app.doc.height, canvas.height));
    }
    tools.commitShape();
    app.setState('tool', 'select');
    const origin = { x: Math.max(0, Math.floor((stage.stage.scrollLeft - stage.padX) / stage.zoom)), y: Math.max(0, Math.floor((stage.stage.scrollTop - stage.padY) / stage.zoom)) };
    app.placeFloating(canvas, Math.min(origin.x, Math.max(0, app.doc.width - canvas.width)), Math.min(origin.y, Math.max(0, app.doc.height - canvas.height)), label);
  }

  async function blobToCanvas(blob) {
    const image = await decodeImage(blob);
    const canvas = makeCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    image.close?.();
    return canvas;
  }

  function contentCanvas() {
    if (app.floating) {
      const f = app.floating;
      const c = makeCanvas(f.width, f.height);
      app.drawFloatingOnto(c.getContext('2d'), { ...f, x: 0, y: 0 });
      return c;
    }
    if (app.selection) return app.extractSelection(app.doc.layer, app.selection);
    return null;
  }

  async function copy(cut = false) {
    const canvas = contentCanvas();
    if (!canvas) {
      notify('Selecione uma área para copiar.', 'info');
      return;
    }
    app.clipboard = canvas;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob && navigator.clipboard?.write && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      app.clipboardOnlyInternal = true;
    }
    if (cut) app.deleteSelection();
  }

  async function pasteFromSystem() {
    try {
      if (navigator.clipboard?.read) {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            await pasteCanvas(await blobToCanvas(await item.getType(type)));
            return;
          }
        }
      }
    } catch {
      if (app.clipboard) {
        await pasteCanvas(app.clipboard);
        return;
      }
    }
    if (app.clipboard) await pasteCanvas(app.clipboard);
    else notify('Não há imagem na área de transferência.', 'info');
  }

  async function pasteFrom() {
    const file = await pickFile(IMAGE_ACCEPT);
    if (!file) return;
    await pasteCanvas(await blobToCanvas(file), 'Colar de arquivo');
  }

  async function camera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('A câmera não está disponível aqui.', 'warning');
      return;
    }
    const canvas = await cameraDialog();
    if (canvas) await pasteCanvas(canvas, 'Importar da câmera');
  }

  async function properties() {
    const r = await propertiesDialog(app);
    if (!r) return;
    if (r.width !== app.doc.width || r.height !== app.doc.height) ops.resizeCanvas(r.width, r.height);
    if (r.transparent !== app.doc.transparent) ops.setTransparent(r.transparent);
    if (r.dpi !== app.doc.dpi) {
      app.doc.dpi = r.dpi;
      app.emit('document');
    }
  }

  async function resize() {
    const base = app.floating ?? app.selection ?? app.doc;
    const r = await resizeDialog({ width: base.width, height: base.height, selection: Boolean(app.selection) });
    if (r) ops.resize(r);
  }

  async function editColors() {
    const which = ribbon.activeColor;
    const hex = await editColorsDialog(app.state[which]);
    if (!hex) return;
    app.setColor(which, hex);
    app.addCustomColor(hex);
  }

  async function transparentBackground() {
    const tolerance = await transparencyDialog((t) => ops.transparentBackgroundPreview(t));
    if (tolerance === null) return;
    ops.makeBackgroundTransparent(tolerance);
    notify('Fundo transparente aplicado. Salve como PNG para manter a transparência.', 'success', 4500);
  }

  async function removeBackground() {
    busy.hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (ops.removeBackground({ sensitivity: app.state.objectSensitivity, removeHoles: app.state.objectHoles })) notify('Fundo removido. Ajuste com a Seleção automática de objeto se precisar.', 'success', 4500);
    } finally {
      busy.hidden = true;
    }
  }

  function printNow() {
    const canvas = app.doc.composite();
    const layout = printLayout(printSettings, canvas, app.doc.dpi);
    const url = canvas.toDataURL('image/png');
    const sheet = $('print-sheet');
    const style = $('print-style');
    style.textContent = `@page { size: ${layout.pageW}mm ${layout.pageH}mm; margin: 0; }`;
    sheet.replaceChildren(el('img', { src: url, alt: '', style: { left: `${layout.x}mm`, top: `${layout.y}mm`, width: `${layout.w}mm`, height: `${layout.h}mm` } }));
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      sheet.replaceChildren();
    };
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    setTimeout(done, 1500);
  }

  async function pageSetup() {
    const r = await pageSetupDialog(printSettings);
    if (!r) return;
    printSettings = r;
    writeJSON(PRINT_KEY, r);
  }

  async function printPreview() {
    for (;;) {
      const answer = await printPreviewDialog(printSettings, app.doc.composite(), app.doc.dpi);
      if (answer === 'setup') {
        await pageSetup();
        continue;
      }
      if (answer === 'print') printNow();
      return;
    }
  }

  async function share() {
    const blob = await files.encode('png');
    const file = new File([blob], `${app.doc.name}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: app.doc.name });
      } catch (error) {
        if (error?.name !== 'AbortError') throw error;
      }
      return;
    }
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notify('Compartilhar não está disponível aqui: a imagem foi copiada para a área de transferência.', 'info', 4500);
      return;
    }
    notify('Compartilhar não está disponível neste navegador.', 'warning');
  }

  async function wallpaper(style) {
    if (typeof desktop?.setWallpaper !== 'function') {
      notify('Definir como plano de fundo só funciona no app desktop (Matiz.exe).', 'info', 4500);
      return;
    }
    const blob = await files.encode('png');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    await desktop.setWallpaper(data, style);
    notify('Plano de fundo da área de trabalho definido.', 'success');
  }

  function toggleFullscreenView() {
    const view = $('fullscreen-view');
    if (!view.hidden) {
      view.hidden = true;
      view.replaceChildren();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    const canvas = app.doc.composite();
    canvas.className = 'fullscreen-image';
    view.replaceChildren(canvas);
    view.hidden = false;
    view.focus();
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  async function settings() {
    const current = theme.get();
    const r = await settingsDialog({ ...current, palettes: theme.palettes, version });
    if (!r) return;
    theme.set(r.theme, r.palette);
  }

  const toggle = (key) => () => app.setState(key, !app.state[key]);

  const commands = {
    newImage: { label: 'Novo', shortcut: 'Ctrl+N', fn: newImage },
    open: { label: 'Abrir…', shortcut: 'Ctrl+O', fn: openFile },
    save: { label: 'Salvar', shortcut: 'Ctrl+S', fn: () => files.save() },
    saveAs: { label: 'Salvar como', shortcut: 'F12', fn: () => files.save({ as: app.file.format === 'matiz' ? 'matiz' : 'png' }) },
    print: { label: 'Imprimir…', shortcut: 'Ctrl+P', fn: printNow },
    pageSetup: { label: 'Configurar página…', fn: pageSetup },
    printPreview: { label: 'Visualizar impressão', fn: printPreview },
    share: { label: 'Compartilhar', fn: share },
    properties: { label: 'Propriedades da imagem', shortcut: 'Ctrl+E', fn: properties },
    importFile: { label: 'Do arquivo…', fn: pasteFrom },
    importCamera: { label: 'Da câmera…', fn: camera },
    quit: { label: 'Sair', shortcut: 'Alt+F4', fn: () => desktop?.quit() },
    undo: { label: 'Desfazer', shortcut: 'Ctrl+Z', fn: () => app.undo() },
    redo: { label: 'Refazer', shortcut: 'Ctrl+Y', fn: () => app.redo() },
    cut: { label: 'Recortar', shortcut: 'Ctrl+X', fn: () => copy(true) },
    copy: { label: 'Copiar', shortcut: 'Ctrl+C', fn: () => copy(false) },
    paste: { label: 'Colar', shortcut: 'Ctrl+V', fn: pasteFromSystem },
    pasteFrom: { label: 'Colar de…', fn: pasteFrom },
    selectAll: { label: 'Selecionar tudo', shortcut: 'Ctrl+A', fn: () => (app.setState('tool', 'select'), app.selectAll()) },
    invertSelection: { label: 'Inverter seleção', shortcut: 'Ctrl+Shift+A', fn: () => (app.setState('tool', 'select'), app.invertSelection()) },
    delete: { label: 'Excluir seleção', shortcut: 'Delete', fn: () => app.deleteSelection() },
    crop: { label: 'Cortar', shortcut: 'Ctrl+Shift+X', fn: () => ops.crop() },
    resize: { label: 'Redimensionar e inclinar…', shortcut: 'Ctrl+W', fn: resize },
    rotateRight: { label: 'Girar 90° à direita', fn: () => ops.rotate('right') },
    rotateLeft: { label: 'Girar 90° à esquerda', fn: () => ops.rotate('left') },
    rotate180: { label: 'Girar 180°', fn: () => ops.rotate('180') },
    flipVertical: { label: 'Virar na vertical', fn: () => ops.rotate('vertical') },
    flipHorizontal: { label: 'Virar na horizontal', fn: () => ops.rotate('horizontal') },
    invertColors: { label: 'Inverter cores', shortcut: 'Ctrl+Shift+I', fn: () => ops.invertColors() },
    removeBackground: { label: 'Remover fundo', fn: removeBackground },
    transparentBackground: { label: 'Tornar fundo transparente…', fn: transparentBackground },
    objectSelect: { label: 'Seleção automática de objeto', shortcut: 'O', fn: () => app.setState('tool', 'objectSelect') },
    detectObject: { label: 'Detectar objeto principal', fn: () => (app.setState('tool', 'objectSelect'), tools.runObjectSelection({ rect: null, point: null })) },
    keepObject: { label: 'Manter só o objeto', fn: () => ops.keepObject() },
    removeObject: { label: 'Remover o objeto', fn: () => ops.removeObject() },
    trim: { label: 'Aparar bordas transparentes', fn: () => ops.trimToContent() },
    editColors: { label: 'Editar cores…', fn: editColors },
    zoomIn: { label: 'Ampliar', shortcut: 'Ctrl+PgUp', fn: () => stage.zoomStep(1) },
    zoomOut: { label: 'Reduzir', shortcut: 'Ctrl+PgDn', fn: () => stage.zoomStep(-1) },
    zoom100: { label: '100%', shortcut: 'Ctrl+1', fn: () => stage.actualSize() },
    fit: { label: 'Ajustar à janela', shortcut: 'Ctrl+0', fn: () => stage.fit() },
    rulers: { label: 'Réguas', shortcut: 'Ctrl+R', checked: () => app.state.rulers, fn: toggle('rulers') },
    gridlines: { label: 'Linhas de grade', shortcut: 'Ctrl+G', checked: () => app.state.gridlines, fn: toggle('gridlines') },
    statusbar: { label: 'Barra de status', checked: () => app.state.statusbar, fn: toggle('statusbar') },
    thumbnail: { label: 'Miniatura', checked: () => app.state.thumbnail, fn: toggle('thumbnail') },
    layersPanel: { label: 'Painel de camadas', checked: () => app.state.layersPanel, fn: toggle('layersPanel') },
    fullscreen: { label: 'Tela inteira', shortcut: 'F11', fn: toggleFullscreenView },
    windowFullscreen: { label: 'Janela em tela cheia', shortcut: 'Shift+F11', fn: () => desktop?.toggleFullscreen() },
    settings: { label: 'Configurações…', fn: settings },
    shortcuts: { label: 'Atalhos do teclado', shortcut: 'F1', fn: shortcutsDialog },
    about: { label: 'Sobre o Matiz', fn: () => aboutDialog(version, icon('logo', 72)) },
    layerNew: { label: 'Nova camada', shortcut: 'Ctrl+Shift+N', fn: () => app.addLayer() },
  };

  function execute(id) {
    const c = commands[id];
    if (!c) return;
    closePopup();
    if (!['undo', 'redo', 'copy', 'cut', 'paste', 'delete', 'crop', 'resize', 'rotateRight', 'rotateLeft', 'rotate180', 'flipVertical', 'flipHorizontal', 'invertColors', 'keepObject', 'removeObject'].includes(id)) tools.commitShape();
    guard(c.fn)();
  }

  const ribbon = new Ribbon($('ribbon'), $('subbar'), { app, execute, tools });

  const recentItems = async (menu, back) => {
    const list = await listRecent();
    menu.append(back);
    if (!list.length) menu.append(menuItem({ label: 'Nenhum arquivo recente', disabled: true }));
    for (const r of list) {
      menu.append(
        el(
          'button',
          { type: 'button', class: 'menu-item recent-item', role: 'menuitem', onclick: () => (closePopup(), guard(() => files.openRecent(r).then((ok) => ok && stage.fit()))()) },
          el('span', { class: 'check' }, r.thumbnail ? el('img', { src: r.thumbnail, alt: '' }) : ''),
          el('span', {}, r.name),
          el('kbd', {}, formatBytes(r.size ?? 0)),
        ),
      );
    }
    if (list.length) menu.append(el('hr'), menuItem({ label: 'Limpar a lista', onclick: () => clearRecent() }));
  };

  const SUBMENUS = {
    recent: { label: 'Arquivos recentes', build: recentItems },
    importTo: { label: 'Importar para a tela', items: ['importFile', 'importCamera'] },
    saveAs: {
      label: 'Salvar como',
      custom: (menu) =>
        Object.entries(FORMATS).map(([key, f]) =>
          menuItem({ label: f.label, shortcut: key === 'png' ? 'F12' : '', onclick: () => guard(() => files.save({ as: key }))() }),
        ),
    },
    print: { label: 'Imprimir', items: ['print', 'pageSetup', 'printPreview'] },
    wallpaper: {
      label: 'Definir como plano de fundo da área de trabalho',
      custom: () => [
        ['Preencher', 'fill'],
        ['Lado a lado', 'tile'],
        ['Centralizar', 'center'],
      ].map(([label, style]) => menuItem({ label, onclick: () => guard(() => wallpaper(style))() })),
    },
    rotate: { label: 'Girar e virar', items: ['rotateRight', 'rotateLeft', 'rotate180', '-', 'flipVertical', 'flipHorizontal'] },
    zoom: { label: 'Zoom', items: ['zoomIn', 'zoomOut', 'zoom100', 'fit'] },
  };

  const MENUS = [
    ['Arquivo', ['newImage', 'open', '>recent', '>importTo', '-', 'save', '>saveAs', '-', '>print', 'share', ...(desktop ? ['>wallpaper'] : []), '-', 'properties', ...(desktop ? ['-', 'quit'] : [])]],
    ['Editar', ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'pasteFrom', '-', 'selectAll', 'invertSelection', 'delete']],
    ['Imagem', ['crop', 'resize', '>rotate', 'invertColors', '-', 'objectSelect', 'detectObject', 'removeBackground', 'transparentBackground', 'trim', '-', 'properties']],
    ['Camada', ['layerNew', 'layersPanel']],
    ['Exibir', ['>zoom', '-', 'rulers', 'gridlines', 'statusbar', 'thumbnail', 'layersPanel', '-', 'fullscreen', ...(desktop ? ['windowFullscreen'] : [])]],
    ['Ajuda', ['shortcuts', 'settings', 'about']],
  ];

  function fillMenu(menu, ids) {
    const items = [];
    for (const id of ids) {
      if (id === '-') items.push(el('hr'));
      else if (id.startsWith('>')) {
        const sub = SUBMENUS[id.slice(1)];
        items.push(
          menuItem({
            label: sub.label,
            submenu: true,
            onclick: async (e) => {
              e.stopPropagation();
              const back = menuItem({ label: '‹ Voltar', submenu: true, onclick: (ev) => (ev.stopPropagation(), menu.replaceChildren(), fillMenu(menu, ids)) });
              menu.replaceChildren();
              if (sub.build) await sub.build(menu, back);
              else if (sub.custom) menu.append(back, el('hr'), ...sub.custom(menu));
              else {
                menu.append(back, el('hr'));
                fillMenu(menu, sub.items);
              }
              menu.querySelector('.menu-item:not(:disabled)')?.focus();
            },
          }),
        );
      } else {
        const c = commands[id];
        const disabled = (id === 'undo' && !app.history.canUndo && !app.floating) || (id === 'redo' && !app.history.canRedo) || (['cut', 'copy', 'delete', 'crop'].includes(id) && !app.selection);
        items.push(menuItem({ label: c.label, shortcut: c.shortcut ?? '', checked: c.checked ? c.checked() : null, disabled, onclick: () => execute(id) }));
      }
    }
    menu.append(...items);
  }

  const bar = $('menus');
  for (const [title, ids] of MENUS) {
    const button = el('button', { type: 'button', class: 'menu-button', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, title);
    button.addEventListener('click', () => showPopup(button, (menu) => fillMenu(menu, ids), { className: 'main-menu' }));
    button.addEventListener('mouseenter', () => {
      if (isPopupOpen() && document.querySelector('.popup.main-menu') && button.getAttribute('aria-expanded') !== 'true') button.click();
    });
    bar.append(button);
  }

  const undo = $('undo');
  const redo = $('redo');
  const save = $('save');
  const settingsButton = $('settings');
  undo.innerHTML = icon('undo', 18);
  redo.innerHTML = icon('redo', 18);
  save.innerHTML = icon('disk', 18);
  settingsButton.innerHTML = icon('gear', 18);
  undo.addEventListener('click', () => execute('undo'));
  redo.addEventListener('click', () => execute('redo'));
  save.addEventListener('click', () => execute('save'));
  settingsButton.addEventListener('click', () => execute('settings'));

  const nameInput = $('file-name');
  const updateTitle = () => {
    if (document.activeElement !== nameInput) nameInput.value = app.doc.name;
    const title = `${app.modified ? '• ' : ''}${app.doc.name} · Paint · Matiz`;
    app.emit('title', title);
    undo.disabled = !app.history.canUndo && !app.floating;
    redo.disabled = !app.history.canRedo;
    undo.title = app.history.canUndo ? `Desfazer: ${app.history.nextUndo} (Ctrl+Z)` : 'Nada para desfazer';
    redo.title = app.history.canRedo ? `Refazer: ${app.history.nextRedo} (Ctrl+Y)` : 'Nada para refazer';
  };
  nameInput.addEventListener('change', () => {
    app.doc.name = nameInput.value.trim().slice(0, 120) || 'Sem título';
    app.file.target = null;
    app.file.name = null;
    updateTitle();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
    e.stopPropagation();
  });
  app.on('history', updateTitle);
  app.on('file', updateTitle);
  app.on('document', updateTitle);
  app.on('selection', updateTitle);

  buildStatus(app, stage, $);
  const layersPanel = buildLayers(app, $('layers-panel'), execute);
  buildThumbnail(app, stage, $('thumbnail'));
  buildCanvasHandles(app, stage, ops, $('paper-wrap'));

  app.on('state', ({ key }) => {
    if (key === 'statusbar') $('paint').classList.toggle('no-status', !app.state.statusbar);
    if (key === 'layersPanel') {
      $('paint').classList.toggle('with-layers', app.state.layersPanel);
      layersPanel.render();
      requestAnimationFrame(() => stage.layout());
    }
    savePreferences(app);
  });
  $('paint').classList.toggle('no-status', !app.state.statusbar);
  $('paint').classList.toggle('with-layers', app.state.layersPanel);

  $('stage').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!['select', 'objectSelect'].includes(app.state.tool) && !app.selection) return;
    showPopup(null, (menu) => fillMenu(menu, ['cut', 'copy', 'paste', '-', 'selectAll', 'invertSelection', 'delete', '-', 'crop', '>rotate', 'resize', 'invertColors']), { at: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY } });
  });

  $('fullscreen-view').addEventListener('click', toggleFullscreenView);
  $('fullscreen-view').addEventListener('keydown', (e) => {
    e.preventDefault();
    toggleFullscreenView();
  });

  const editable = (t) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

  function onKey(e) {
    if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (editable(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ' && !ctrl) {
      tools.setSpace(true);
      e.preventDefault();
      return;
    }
    if (tools.gesture && e.key !== 'Escape') return;
    if (ctrl) {
      const map = {
        n: 'newImage',
        o: 'open',
        p: 'print',
        e: 'properties',
        w: 'resize',
        z: e.shiftKey ? 'redo' : 'undo',
        y: 'redo',
        x: e.shiftKey ? 'crop' : 'cut',
        c: 'copy',
        a: e.shiftKey ? 'invertSelection' : 'selectAll',
        r: 'rulers',
        g: 'gridlines',
        i: e.shiftKey ? 'invertColors' : null,
        s: e.shiftKey ? 'saveAs' : 'save',
        0: 'fit',
        1: 'zoom100',
        pageup: 'zoomIn',
        pagedown: 'zoomOut',
      };
      if (k === 'n' && e.shiftKey) {
        execute('layerNew');
        e.preventDefault();
        return;
      }
      if (k === '+' || k === '=' || k === '-' || k === '_') {
        app.size = app.size + (k === '+' || k === '=' ? 1 : -1);
        e.preventDefault();
        return;
      }
      if (k === 'v') return;
      const id = map[k];
      if (id) {
        execute(id);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'F12') return void (execute('saveAs'), e.preventDefault());
    if (e.key === 'F11') return void (execute(e.shiftKey ? 'windowFullscreen' : 'fullscreen'), e.preventDefault());
    if (e.key === 'F1') return void (execute('shortcuts'), e.preventDefault());
    if (e.key === 'Escape') {
      if (tools.escape()) e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (tools.enterShape()) e.preventDefault();
      else if (app.floating) {
        app.commitFloating();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      execute('delete');
      e.preventDefault();
      return;
    }
    if (k.startsWith('arrow')) {
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
      if (tools.nudge(dx, dy)) e.preventDefault();
      return;
    }
    if (e.altKey) return;
    if (k === 'x') {
      app.swapColors();
      e.preventDefault();
      return;
    }
    const tool = Object.entries(TOOLS).find(([, t]) => t.key === k);
    if (tool) {
      app.setState('tool', tool[0]);
      e.preventDefault();
    }
  }

  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') tools.setSpace(false);
  });

  document.addEventListener('paste', async (e) => {
    if (editable(e.target) || document.querySelector('dialog[open]')) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    e.preventDefault();
    try {
      if (item) await pasteCanvas(await blobToCanvas(item.getAsFile()));
      else if (app.clipboard) await pasteCanvas(app.clipboard);
      else notify('Não há imagem na área de transferência.', 'info');
    } catch (error) {
      notify(error.message, 'error', 5000);
    }
  });

  const dropZone = $('workspace');
  dropZone.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
      e.preventDefault();
      dropZone.classList.add('dropping');
    }
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dropping'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dropping');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      if (/\.matiz$/i.test(file.name)) {
        if (await files.open(file)) stage.fit();
      } else await pasteCanvas(await blobToCanvas(file), 'Importar para a tela');
    } catch (error) {
      notify(error.message, 'error', 5000);
    }
  });

  const autosave = delay(() => files.storeDraft(), 2500);
  app.on('history', autosave);

  const beforeClose = async () => {
    autosave.cancel();
    await files.storeDraft();
  };
  if (!desktop) {
    window.addEventListener('beforeunload', (e) => {
      files.storeDraft();
      if (app.modified) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function init() {
    const restored = await files.restoreDraft();
    stage.layout();
    stage.fit();
    updateTitle();
    if (restored) notify('O desenho que estava aberto foi recuperado.', 'success', 3500);
  }

  return { app, stage, tools, files, ops, execute, init, beforeClose };
}

function restorePreferences(app) {
  const p = readJSON(PREF_KEY, {});
  const s = app.state;
  if (ALLOWED_TOOLS.includes(p.tool) && p.tool !== 'text') s.tool = p.tool;
  if (BRUSH_IDS.includes(p.brush)) s.brush = p.brush;
  if (SHAPE_IDS.includes(p.shape)) s.shape = p.shape;
  for (const key of ['outline', 'fill']) if (['none', 'solid', 'crayon', 'marker', 'oil', 'pencil', 'watercolor'].includes(p[key])) s[key] = p[key];
  if (p.sizes && typeof p.sizes === 'object') for (const k of Object.keys(s.sizes)) if (Number.isFinite(p.sizes[k])) s.sizes[k] = Math.max(1, Math.min(100, Math.round(p.sizes[k])));
  if (Number.isFinite(p.opacity)) s.opacity = Math.max(1, Math.min(100, Math.round(p.opacity)));
  for (const k of ['primary', 'secondary']) if (/^#[0-9a-f]{6}$/i.test(p[k] ?? '')) s[k] = p[k].toLowerCase();
  if (Array.isArray(p.custom)) s.custom = s.custom.map((_, i) => (/^#[0-9a-f]{6}$/i.test(p.custom[i] ?? '') ? p.custom[i] : null));
  for (const k of ['rulers', 'gridlines', 'statusbar', 'layersPanel', 'thumbnail', 'transparentSelection', 'objectHoles']) if (typeof p[k] === 'boolean') s[k] = p[k];
  if (['rect', 'free'].includes(p.selectMode)) s.selectMode = p.selectMode;
  if (['transparent', 'secondary'].includes(p.eraserMode)) s.eraserMode = p.eraserMode;
  if (Number.isFinite(p.fillTolerance)) s.fillTolerance = Math.max(0, Math.min(100, p.fillTolerance));
  if (Number.isFinite(p.objectSensitivity)) s.objectSensitivity = Math.max(0, Math.min(100, p.objectSensitivity));
  if (p.text && typeof p.text === 'object') {
    const t = p.text;
    s.text = {
      ...s.text,
      font: typeof t.font === 'string' && t.font.length < 60 && /^[\w \-]+$/.test(t.font) ? t.font : s.text.font,
      size: Number.isFinite(t.size) ? Math.max(6, Math.min(400, t.size)) : s.text.size,
      bold: Boolean(t.bold),
      italic: Boolean(t.italic),
      underline: Boolean(t.underline),
      strike: Boolean(t.strike),
      background: Boolean(t.background),
      align: ['left', 'center', 'right'].includes(t.align) ? t.align : 'left',
    };
  }
}

const savePreferences = delay((app) => {
  const s = app.state;
  writeJSON(PREF_KEY, {
    tool: s.tool,
    brush: s.brush,
    shape: s.shape,
    outline: s.outline,
    fill: s.fill,
    sizes: s.sizes,
    opacity: s.opacity,
    primary: s.primary,
    secondary: s.secondary,
    custom: s.custom,
    rulers: s.rulers,
    gridlines: s.gridlines,
    statusbar: s.statusbar,
    layersPanel: s.layersPanel,
    thumbnail: s.thumbnail,
    transparentSelection: s.transparentSelection,
    selectMode: s.selectMode,
    eraserMode: s.eraserMode,
    fillTolerance: s.fillTolerance,
    objectSensitivity: s.objectSensitivity,
    objectHoles: s.objectHoles,
    text: s.text,
  });
}, 400);

function buildStatus(app, stage, $) {
  const pos = $('status-position');
  const sel = $('status-selection');
  const size = $('status-size');
  const file = $('status-file');
  const zoomOut = $('zoom-out');
  const zoomIn = $('zoom-in');
  const range = $('zoom-range');
  const label = $('zoom-label');
  zoomOut.innerHTML = icon('minus', 14);
  zoomIn.innerHTML = icon('plus', 14);
  $('status-position-icon').innerHTML = icon('crosshair', 14);
  $('status-selection-icon').innerHTML = icon('selection', 14);
  $('status-size-icon').innerHTML = icon('fit', 14);
  $('status-file-icon').innerHTML = icon('disk', 14);
  app.on('pointer', (p) => (pos.textContent = p ? `${p.x}, ${p.y} px` : ''));
  app.on('shape-size', (s) => (sel.textContent = `${s.width} × ${s.height} px`));
  app.on('selection', () => (sel.textContent = app.selection ? `${app.selection.width} × ${app.selection.height} px` : ''));
  const updateSize = () => (size.textContent = `${app.doc.width} × ${app.doc.height} px${app.doc.transparent ? ' · fundo transparente' : ''}`);
  app.on('document', updateSize);
  app.on('history', updateSize);
  app.on('file', () => (file.textContent = app.file.size ? `Tamanho: ${formatBytes(app.file.size)}` : ''));
  const toSlider = (z) => Math.round(Math.log2(z) * 100);
  const update = () => {
    const z = app.state.zoom;
    label.textContent = `${Math.round(z * 100)}%`;
    range.value = toSlider(z);
  };
  range.min = toSlider(0.125);
  range.max = toSlider(32);
  range.addEventListener('input', () => stage.setZoom(2 ** (+range.value / 100)));
  zoomOut.addEventListener('click', () => stage.zoomStep(-1));
  zoomIn.addEventListener('click', () => stage.zoomStep(1));
  label.addEventListener('click', () =>
    showPopup(label, (menu) => {
      for (const z of [8, 6, 4, 2, 1, 0.5, 0.25, 0.125]) menu.append(menuItem({ label: `${z * 100}%`, checked: app.state.zoom === z, onclick: () => stage.setZoom(z) }));
      menu.append(el('hr'), menuItem({ label: 'Ajustar à janela', onclick: () => stage.fit() }));
    }, { align: 'right' }),
  );
  app.on('zoom', update);
  update();
  updateSize();
}

function buildLayers(app, root, execute) {
  const list = el('ol', { class: 'paint-layer-list', 'aria-label': 'Camadas' });
  const opacity = el('input', { type: 'range', min: 0, max: 100, 'aria-label': 'Opacidade da camada' });
  const opacityOut = el('output', { class: 'mono' });
  let opacityGesture = null;
  opacity.addEventListener('pointerdown', () => (opacityGesture = app.doc.snapshot()));
  opacity.addEventListener('input', () => {
    app.doc.layer.opacity = +opacity.value / 100;
    opacityOut.textContent = `${opacity.value}%`;
    app.render();
  });
  opacity.addEventListener('change', () => {
    const value = +opacity.value / 100;
    const id = app.doc.layer.id;
    const before = opacityGesture?.layers.find((l) => l.id === id)?.opacity ?? value;
    opacityGesture = null;
    app.history.push({
      label: 'Opacidade da camada',
      bytes: 64,
      undo: () => {
        const l = app.layerById(id);
        if (l) l.opacity = before;
        app.render();
        render();
      },
      redo: () => {
        const l = app.layerById(id);
        if (l) l.opacity = value;
        app.render();
        render();
      },
    });
  });
  const action = (iconName, label, fn) => el('button', { type: 'button', class: 'icon-button', title: label, 'aria-label': label, html: icon(iconName, 16), onclick: fn });
  const doc = () => app.doc;
  const moveLayer = (dir) =>
    app.recordDocument(dir > 0 ? 'Subir camada' : 'Descer camada', (d) => {
      const i = d.active;
      const j = i + dir;
      if (j < 0 || j >= d.layers.length) return false;
      [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
      d.active = j;
    }, { keepSelection: true });
  const actions = el(
    'div',
    { class: 'paint-layer-actions' },
    action('plus', 'Nova camada', () => app.addLayer()),
    action('duplicate', 'Duplicar camada', () =>
      app.recordDocument('Duplicar camada', (d) => {
        const copy = d.layer.clone(`${d.layer.name} (cópia)`);
        d.layers.splice(d.active + 1, 0, copy);
        d.active += 1;
      }),
    ),
    action('merge', 'Mesclar com a de baixo', () =>
      app.recordDocument('Mesclar camadas', (d) => {
        if (d.active === 0) return false;
        const top = d.layer;
        const below = d.layers[d.active - 1];
        below.ctx.save();
        below.ctx.globalAlpha = top.visible ? top.opacity : 0;
        below.ctx.drawImage(top.canvas, 0, 0);
        below.ctx.restore();
        d.layers.splice(d.active, 1);
        d.active -= 1;
      }),
    ),
    action('up', 'Subir camada', () => moveLayer(1)),
    action('down', 'Descer camada', () => moveLayer(-1)),
    action('trash', 'Excluir camada', () =>
      app.recordDocument('Excluir camada', (d) => {
        if (d.layers.length < 2) {
          notify('A imagem precisa ter pelo menos uma camada.', 'info');
          return false;
        }
        d.layers.splice(d.active, 1);
        d.active = Math.max(0, d.active - 1);
      }),
    ),
  );
  root.replaceChildren(el('header', { class: 'paint-layers-head' }, el('h2', {}, 'Camadas'), el('button', { type: 'button', class: 'icon-button', title: 'Fechar', 'aria-label': 'Fechar o painel de camadas', html: icon('close', 14), onclick: () => execute('layersPanel') })), list, el('label', { class: 'option layer-opacity' }, el('span', {}, 'Opacidade'), opacity, opacityOut), actions);
  const thumbs = new Map();
  function render() {
    if (!app.state.layersPanel) return;
    const d = doc();
    list.replaceChildren(
      ...[...d.layers].map((layer, i) => ({ layer, i })).reverse().map(({ layer, i }) => {
        const thumb = makeCanvas(48, 36);
        thumbs.set(layer.id, thumb);
        drawThumb(layer, thumb);
        const eye = el('button', { type: 'button', class: 'icon-button', title: layer.visible ? 'Ocultar camada' : 'Mostrar camada', 'aria-label': layer.visible ? 'Ocultar camada' : 'Mostrar camada', html: icon(layer.visible ? 'eye' : 'eyeClosed', 16) });
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = layer.id;
          const flip = () => {
            const l = app.layerById(id);
            if (!l) return;
            l.visible = !l.visible;
            app.render();
            render();
          };
          flip();
          app.history.push({ label: 'Visibilidade da camada', bytes: 32, undo: flip, redo: flip });
        });
        const name = el('span', { class: 'layer-name' }, layer.name);
        const item = el('li', { class: `paint-layer${i === d.active ? ' active' : ''}`, draggable: 'true', data: { index: String(i) } }, thumb, name, eye);
        item.addEventListener('click', () => {
          app.clearSelection();
          d.active = i;
          app.emit('document');
        });
        item.addEventListener('dblclick', async () => {
          const value = await promptText('Renomear camada', 'Nome', layer.name);
          if (!value) return;
          app.recordDocument('Renomear camada', (dd) => {
            dd.layers[i].name = value.slice(0, 60);
          }, { keepSelection: true });
        });
        item.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(i)));
        item.addEventListener('dragover', (e) => e.preventDefault());
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = +e.dataTransfer.getData('text/plain');
          if (!Number.isInteger(from) || from === i) return;
          app.recordDocument('Reordenar camadas', (dd) => {
            const [moved] = dd.layers.splice(from, 1);
            dd.layers.splice(i, 0, moved);
            dd.active = i;
          }, { keepSelection: true });
        });
        return item;
      }),
    );
    opacity.value = Math.round(d.layer.opacity * 100);
    opacityOut.textContent = `${opacity.value}%`;
  }
  function drawThumb(layer, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(canvas.width / layer.width, canvas.height / layer.height);
    const w = layer.width * s;
    const h = layer.height * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  const refreshThumbs = delay(() => {
    for (const layer of doc().layers) {
      const t = thumbs.get(layer.id);
      if (t) drawThumb(layer, t);
    }
  }, 300);
  app.on('document', render);
  app.on('pixels', refreshThumbs);
  app.on('history', refreshThumbs);
  render();
  return { render };
}

function buildThumbnail(app, stage, root) {
  const canvas = makeCanvas(200, 150);
  const box = el('div', { class: 'thumb-view' });
  const head = el('header', { class: 'thumb-head' }, el('span', {}, 'Miniatura'), el('button', { type: 'button', class: 'icon-button', 'aria-label': 'Fechar a miniatura', html: icon('close', 12), onclick: () => app.setState('thumbnail', false) }));
  root.replaceChildren(head, el('div', { class: 'thumb-body' }, canvas, box));
  const draw = delay(() => {
    if (!app.state.thumbnail) return;
    const { width, height } = app.doc;
    const s = Math.min(200 / width, 150 / height);
    canvas.width = Math.max(1, Math.round(width * s));
    canvas.height = Math.max(1, Math.round(height * s));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(app.paper, 0, 0, canvas.width, canvas.height);
    const z = stage.zoom;
    const vx = (stage.stage.scrollLeft - stage.padX) / z;
    const vy = (stage.stage.scrollTop - stage.padY) / z;
    const vw = stage.stage.clientWidth / z;
    const vh = stage.stage.clientHeight / z;
    Object.assign(box.style, { left: `${Math.max(0, vx * s)}px`, top: `${Math.max(0, vy * s)}px`, width: `${Math.min(width, vw) * s}px`, height: `${Math.min(height, vh) * s}px` });
  }, 80);
  const sync = () => {
    root.hidden = !app.state.thumbnail;
    draw();
  };
  app.on('render', draw);
  app.on('state', ({ key }) => key === 'thumbnail' && sync());
  app.on('zoom', draw);
  stage.stage.addEventListener('scroll', draw);
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX - root.offsetLeft, y: e.clientY - root.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    root.style.left = `${Math.max(0, e.clientX - drag.x)}px`;
    root.style.top = `${Math.max(0, e.clientY - drag.y)}px`;
    root.style.right = 'auto';
  });
  head.addEventListener('pointerup', () => (drag = null));
  sync();
}

function buildCanvasHandles(app, stage, ops, wrap) {
  const outline = el('div', { class: 'resize-outline', hidden: true });
  wrap.append(outline);
  for (const dir of ['e', 's', 'se']) {
    const h = el('span', { class: `canvas-handle handle-${dir}`, role: 'separator', 'aria-label': 'Redimensionar a tela', title: 'Arraste para mudar o tamanho da tela' });
    wrap.append(h);
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, w: app.doc.width, h: app.doc.height };
      let size = { width: start.w, height: start.h };
      outline.hidden = false;
      const move = (ev) => {
        const z = stage.zoom;
        size = {
          width: dir.includes('e') ? Math.max(1, Math.round(start.w + (ev.clientX - start.x) / z)) : start.w,
          height: dir.includes('s') ? Math.max(1, Math.round(start.h + (ev.clientY - start.y) / z)) : start.h,
        };
        Object.assign(outline.style, { width: `${size.width * z}px`, height: `${size.height * z}px` });
        app.emit('shape-size', size);
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        outline.hidden = true;
        if (size.width !== start.w || size.height !== start.h) {
          try {
            ops.resizeCanvas(size.width, size.height);
          } catch (error) {
            notify(error.message, 'error');
          }
        }
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up, { once: true });
    });
  }
}
