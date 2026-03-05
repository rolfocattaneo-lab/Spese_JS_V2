import { openDb, STORES, put, add, get, getAll, del, getMeta, setMeta } from "./db.js";
import { $, uid, ymd, euro, escapeHtml, fileToAttachment, openAttachment, parseEuroToNumber, normName } from "./ui.js";
import { CSV_COLUMNS, exportCsv, importCsv } from "./csv.js";
import { buildReportHtml, openPdfPreview } from "./report.js";

let idb = null;
let editingKey = null;

bootstrap().catch(err => {
  console.error(err);
  alert("Errore init: " + (err?.message || err));
});

async function bootstrap(){
  idb = await openDb();
  await ensureSeed();

  bindTabs();
  bindActions();
  initCollapsibles();

  $("csvCols").textContent = "Colonne: " + CSV_COLUMNS.join(";");

  await ensureActiveUserFlow();
  await refreshAll();
}

async function ensureSeed(){
  const users = await getAll(idb, STORES.USERS);
  if(!users.length){
    const u = { id: uid(), name: "Default" };
    await put(idb, STORES.USERS, u);
    await put(idb, STORES.ACCOUNTS, { id: uid(), userId: u.id, name: "Contanti" });
    await setMeta(idb, "activeUserId", u.id);
  }

  const cats = await getAll(idb, STORES.CATEGORIES);
  if(!cats.length){
    // minime
    await safeAddCategory("Altro");
    await safeAddCategory("Alimentari");
    await safeAddCategory("Trasporti");
  }
}

async function ensureActiveUserFlow(){
  const users = await getAll(idb, STORES.USERS);
  let activeUserId = await getMeta(idb, "activeUserId");

  if(!activeUserId || !users.some(u=>u.id===activeUserId)){
    $("bootModal").classList.remove("hidden");
    fillUserSelect($("bootUserSelect"), users, null, false);

    $("btnBootContinue").onclick = async () => {
      const sel = $("bootUserSelect").value;
      await setMeta(idb, "activeUserId", sel);

      $("bootModal").classList.add("hidden");
      await refreshAll();
    };
  }
}

/* ----------------- Tabs ----------------- */
function bindTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active", b===btn));
      const tab = btn.dataset.tab;
      document.querySelectorAll(".panel").forEach(p=>p.classList.add("hidden"));
      $(`tab-${tab}`).classList.remove("hidden");

      if(tab === "report") await renderReport();
      if(tab === "categorie") await renderCategoriesTable();
    });
  });
}

/* ----------------- Actions ----------------- */
function bindActions(){
  $("btnChangeActiveUser")?.addEventListener("click", async ()=>{
    const sel = $("activeUserSelect").value;
    await setMeta(idb, "activeUserId", sel);

    // default: inserimento + filtri
    $("e_user").value = sel;
    await fillAccountsForUser($("e_account"), sel, false);

    $("f_user").value = sel;
    await fillAccountsForUser($("f_account"), sel, true, true);
    $("f_account").value = "";

    await refreshExpensesTable();
  });

  // Users
  $("btnAddUser")?.addEventListener("click", addUser);

  // Accounts
  $("btnAddAccount")?.addEventListener("click", addAccount);
  $("a_filter_user")?.addEventListener("change", renderAccountsTable);

  // Categories
  $("btnAddCategory")?.addEventListener("click", addCategory);

  // Entry: accounts depend from selected user
  $("e_user")?.addEventListener("change", async ()=> {
    await fillAccountsForUser($("e_account"), $("e_user").value, false);
  });

  // Filters: accounts depend from filter user
  $("f_user")?.addEventListener("change", async ()=> {
    const u = $("f_user").value;
    if(u){
      await fillAccountsForUser($("f_account"), u, true, true);
      $("f_account").value = "";
    } else {
      await fillAccountsAllUsersPrefixed($("f_account"));
      $("f_account").value = "";
    }
  });

  $("btnAddExpense")?.addEventListener("click", addExpense);
  $("btnClearExpense")?.addEventListener("click", clearExpenseForm);
  $("btnApplyFilters")?.addEventListener("click", refreshExpensesTable);
  $("btnResetFilters")?.addEventListener("click", async ()=>{ await setDefaultFiltersFromActive(); await refreshExpensesTable(); });

  // Report
  $("r_user")?.addEventListener("change", async ()=> {
    const userId = $("r_user").value;
    if(userId){
      await fillAccountsForUser($("r_account"), userId, true, true);
      $("r_account").value = "";
    } else {
      await fillAccountsAllUsersPrefixed($("r_account"));
      $("r_account").value = "";
    }
  });
  $("btnRefreshReport")?.addEventListener("click", renderReport);
  $("btnPreviewPdf")?.addEventListener("click", previewPdf);

  // CSV
  $("btnExportCsv")?.addEventListener("click", exportAllCsv);
  $("btnImportCsv")?.addEventListener("click", importAllCsv);

  // Modal
  $("btnCloseModal")?.addEventListener("click", closeModal);
  $("m_user")?.addEventListener("change", async ()=>{
    const userId = $("m_user").value;
    await fillAccountsForUser($("m_account"), userId, false);
  });
  $("btnSaveExpense")?.addEventListener("click", saveExpenseEdit);
  $("btnDeleteExpense")?.addEventListener("click", deleteExpenseEdit);
  $("btnOpenAttach")?.addEventListener("click", openEditAttachment);
  $("btnRemoveAttach")?.addEventListener("click", removeEditAttachment);
}

/* ----------------- Collapsibles ----------------- */
function initCollapsibles(){
  const apply = () => {
    const isMobile = window.matchMedia("(max-width:760px)").matches;
    document.querySelectorAll(".collapsible").forEach(el=>{
      const key = el.getAttribute("data-collapsible");
      const saved = localStorage.getItem("coll_"+key);

      if(isMobile){
        // default: newExpense + filters chiusi se non c’è preferenza
        const defaultCollapsed = (key === "newExpense" || key === "filters");
        if(saved === null){
          el.classList.toggle("collapsed", defaultCollapsed);
        } else {
          el.classList.toggle("collapsed", saved === "collapsed");
        }
      } else {
        el.classList.remove("collapsed");
      }
    });
  };

  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-collapsible-toggle]");
    if(!btn) return;
    const box = btn.closest(".collapsible");
    if(!box) return;
    const key = box.getAttribute("data-collapsible");
    box.classList.toggle("collapsed");
    localStorage.setItem("coll_"+key, box.classList.contains("collapsed") ? "collapsed" : "expanded");
  });

  window.addEventListener("resize", apply);
  apply();
}

/* ----------------- Select helpers ----------------- */
function fillUserSelect(sel, users, selectedId, includeAll=false){
  sel.innerHTML = "";
  if(includeAll){
    const o = document.createElement("option");
    o.value = ""; o.textContent = "Tutti";
    sel.appendChild(o);
  }
  users.sort((a,b)=>a.name.localeCompare(b.name));
  for(const u of users){
    const o = document.createElement("option");
    o.value = u.id; o.textContent = u.name;
    sel.appendChild(o);
  }
  if(selectedId) sel.value = selectedId;
}

async function fillAccountsForUser(sel, userId, includeAll=false, allowAllLabel=false){
  sel.innerHTML = "";
  if(includeAll){
    const o = document.createElement("option");
    o.value = "";
    o.textContent = allowAllLabel ? "Tutti" : "Seleziona...";
    sel.appendChild(o);
  }
  if(!userId) return;

  const all = await getAll(idb, STORES.ACCOUNTS);
  const accounts = all.filter(a => a.userId === userId).sort((a,b)=>a.name.localeCompare(b.name));
  for(const a of accounts){
    const o = document.createElement("option");
    o.value = a.id; o.textContent = a.name;
    sel.appendChild(o);
  }
}

async function fillAccountsAllUsersPrefixed(sel){
  sel.innerHTML = "";
  const o = document.createElement("option");
  o.value = ""; o.textContent = "Tutti";
  sel.appendChild(o);

  const users = await getAll(idb, STORES.USERS);
  const userMap = new Map(users.map(u=>[u.id,u.name]));
  const accounts = await getAll(idb, STORES.ACCOUNTS);
  accounts.sort((a,b)=>{
    const ua = (userMap.get(a.userId)||"").localeCompare(userMap.get(b.userId)||"");
    if(ua!==0) return ua;
    return (a.name||"").localeCompare(b.name||"");
  });

  for(const a of accounts){
    const name = `${userMap.get(a.userId) || "?"} / ${a.name}`;
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

async function fillCategorySelect(sel, includeAll=false, selectedId=null){
  sel.innerHTML = "";
  if(includeAll){
    const o = document.createElement("option");
    o.value = ""; o.textContent = "Tutte";
    sel.appendChild(o);
  }
  const cats = await getAll(idb, STORES.CATEGORIES);
  cats.sort((a,b)=>a.name.localeCompare(b.name));
  for(const c of cats){
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  }
  if(selectedId) sel.value = selectedId;
}

/* ----------------- Default filters ----------------- */
function setDefaultDateRangeInputs(fromId, toId){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
  $(fromId).value = ymd(start);
  $(toId).value = ymd(end);
}

function getCurrentMonthRangeISO(){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
  return { from: ymd(start), to: ymd(end) }; // YYYY-MM-DD
}

async function setDefaultFiltersFromActive(){
  const activeUserId = await getMeta(idb, "activeUserId");

  setDefaultDateRangeInputs("f_from","f_to");
  $("f_text").value = "";

  $("f_user").value = activeUserId;
  await fillAccountsForUser($("f_account"), activeUserId, true, true);
  $("f_account").value = "";

  await fillCategorySelect($("f_category"), true, "");
  $("f_category").value = "";
}

/* ----------------- Refresh all ----------------- */
async function refreshAll(){
  const users = await getAll(idb, STORES.USERS);
  let activeUserId = await getMeta(idb, "activeUserId");
  if(!activeUserId && users[0]) activeUserId = users[0].id;

  fillUserSelect($("activeUserSelect"), users, activeUserId, false);

  fillUserSelect($("e_user"), users, activeUserId, false);
  fillUserSelect($("m_user"), users, activeUserId, false);

  fillUserSelect($("f_user"), users, activeUserId, true);
  fillUserSelect($("r_user"), users, activeUserId, true);

  fillUserSelect($("a_user"), users, activeUserId, false);
  fillUserSelect($("a_filter_user"), users, activeUserId, false);

  // categories selects
  await fillCategorySelect($("e_category"), false, null);
  await fillCategorySelect($("m_category"), false, null);
  await fillCategorySelect($("f_category"), true, "");
  await fillCategorySelect($("r_category"), true, "");

  $("e_date").value = $("e_date").value || ymd(new Date());

  $("e_user").value = activeUserId;
  await fillAccountsForUser($("e_account"), activeUserId, false);

  if(!$("f_from").value || !$("f_to").value){
    await setDefaultFiltersFromActive();
  }

  if(!$("r_from").value || !$("r_to").value){
    setDefaultDateRangeInputs("r_from","r_to");
  }
  if($("r_user").value === ""){
    $("r_user").value = activeUserId;
  }
  await fillAccountsForUser($("r_account"), $("r_user").value || activeUserId, true, true);
  $("r_account").value = "";
  $("r_category").value = $("r_category").value || "";

  await renderUsersTable();
  await renderAccountsTable();
  await renderCategoriesTable();
  await refreshExpensesTable();
  await refreshStorageHint();
}

/* ----------------- USERS ----------------- */
async function addUser(){
  const name = $("u_name").value.trim();
  if(!name) return alert("Nome utente obbligatorio.");

  const users = await getAll(idb, STORES.USERS);
  if(users.some(u => u.name.toLowerCase() === name.toLowerCase())){
    return alert("Esiste già un utente con questo nome.");
  }

  const u = { id: uid(), name };
  await put(idb, STORES.USERS, u);
  await put(idb, STORES.ACCOUNTS, { id: uid(), userId: u.id, name: "Contanti" });

  $("u_name").value = "";
  await refreshAll();
}

async function renderUsersTable(){
  const users = await getAll(idb, STORES.USERS);
  users.sort((a,b)=>a.name.localeCompare(b.name));

  const tb = $("tbodyUsers");
  tb.innerHTML = "";

  for(const u of users){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.name)}</td>
      <td class="mono">${escapeHtml(u.id)}</td>
      <td class="r"><button class="danger" data-del="${escapeHtml(u.id)}" type="button">Elimina</button></td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.del;
      const allUsers = await getAll(idb, STORES.USERS);
      if(allUsers.length <= 1) return alert("Non puoi eliminare l’ultimo utente.");

      if(!confirm("Eliminare utente? Verranno eliminati anche conti e spese dell’utente.")) return;

      const expenses = await getAll(idb, STORES.EXPENSES);
      for(const e of expenses){
        if(e.userId === id) await del(idb, STORES.EXPENSES, e.key);
      }

      const accounts = await getAll(idb, STORES.ACCOUNTS);
      for(const a of accounts){
        if(a.userId === id) await del(idb, STORES.ACCOUNTS, a.id);
      }

      await del(idb, STORES.USERS, id);

      const active = await getMeta(idb, "activeUserId");
      if(active === id){
        const remaining = (await getAll(idb, STORES.USERS))[0];
        await setMeta(idb, "activeUserId", remaining.id);
      }
      await refreshAll();
    });
  });
}

/* ----------------- ACCOUNTS ----------------- */
async function addAccount(){
  const userId = $("a_user").value;
  const name = $("a_name").value.trim();
  if(!userId) return alert("Seleziona un utente.");
  if(!name) return alert("Nome conto obbligatorio.");

  const accounts = await getAll(idb, STORES.ACCOUNTS);
  if(accounts.some(a => a.userId===userId && a.name.toLowerCase() === name.toLowerCase())){
    return alert("Questo utente ha già un conto con lo stesso nome.");
  }

  await put(idb, STORES.ACCOUNTS, { id: uid(), userId, name });
  $("a_name").value = "";
  await refreshAll();
}

async function renderAccountsTable(){
  const userId = $("a_filter_user").value;
  const accounts = (await getAll(idb, STORES.ACCOUNTS))
    .filter(a => a.userId === userId)
    .sort((a,b)=>a.name.localeCompare(b.name));

  const tb = $("tbodyAccounts");
  tb.innerHTML = "";

  for(const a of accounts){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(a.name)}</td>
      <td class="mono">${escapeHtml(a.id)}</td>
      <td class="r"><button class="danger" data-del="${escapeHtml(a.id)}" type="button">Elimina</button></td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.del;
      if(!confirm("Eliminare conto? Le spese legate a questo conto verranno eliminate (conto obbligatorio).")) return;

      const expenses = await getAll(idb, STORES.EXPENSES);
      for(const e of expenses){
        if(e.accountId === id) await del(idb, STORES.EXPENSES, e.key);
      }
      await del(idb, STORES.ACCOUNTS, id);
      await refreshAll();
    });
  });
}

/* ----------------- CATEGORIES ----------------- */
async function safeAddCategory(name){
  const n = String(name||"").trim();
  if(!n) return null;
  const norm = normName(n);

  const cats = await getAll(idb, STORES.CATEGORIES);
  const existing = cats.find(c => c.norm === norm);
  if(existing) return existing;

  const row = { id: uid(), name: n, norm };
  try{
    await add(idb, STORES.CATEGORIES, row);
    return row;
  }catch{
    // se unique index clash (race), ricarico
    const cats2 = await getAll(idb, STORES.CATEGORIES);
    return cats2.find(c => c.norm === norm) || null;
  }
}

async function addCategory(){
  const name = $("c_name").value.trim();
  if(!name) return alert("Nome categoria obbligatorio.");

  const row = await safeAddCategory(name);
  if(!row) return alert("Errore creazione categoria.");

  $("c_name").value = "";
  await refreshAll();
}

async function renderCategoriesTable(){
  const cats = await getAll(idb, STORES.CATEGORIES);
  cats.sort((a,b)=>a.name.localeCompare(b.name));

  const tb = $("tbodyCategories");
  tb.innerHTML = "";

  for(const c of cats){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td class="mono">${escapeHtml(c.id)}</td>
      <td class="r"><button class="danger" data-del="${escapeHtml(c.id)}" type="button">Elimina</button></td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.del;
      if(!confirm("Eliminare categoria?")) return;
      await del(idb, STORES.CATEGORIES, id);
      await refreshAll();
    });
  });
}

/* ----------------- Expense ID per user ----------------- */
async function nextExpenseIdForUser(userId){
  const key = `counter_expense_${userId}`;
  const current = await getMeta(idb, key);
  const next = Number(current || 0) + 1;
  await setMeta(idb, key, next);
  return next;
}

async function ensureAccountExistsOrWarn(userId){
  const accounts = (await getAll(idb, STORES.ACCOUNTS)).filter(a => a.userId === userId);
  if(accounts.length === 0){
    alert("Questo utente non ha conti. Crea prima un conto nella tab 'Conti'.");
    return false;
  }
  return true;
}

/* ----------------- Expenses add ----------------- */
async function addExpense(){
  const userId = $("e_user").value;
  if(!userId) return alert("Seleziona un utente.");
  if(!(await ensureAccountExistsOrWarn(userId))) return;

  const accountId = $("e_account").value;
  if(!accountId) return alert("Conto obbligatorio.");

  const categoryId = $("e_category").value;
  if(!categoryId) return alert("Categoria obbligatoria.");

  const desc = $("e_desc").value.trim();
  const amount = parseEuroToNumber($("e_amount").value);
  const date = $("e_date").value;
  const rec = $("e_rec").value === "1";
  const recEnd = $("e_recEnd").value;

  if(!desc) return alert("Descrizione obbligatoria.");
  if(!Number.isFinite(amount) || amount<=0) return alert("Importo non valido (>0).");
  if(!date) return alert("Data obbligatoria.");

  const users = await getAll(idb, STORES.USERS);
  const user = users.find(u=>u.id===userId);

  const accounts = await getAll(idb, STORES.ACCOUNTS);
  const account = accounts.find(a=>a.id===accountId);
  if(!account || account.userId !== userId){
    return alert("Conto non valido per questo utente.");
  }

  const cats = await getAll(idb, STORES.CATEGORIES);
  const cat = cats.find(c=>c.id===categoryId);
  if(!cat){
    return alert("Categoria non valida.");
  }

  let allegato_nome="", allegato_mime="", allegato_base64="";
  const file = $("e_attach").files?.[0];
  if(file){
    const att = await fileToAttachment(file);
    allegato_nome = att.name; allegato_mime = att.mime; allegato_base64 = att.base64;
  }

  const expenseId = await nextExpenseIdForUser(userId);
  const key = `${userId}-${expenseId}`;

  const e = {
    key,
    userId,
    userName: user?.name || "",
    expenseId,

    accountId,
    accountName: account?.name || "",

    categoryId: cat.id,
    categoryName: cat.name,
    categoria: cat.name, // legacy

    descrizione: desc,
    importo: amount,
    data_spesa: date,

    ricorrente: rec,
    data_fine_ricorrenza: rec ? (recEnd || "") : "",

    allegato_nome, allegato_mime, allegato_base64
  };

  await put(idb, STORES.EXPENSES, e);

  clearExpenseForm();
  await refreshExpensesTable();
  await refreshStorageHint();
}

function clearExpenseForm(){
  $("e_desc").value="";
  $("e_amount").value="";
  $("e_rec").value="0";
  $("e_recEnd").value="";
  $("e_attach").value="";
}

/* ----------------- Filters & render expenses ----------------- */
function validateExpenseFilters(){
  const from = $("f_from").value;
  const to = $("f_to").value;
  if(!from || !to){ alert("Range date obbligatorio (Da/A)."); return null; }
  if(from > to){ alert("'Da' deve essere <= 'A'."); return null; }

  return {
    from, to,
    userId: $("f_user").value || "",
    accountId: $("f_account").value || "",
    categoryId: $("f_category").value || "",
    text: $("f_text").value.trim()
  };
}

async function refreshExpensesTable(){
  const f = validateExpenseFilters();
  if(!f) return;

  if(f.userId){
    await fillAccountsForUser($("f_account"), f.userId, true, true);
  } else {
    await fillAccountsAllUsersPrefixed($("f_account"));
  }

  let exps = await getAll(idb, STORES.EXPENSES);

  exps = exps.filter(e => e.data_spesa >= f.from && e.data_spesa <= f.to);
  if(f.userId) exps = exps.filter(e => e.userId === f.userId);
  if(f.accountId) exps = exps.filter(e => e.accountId === f.accountId);
  if(f.categoryId) exps = exps.filter(e => e.categoryId === f.categoryId);
  if(f.text){
    const t = f.text.toLowerCase();
    exps = exps.filter(e => (e.descrizione||"").toLowerCase().includes(t));
  }

  exps.sort((a,b)=>{
    const d = a.data_spesa.localeCompare(b.data_spesa);
    if(d!==0) return d;
    const u = (a.userName||"").localeCompare(b.userName||"");
    if(u!==0) return u;
    const ac = (a.accountName||"").localeCompare(b.accountName||"");
    if(ac!==0) return ac;
    const c = (a.categoryName||"").localeCompare(b.categoryName||"");
    if(c!==0) return c;
    return (a.expenseId||0)-(b.expenseId||0);
  });

  $("kpiFiltered").textContent = `Filtrate: ${exps.length}`;
  const total = exps.reduce((a,x)=>a+Number(x.importo||0),0);
  $("kpiTotal").textContent = `Totale: ${euro(total)}`;

  const tb = $("tbodyExpenses");
  tb.innerHTML = "";
  for(const e of exps){
    const hasAtt = !!(e.allegato_base64 && e.allegato_mime);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.userName)}</td>
      <td>${escapeHtml(e.accountName)}</td>
      <td class="mono">${e.expenseId}</td>
      <td class="mono">${e.data_spesa}</td>
      <td>${escapeHtml(e.categoryName || "(Categoria mancante)")}</td>
      <td>${escapeHtml(e.descrizione)}</td>
      <td>${e.ricorrente ? "Sì" : "No"}</td>
      <td>${hasAtt ? `<button class="ghost" data-open="${escapeHtml(e.key)}" type="button">${e.allegato_mime.includes("pdf")?"PDF":"IMG"}</button>` : "—"}</td>
      <td class="r">${euro(e.importo)}</td>
      <td class="r"><button data-edit="${escapeHtml(e.key)}" type="button">Modifica</button></td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll("button[data-edit]").forEach(b=> b.addEventListener("click", ()=>openModal(b.dataset.edit)));
  tb.querySelectorAll("button[data-open]").forEach(b=> b.addEventListener("click", async ()=>{
    const e = await get(idb, STORES.EXPENSES, b.dataset.open);
    if(e) openAttachment(e.allegato_mime, e.allegato_base64);
  }));

  // Mobile cards (accordion)
  const mob = $("mobileExpenses");
  mob.innerHTML = "";
  for(const e of exps){
    const hasAtt = !!(e.allegato_base64 && e.allegato_mime);

    const card = document.createElement("div");
    card.className = "expCard collapsed";
    card.dataset.key = e.key;

    card.innerHTML = `
      <div class="expSummary">
        <div>
          <div class="expTitle">${escapeHtml(e.descrizione)}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div class="expAmount">${euro(e.importo)}</div>
          <button class="expChevron" type="button" data-exp-toggle>▾</button>
        </div>
      </div>

      <div class="expDetails">
        <div class="expMeta">
          <span class="badge">${escapeHtml(e.userName)}</span>
          <span class="badge">${escapeHtml(e.accountName)}</span>
          <span class="badge">${e.data_spesa}</span>
          <span class="badge">${escapeHtml(e.categoryName || "(Categoria mancante)")}</span>
          <span class="badge">ID ${e.expenseId}</span>
          ${e.ricorrente ? `<span class="badge">Ricorrente</span>` : ""}
          ${hasAtt ? `<span class="badge">${e.allegato_mime.includes("pdf")?"PDF":"IMG"}</span>` : ""}
        </div>
      </div>

      <div class="expActions">
        ${hasAtt ? `<button class="ghost" type="button" data-open="${escapeHtml(e.key)}">Apri ricevuta</button>` : ""}
        <button type="button" data-edit="${escapeHtml(e.key)}">Modifica</button>
      </div>
    `;
    mob.appendChild(card);
  }

  mob.querySelectorAll(".expCard").forEach(c => c.classList.add("collapsed"));

  mob.querySelectorAll("[data-exp-toggle]").forEach(btn=>{
    btn.addEventListener("click", (ev)=>{
      const card = ev.target.closest(".expCard");
      if(!card) return;
      const willOpen = card.classList.contains("collapsed");
      mob.querySelectorAll(".expCard").forEach(c => c.classList.add("collapsed"));
      if(willOpen) card.classList.remove("collapsed");
    });
  });

  mob.querySelectorAll("button[data-edit]").forEach(b=> b.addEventListener("click", ()=>openModal(b.dataset.edit)));
  mob.querySelectorAll("button[data-open]").forEach(b=> b.addEventListener("click", async ()=>{
    const e = await get(idb, STORES.EXPENSES, b.dataset.open);
    if(e) openAttachment(e.allegato_mime, e.allegato_base64);
  }));

  $("emptyExpenses").style.display = exps.length ? "none" : "block";
}

/* ----------------- Storage hint ----------------- */
async function refreshStorageHint(){
  const expenses = await getAll(idb, STORES.EXPENSES);
  const attachments = expenses.filter(e=>e.allegato_base64).length;
  $("storageHint").textContent = `Spese: ${expenses.length} • Allegati: ${attachments} • (ID per utente: userId-expenseId)`;
}

/* ----------------- Modal edit ----------------- */
async function openModal(key){
  const e = await get(idb, STORES.EXPENSES, key);
  if(!e) return;
  editingKey = key;

  const users = await getAll(idb, STORES.USERS);
  fillUserSelect($("m_user"), users, e.userId, false);
  await fillAccountsForUser($("m_account"), e.userId, false);
  $("m_account").value = e.accountId;

  await fillCategorySelect($("m_category"), false, e.categoryId || null);

  $("m_desc").value = e.descrizione || "";
  $("m_amount").value = String(e.importo ?? "").replace(".", ",");
  $("m_date").value = e.data_spesa || "";
  $("m_rec_ro").value = e.ricorrente ? "Sì" : "No";
  $("m_recEnd").value = e.data_fine_ricorrenza || "";

  $("m_attach").value = "";
  const has = !!(e.allegato_base64 && e.allegato_mime);
  $("m_attachInfo").textContent = has ? `${e.allegato_nome || "(senza nome)"} • ${e.allegato_mime}` : "Nessuna ricevuta";
  $("btnOpenAttach").disabled = !has;

  $("modal").classList.remove("hidden");
  document.querySelector(".modalCard")?.scrollTo({ top: 0 });
}

function closeModal(){
  editingKey = null;
  $("modal").classList.add("hidden");
}

async function saveExpenseEdit(){
  const old = await get(idb, STORES.EXPENSES, editingKey);
  if(!old) return;

  const newUserId = $("m_user").value;
  if(!newUserId) return alert("Utente obbligatorio.");
  if(!(await ensureAccountExistsOrWarn(newUserId))) return;

  const accountId = $("m_account").value;
  if(!accountId) return alert("Conto obbligatorio.");

  const categoryId = $("m_category").value;
  if(!categoryId) return alert("Categoria obbligatoria.");

  const desc = $("m_desc").value.trim();
  const amount = parseEuroToNumber($("m_amount").value);
  const date = $("m_date").value;
  const recEnd = $("m_recEnd").value;

  if(!desc) return alert("Descrizione obbligatoria.");
  if(!Number.isFinite(amount) || amount<=0) return alert("Importo non valido (>0).");
  if(!date) return alert("Data obbligatoria.");

  const users = await getAll(idb, STORES.USERS);
  const user = users.find(u=>u.id===newUserId);

  const accounts = await getAll(idb, STORES.ACCOUNTS);
  const account = accounts.find(a=>a.id===accountId);
  if(!account || account.userId !== newUserId){
    return alert("Conto non valido per questo utente.");
  }

  const cats = await getAll(idb, STORES.CATEGORIES);
  const cat = cats.find(c=>c.id===categoryId);
  if(!cat) return alert("Categoria non valida.");

  const updated = { ...old };
  updated.userId = newUserId;
  updated.userName = user?.name || "";
  updated.accountId = accountId;
  updated.accountName = account?.name || "";

  updated.categoryId = cat.id;
  updated.categoryName = cat.name;
  updated.categoria = cat.name; // legacy

  updated.descrizione = desc;
  updated.importo = amount;
  updated.data_spesa = date;
  updated.data_fine_ricorrenza = old.ricorrente ? (recEnd || "") : "";

  const file = $("m_attach").files?.[0];
  if(file){
    const att = await fileToAttachment(file);
    updated.allegato_nome = att.name;
    updated.allegato_mime = att.mime;
    updated.allegato_base64 = att.base64;
  }

  if(newUserId !== old.userId){
    const newExpenseId = await nextExpenseIdForUser(newUserId);
    const newKey = `${newUserId}-${newExpenseId}`;
    updated.expenseId = newExpenseId;
    updated.key = newKey;

    await del(idb, STORES.EXPENSES, old.key);
    await put(idb, STORES.EXPENSES, updated);
  } else {
    await put(idb, STORES.EXPENSES, updated);
  }

  closeModal();
  await refreshExpensesTable();
  await refreshStorageHint();
}

async function deleteExpenseEdit(){
  if(!editingKey) return;
  if(!confirm("Eliminare questa spesa?")) return;
  await del(idb, STORES.EXPENSES, editingKey);
  closeModal();
  await refreshExpensesTable();
  await refreshStorageHint();
}

async function openEditAttachment(){
  const e = await get(idb, STORES.EXPENSES, editingKey);
  if(e) openAttachment(e.allegato_mime, e.allegato_base64);
}

async function removeEditAttachment(){
  const e = await get(idb, STORES.EXPENSES, editingKey);
  if(!e) return;
  if(!confirm("Rimuovere la ricevuta?")) return;
  e.allegato_nome=""; e.allegato_mime=""; e.allegato_base64="";
  await put(idb, STORES.EXPENSES, e);
  await openModal(editingKey);
}

/* ----------------- CSV ----------------- */
async function exportAllCsv(){
  const exps = await getAll(idb, STORES.EXPENSES);
  const csv = exportCsv(exps);

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`spese_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

async function importAllCsv(){
  const file = $("csvFile").files?.[0];
  if(!file) return alert("Seleziona un CSV.");
  const text = await file.text();

  const res = importCsv(text);
  $("importLog").textContent = res.msg;
  if(!res.ok) return;

  for(const e of res.rows){
    let user = await get(idb, STORES.USERS, e.userId);
    if(!user){
      user = { id: e.userId, name: e.userName || `User_${e.userId.slice(0,6)}` };
      await put(idb, STORES.USERS, user);
    }

    let acc = await get(idb, STORES.ACCOUNTS, e.accountId);
    if(!acc){
      acc = { id: e.accountId, userId: e.userId, name: e.accountName || "Conto" };
      await put(idb, STORES.ACCOUNTS, acc);
    }

    // categorie: se ho categoryId + name, la creo se manca.
    // se ho solo categoryName/categoria, la creo e assegno id.
    let catId = e.categoryId;
    let catName = (e.categoryName || e.categoria || "Altro").trim() || "Altro";

    if(catId){
      const existing = await get(idb, STORES.CATEGORIES, catId);
      if(!existing){
        await put(idb, STORES.CATEGORIES, { id: catId, name: catName, norm: normName(catName) });
      }
    } else {
      const created = await safeAddCategory(catName);
      catId = created?.id || null;
      catName = created?.name || catName;
    }

    e.categoryId = catId;
    e.categoryName = catName;
    e.categoria = catName;

    await put(idb, STORES.EXPENSES, e);

    const counterKey = `counter_expense_${e.userId}`;
    const cur = Number(await getMeta(idb, counterKey) || 0);
    if(Number(e.expenseId) > cur){
      await setMeta(idb, counterKey, Number(e.expenseId));
    }
  }

  $("importLog").textContent = res.msg + " • Import completato.";
  await refreshAll();
}

/* ----------------- REPORT ----------------- */
function validateReportFilters(){
  const from = $("r_from").value;
  const to = $("r_to").value;
  if(!from || !to){ alert("Range date obbligatorio (Da/A)."); return null; }
  if(from > to){ alert("'Da' deve essere <= 'A'."); return null; }
  return {
    from, to,
    userId: $("r_user").value || "",
    accountId: $("r_account").value || "",
    categoryId: $("r_category").value || ""
  };
}

async function renderReport(){
  const f = validateReportFilters();
  if(!f) return;

  if(f.userId){
    await fillAccountsForUser($("r_account"), f.userId, true, true);
  } else {
    await fillAccountsAllUsersPrefixed($("r_account"));
  }

  let exps = await getAll(idb, STORES.EXPENSES);
  exps = exps.filter(e => e.data_spesa>=f.from && e.data_spesa<=f.to);
  if(f.userId) exps = exps.filter(e => e.userId === f.userId);
  if(f.accountId) exps = exps.filter(e => e.accountId === f.accountId);
  if(f.categoryId) exps = exps.filter(e => e.categoryId === f.categoryId);
  exps.sort((a,b)=>a.data_spesa.localeCompare(b.data_spesa));

  const users = await getAll(idb, STORES.USERS);
  const userName = f.userId ? (users.find(u=>u.id===f.userId)?.name || "") : "";

  const accounts = await getAll(idb, STORES.ACCOUNTS);
  const accountName = f.accountId ? (accounts.find(a=>a.id===f.accountId)?.name || "") : "";

  const cats = await getAll(idb, STORES.CATEGORIES);
  const categoryName = f.categoryId ? (cats.find(c=>c.id===f.categoryId)?.name || "") : "";

  const total = exps.reduce((a,x)=>a+Number(x.importo||0),0);

  // group by categoryName
  const grouped = new Map();
  for(const e of exps){
    const k = e.categoryName || "(Categoria mancante)";
    if(!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }
  const catKeys = [...grouped.keys()].sort((a,b)=>a.localeCompare(b));

  let html = `
    <div class="kpi">
      <span class="pill">Range: ${f.from} → ${f.to}</span>
      <span class="pill">Utente: ${escapeHtml(userName || "tutti")}</span>
      <span class="pill">Conto: ${escapeHtml(accountName || "tutti")}</span>
      <span class="pill">Categoria: ${escapeHtml(categoryName || "tutte")}</span>
      <span class="pill ok">Totale: ${euro(total)}</span>
    </div>
    <div class="hr"></div>
  `;

  for(const c of catKeys){
    const items = grouped.get(c);
    const sub = items.reduce((a,x)=>a+Number(x.importo||0),0);
    const rows = items.map(e=>`
      <tr>
        <td>${escapeHtml(e.userName)}</td>
        <td>${escapeHtml(e.accountName)}</td>
        <td class="mono">${e.expenseId}</td>
        <td class="mono">${e.data_spesa}</td>
        <td>${escapeHtml(e.descrizione)}</td>
        <td class="r">${euro(e.importo)}</td>
      </tr>
    `).join("");

    html += `
      <h3>${escapeHtml(c)} <span class="pill">Subtotale: ${euro(sub)}</span></h3>
      <div class="tableWrap">
        <table>
          <thead><tr><th>Utente</th><th>Conto</th><th>ID</th><th>Data</th><th>Descrizione</th><th class="r">Importo</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hr"></div>
    `;
  }

  if(!catKeys.length) html += `<div class="hint">Nessuna spesa trovata.</div>`;
  $("reportOut").innerHTML = html;
}

async function previewPdf(){
  const f = validateReportFilters();
  if(!f) return;

  let exps = await getAll(idb, STORES.EXPENSES);
  exps = exps.filter(e => e.data_spesa>=f.from && e.data_spesa<=f.to);
  if(f.userId) exps = exps.filter(e => e.userId === f.userId);
  if(f.accountId) exps = exps.filter(e => e.accountId === f.accountId);
  if(f.categoryId) exps = exps.filter(e => e.categoryId === f.categoryId);
  exps.sort((a,b)=>a.data_spesa.localeCompare(b.data_spesa));

  const users = await getAll(idb, STORES.USERS);
  const userName = f.userId ? (users.find(u=>u.id===f.userId)?.name || "") : "";

  const accounts = await getAll(idb, STORES.ACCOUNTS);
  const accountName = f.accountId ? (accounts.find(a=>a.id===f.accountId)?.name || "") : "";

  const cats = await getAll(idb, STORES.CATEGORIES);
  const categoryName = f.categoryId ? (cats.find(c=>c.id===f.categoryId)?.name || "") : "";

  const html = buildReportHtml({
    filters: { ...f, userName, accountName, categoryName },
    expenses: exps
  });
  openPdfPreview(html);

}
