const DB_NAME = "GestioneSpeseDB";
const DB_VER = 5;

export const STORES = {
  USERS: "users",
  ACCOUNTS: "accounts",
  CATEGORIES: "categories",
  EXPENSES: "expenses",
  META: "meta"
};

export async function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction; // versionchange transaction
      const oldVersion = event.oldVersion;

      // USERS
      if(!db.objectStoreNames.contains(STORES.USERS)){
        const us = db.createObjectStore(STORES.USERS, { keyPath: "id" });
        us.createIndex("by_name", "name", { unique: true });
      }

      // ACCOUNTS
      if(!db.objectStoreNames.contains(STORES.ACCOUNTS)){
        const ac = db.createObjectStore(STORES.ACCOUNTS, { keyPath: "id" });
        ac.createIndex("by_user", "userId");
        ac.createIndex("by_user_name", ["userId","name"], { unique: true });
      }

      // EXPENSES (assumiamo schema stabile keyPath="key")
      // NOTA: NON ricreiamo qui per non perdere dati.

      // CATEGORIES (nuovo)
      if(!db.objectStoreNames.contains(STORES.CATEGORIES)){
        const cs = db.createObjectStore(STORES.CATEGORIES, { keyPath: "id" });
        cs.createIndex("by_norm", "norm", { unique: true }); // norm = name lower trimmed
      }

      // META
      if(!db.objectStoreNames.contains(STORES.META)){
        db.createObjectStore(STORES.META, { keyPath: "key" });
      }

      // --- MIGRAZIONE: da categoria testo -> categoryId (se arrivi da versioni < 5)
      if(oldVersion < 5){
        try{
          migrateCategories(tx);
        }catch(e){
          // se fallisce la migrazione, meglio non bloccare l’upgrade (ma loggare)
          console.warn("Migrazione categorie fallita:", e);
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Migrazione:
 * - Legge tutte le spese
 * - Se una spesa ha `categoria` testo e NON ha `categoryId`
 *   crea (se serve) un record in categories con norm unique
 *   e aggiorna la spesa con categoryId + categoryName
 */
function migrateCategories(tx){
  // Se lo store expenses non esiste, nulla da fare
  const db = tx.db;
  if(!db.objectStoreNames.contains(STORES.EXPENSES)) return;

  const exStore = tx.objectStore(STORES.EXPENSES);
  const catStore = tx.objectStore(STORES.CATEGORIES);

  // cache in-mem norm -> id (durante la migrazione)
  const cache = new Map();

  // carica tutte le categorie già presenti (se esistono)
  const preloadReq = catStore.getAll();
  preloadReq.onsuccess = () => {
    const existing = preloadReq.result || [];
    for(const c of existing){
      if(c?.norm && c?.id) cache.set(c.norm, c.id);
    }

    // scorre le spese
    exStore.openCursor().onsuccess = (ev) => {
      const cursor = ev.target.result;
      if(!cursor) return;

      const e = cursor.value;
      // già migrata
      if(e && e.categoryId){
        cursor.continue();
        return;
      }

      const raw = (e?.categoria ?? e?.categoryName ?? "").toString().trim();
      const name = raw || "Altro";
      const norm = name.toLowerCase();

      const ensureCategoryId = (cb) => {
        if(cache.has(norm)){
          cb(cache.get(norm));
          return;
        }
        // crea nuova categoria
        const id = `cat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const row = { id, name, norm };
        const addReq = catStore.add(row);
        addReq.onsuccess = () => {
          cache.set(norm, id);
          cb(id);
        };
        addReq.onerror = () => {
          // se unique clash per corsa, riprova leggendo by_norm
          const idx = catStore.index("by_norm");
          idx.get(norm).onsuccess = (e2) => {
            const found = e2.target.result;
            if(found?.id){
              cache.set(norm, found.id);
              cb(found.id);
            } else {
              cb(null);
            }
          };
        };
      };

      ensureCategoryId((catId) => {
        e.categoryId = catId || null;
        e.categoryName = name;
        // manteniamo anche e.categoria (legacy) per compatibilità CSV vecchi
        if(!e.categoria) e.categoria = name;
        cursor.update(e).onsuccess = () => cursor.continue();
      });
    };
  };
}

function os(db, store, mode="readonly"){
  return db.transaction(store, mode).objectStore(store);
}

export async function put(db, store, value){
  return new Promise((resolve, reject) => {
    const req = os(db, store, "readwrite").put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function add(db, store, value){
  return new Promise((resolve, reject) => {
    const req = os(db, store, "readwrite").add(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function get(db, store, key){
  return new Promise((resolve, reject) => {
    const req = os(db, store, "readonly").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function del(db, store, key){
  return new Promise((resolve, reject) => {
    const req = os(db, store, "readwrite").delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(db, store){
  return new Promise((resolve, reject) => {
    const req = os(db, store, "readonly").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(db, store){
  return new Promise((resolve, reject) => {
    const req = os(db, store, "readwrite").clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// META helpers
export async function getMeta(db, key){
  const row = await get(db, STORES.META, key);
  return row ? row.value : null;
}
export async function setMeta(db, key, value){
  return put(db, STORES.META, { key, value });
}