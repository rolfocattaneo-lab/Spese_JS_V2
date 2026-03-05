export const CSV_COLUMNS = [
  "key",
  "user_id",
  "user_name",
  "expense_id",
  "account_id",
  "account_name",

  "category_id",
  "category_name",

  // legacy (per compatibilità vecchi export/import)
  "categoria",

  "descrizione",
  "importo",
  "data_spesa",
  "ricorrente",
  "data_fine_ricorrenza",
  "allegato_nome",
  "allegato_mime",
  "allegato_base64"
];

function esc(v){
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}
function unesc(s){
  if (s == null) return "";
  let v = String(s);
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1).replaceAll('""','"');
  return v;
}

export function exportCsv(expenses){
  const lines = [CSV_COLUMNS.join(";")];
  for (const e of expenses){
    const catName = e.categoryName || e.categoria || "";
    lines.push([
      e.key,
      e.userId, e.userName,
      String(e.expenseId),
      e.accountId, e.accountName,

      e.categoryId ?? "",
      catName,

      // legacy
      catName,

      e.descrizione,
      String(e.importo),
      e.data_spesa,
      e.ricorrente ? "1" : "0",
      e.data_fine_ricorrenza ?? "",
      e.allegato_nome ?? "",
      e.allegato_mime ?? "",
      e.allegato_base64 ?? ""
    ].map(esc).join(";"));
  }
  return lines.join("\n");
}

export function parseCsvSemicolon(text){
  const rows = [];
  let row = [], cur = "", inQ = false;

  for (let i=0;i<text.length;i++){
    const ch = text[i], next = text[i+1];
    if(inQ){
      if(ch === '"' && next === '"'){ cur += '"'; i++; continue; }
      if(ch === '"'){ inQ = false; continue; }
      cur += ch; continue;
    }
    if(ch === '"'){ inQ = true; continue; }
    if(ch === ';'){ row.push(cur); cur=""; continue; }
    if(ch === '\n'){ row.push(cur); cur=""; if(row.some(x=>x.trim()!=="")) rows.push(row); row=[]; continue; }
    if(ch === '\r') continue;
    cur += ch;
  }
  row.push(cur);
  if(row.some(x=>x.trim()!=="")) rows.push(row);
  return rows;
}

export function importCsv(text){
  const rows = parseCsvSemicolon(text);
  if(!rows.length) return { ok:false, msg:"CSV vuoto." };

  const header = rows[0].map(x=>x.trim());
  const hasHeader = header[0] === "key" && header.includes("user_id") && header.includes("descrizione");

  const start = hasHeader ? 1 : 0;

  // mappa colonne per import flessibile
  const colIndex = new Map();
  if(hasHeader){
    header.forEach((h,i)=>colIndex.set(h,i));
  } else {
    // fallback: assumo lo schema nuovo (non ideale, ma meglio di niente)
    CSV_COLUMNS.forEach((h,i)=>colIndex.set(h,i));
  }

  const getc = (rawRow, name) => unesc(rawRow[colIndex.get(name)] ?? "");

  const out = [];
  let skipped = 0;

  for(let r=start; r<rows.length; r++){
    const raw = rows[r];

    const key = getc(raw,"key").trim();
    const user_id = getc(raw,"user_id").trim();
    const user_name = getc(raw,"user_name").trim();
    const expense_id = Number(getc(raw,"expense_id"));
    const account_id = getc(raw,"account_id").trim();
    const account_name = getc(raw,"account_name").trim();

    const category_id = getc(raw,"category_id").trim();
    const category_name = getc(raw,"category_name").trim() || getc(raw,"categoria").trim(); // legacy
    const categoria_legacy = getc(raw,"categoria").trim() || category_name;

    const descrizione = getc(raw,"descrizione");
    const importo = Number(getc(raw,"importo"));
    const data_spesa = getc(raw,"data_spesa").trim();
    const ricorrente = getc(raw,"ricorrente") === "1";
    const data_fine_ricorrenza = getc(raw,"data_fine_ricorrenza");

    const allegato_nome = getc(raw,"allegato_nome");
    const allegato_mime = getc(raw,"allegato_mime");
    const allegato_base64 = getc(raw,"allegato_base64");

    if(!key || !user_id || !account_id || !data_spesa || !Number.isFinite(importo) || !Number.isFinite(expense_id)){
      skipped++; continue;
    }

    out.push({
      key,
      userId: user_id,
      userName: user_name,
      expenseId: expense_id,
      accountId: account_id,
      accountName: account_name,

      categoryId: category_id || null,
      categoryName: category_name || (categoria_legacy || "Altro"),
      categoria: categoria_legacy || (category_name || "Altro"), // legacy

      descrizione,
      importo,
      data_spesa,
      ricorrente,
      data_fine_ricorrenza: data_fine_ricorrenza ?? "",

      allegato_nome,
      allegato_mime,
      allegato_base64
    });
  }

  return { ok:true, rows: out, skipped, msg:`Righe valide: ${out.length}, scartate: ${skipped}` };
}