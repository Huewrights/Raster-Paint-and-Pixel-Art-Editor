const DATABASE = 'matiz-paint';
const VERSION = 1;
export const MAX_RECENT = 10;
export const MAX_RECENT_BYTES = 64 * 1024 * 1024;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recent')) {
        const store = db.createObjectStore('recent', { keyPath: 'id' });
        store.createIndex('openedAt', 'openedAt');
      }
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(store, mode, fn) {
  const db = await open();
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
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function listRecent() {
  try {
    const all = (await run('recent', 'readonly', (s) => s.getAll())) ?? [];
    return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export async function addRecent({ name, type, blob, thumbnail }) {
  if (!blob || blob.size > MAX_RECENT_BYTES) return false;
  try {
    const all = await listRecent();
    const same = all.find((r) => r.name === name);
    const record = { id: same?.id ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, type, blob, thumbnail, size: blob.size, openedAt: new Date().toISOString() };
    await run('recent', 'readwrite', (s) => s.put(record));
    const extra = (await listRecent()).slice(MAX_RECENT);
    if (extra.length) await run('recent', 'readwrite', (s) => extra.forEach((r) => s.delete(r.id)));
    return true;
  } catch {
    return false;
  }
}

export async function clearRecent() {
  try {
    await run('recent', 'readwrite', (s) => s.clear());
  } catch {
    return false;
  }
  return true;
}

export async function saveDraft(draft) {
  try {
    await run('draft', 'readwrite', (s) => s.put(draft, 'current'));
    return true;
  } catch {
    return false;
  }
}

export async function readDraft() {
  try {
    return await run('draft', 'readonly', (s) => s.get('current'));
  } catch {
    return null;
  }
}

export async function clearDraft() {
  try {
    await run('draft', 'readwrite', (s) => s.delete('current'));
  } catch {
    return false;
  }
  return true;
}
