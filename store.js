// Speicher im Browser (IndexedDB): Projekte und Fotos.
const DB_NAME = "forststrasse";
let dbp;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("projekte", { keyPath: "id" });
      const f = d.createObjectStore("fotos", { keyPath: "id" });
      f.createIndex("projekt", "projektId");
      d.createObjectStore("meta");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function req(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && "result" in r ? r.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const alleProjekte = () => req("projekte", "readonly", s => s.getAll());
export const ladeProjekt = id => req("projekte", "readonly", s => s.get(id));
export const speichereProjekt = p => req("projekte", "readwrite", s => s.put(structuredClone(p)));
export async function loescheProjekt(id) {
  const fotos = await req("fotos", "readonly", s => s.index("projekt").getAllKeys(id));
  await req("fotos", "readwrite", s => { fotos.forEach(k => s.delete(k)); });
  await req("projekte", "readwrite", s => s.delete(id));
}
export const speichereFoto = (id, projektId, blob) => req("fotos", "readwrite", s => s.put({ id, projektId, blob }));
export const ladeFoto = id => req("fotos", "readonly", s => s.get(id)).then(f => f?.blob);
export const loescheFoto = id => req("fotos", "readwrite", s => s.delete(id));
export const metaLesen = k => req("meta", "readonly", s => s.get(k));
export const metaSchreiben = (k, v) => req("meta", "readwrite", s => s.put(v, k));

export function neueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
