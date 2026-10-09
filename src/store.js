// Settings persistence. Storage can be unavailable (private mode), so every access is guarded.

const KEY = 'lowchord:v1';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let timer = null;
export function save(data) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  }, 300);
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// Recorded samples are kept in IndexedDB (too big for localStorage).
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lowchord', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putBlob(key, value) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
}

export async function getBlob(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}
