import { newId } from '../core/document.js';

const DATABASE = 'matiz-pixel';
const DATABASE_VERSION = 1;
const PALETTES_KEY = 'matiz.pixel.palettes';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, DATABASE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const store = db.createObjectStore('projects', { keyPath: 'id' });
        store.createIndex('updated_at', 'updated_at');
      }
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transaction(store, mode, fn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function readPalettes() {
  try {
    const stored = JSON.parse(localStorage.getItem(PALETTES_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.colors));
  } catch {
    return [];
  }
}

function writePalettes(list) {
  localStorage.setItem(PALETTES_KEY, JSON.stringify(list));
}

export class BrowserStorage {
  constructor(name = 'este navegador') {
    this.type = 'local';
    this.name = name;
  }

  async listProjects() {
    const all = (await transaction('projects', 'readonly', (s) => s.getAll())) || [];
    return all
      .map(({ data, ...rest }) => ({ ...rest, width: data.width, height: data.height, frames: data.frames.length, layers: data.layers.length }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async openProject(id) {
    const p = await transaction('projects', 'readonly', (s) => s.get(id));
    if (!p) throw new Error('Projeto não encontrado neste navegador.');
    return p;
  }

  async saveProject({ id, name, data, thumbnail }) {
    const record = {
      id: id || newId('local-'),
      name,
      data,
      thumbnail,
      revision: null,
      updated_at: new Date().toISOString(),
    };
    await transaction('projects', 'readwrite', (s) => s.put(record));
    return record;
  }

  async deleteProject(id) {
    await transaction('projects', 'readwrite', (s) => s.delete(id));
  }

  async listRevisions() {
    return [];
  }

  async listPalettes() {
    return readPalettes();
  }

  async savePalette(p) {
    const list = readPalettes();
    const record = { id: p.id || newId('p'), name: p.name, colors: p.colors };
    const i = list.findIndex((x) => x.id === record.id);
    if (i >= 0) list[i] = record;
    else list.push(record);
    writePalettes(list);
    return record;
  }

  async deletePalette(id) {
    writePalettes(readPalettes().filter((x) => x.id !== id));
  }
}

export async function saveDraft(draft) {
  try {
    await transaction('draft', 'readwrite', (s) => s.put(draft, 'current'));
  } catch {
    return false;
  }
  return true;
}

export async function readDraft() {
  try {
    return await transaction('draft', 'readonly', (s) => s.get('current'));
  } catch {
    return null;
  }
}
