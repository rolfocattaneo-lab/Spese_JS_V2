import { euro, escapeHtml } from "./ui.js";

export function buildReportHtml({ filters, expenses }){
  const total = expenses.reduce((a,x)=>a+Number(x.importo||0),0);

  const grouped = new Map();
  for(const e of expenses){
    const k = e.categoryName || e.categoria || "Altro";
    if(!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }
  const cats = [...grouped.keys()].sort((a,b)=>a.localeCompare(b));

  const head = `
  <html><head>
    <meta charset="utf-8"/>
    <title>Report Spese</title>
    <style>
      body{font-family:system-ui,Arial;margin:24px}
      h1{margin:0 0 8px}
      .muted{color:#555;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}
      th{font-size:12px;color:#444}
      .r{text-align:right}
      .pill{display:inline-block;padding:4px 10px;border:1px solid #ddd;border-radius:999px;background:#f5f5f5;font-size:12px;margin-right:6px}
      @media print { button{display:none} }
    </style>
  </head><body>
    <button onclick="window.print()">Stampa / Salva PDF</button>
    <h1>Report Spese</h1>
    <div class="muted">
      Range: ${filters.from} → ${filters.to}
      • Utente: ${escapeHtml(filters.userName || "tutti")}
      • Conto: ${escapeHtml(filters.accountName || "tutti")}
      • Categoria: ${escapeHtml(filters.categoryName || "tutte")}
    </div>
    <div style="margin-top:10px">
      <span class="pill">Totale: <b>${euro(total)}</b></span>
    </div>
    <hr/>
  `;

  const blocks = cats.map(cat => {
    const items = grouped.get(cat);
    const sub = items.reduce((a,x)=>a+Number(x.importo||0),0);
    const rows = items.map(e=>`
      <tr>
        <td>${escapeHtml(e.userName)}</td>
        <td>${escapeHtml(e.accountName)}</td>
        <td>${e.expenseId}</td>
        <td>${e.data_spesa}</td>
        <td>${escapeHtml(e.descrizione)}</td>
        <td class="r">${euro(e.importo)}</td>
      </tr>`).join("");

    return `
      <h3>${escapeHtml(cat)} <span class="pill">Subtotale: <b>${euro(sub)}</b></span></h3>
      <table>
        <thead><tr><th>Utente</th><th>Conto</th><th>ID</th><th>Data</th><th>Descrizione</th><th class="r">Importo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }).join("");

  const tail = `</body></html>`;
  return head + (blocks || `<div class="muted">Nessuna spesa trovata.</div>`) + tail;
}

export function openPdfPreview(html){
  const w = window.open("", "_blank");
  if(!w){ alert("Popup bloccato: consenti i pop-up per l’anteprima PDF."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}