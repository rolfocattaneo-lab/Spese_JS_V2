import { STORES, getAll } from "./db.js";

/**
 * Crea un DB SQLite in-memory (sql.js) e ci carica dentro:
 * - categorie(name)
 * - budget(id, month, year, amount)
 * - spese(id, descrizione, importo, data_spesa, categoria, utente, ricorrente, data_fine_ricorrenza)
 *
 * Poi puoi fare query SQL su quello snapshot.
 */
export async function createSqlSnapshot(idb){
  // sql.js espone initSqlJs global (da vendor/sql-wasm.js)
  const SQL = await initSqlJs({ locateFile: f => `./vendor/${f}` });
  const db = new SQL.Database();

  db.run(`CREATE TABLE categorie (name TEXT PRIMARY KEY);`);
  db.run(`CREATE TABLE budget (id TEXT PRIMARY KEY, month INTEGER, year INTEGER, amount REAL);`);
  db.run(`CREATE TABLE spese (
    id TEXT PRIMARY KEY,
    descrizione TEXT,
    importo REAL,
    data_spesa TEXT,
    categoria TEXT,
    utente TEXT,
    ricorrente INTEGER,
    data_fine_ricorrenza TEXT
  );`);

  const cats = await getAll(idb, STORES.CATEGORIES);
  const budgets = await getAll(idb, STORES.BUDGETS);
  const expenses = await getAll(idb, STORES.EXPENSES);

  const insCat = db.prepare(`INSERT OR REPLACE INTO categorie(name) VALUES (?);`);
  for(const c of cats){ insCat.run([c.name]); }
  insCat.free();

  const insBud = db.prepare(`INSERT OR REPLACE INTO budget(id,month,year,amount) VALUES (?,?,?,?);`);
  for(const b of budgets){ insBud.run([b.id, b.month, b.year, b.amount]); }
  insBud.free();

  const insExp = db.prepare(`INSERT OR REPLACE INTO spese
    (id,descrizione,importo,data_spesa,categoria,utente,ricorrente,data_fine_ricorrenza)
    VALUES (?,?,?,?,?,?,?,?);`);
  for(const e of expenses){
    insExp.run([
      e.id, e.descrizione, e.importo, e.data_spesa,
      e.categoria, e.utente || "", e.ricorrente ? 1 : 0,
      e.data_fine_ricorrenza || ""
    ]);
  }
  insExp.free();

  return db;
}

export function runSql(db, sql){
  const res = db.exec(sql);
  // res è un array di result sets: {columns:[], values:[[]]}
  return res;
}