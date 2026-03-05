export const $ = (id) => document.getElementById(id);

export function uid(){
  return crypto?.randomUUID?.() ?? (Date.now()+"_"+Math.random().toString(16).slice(2));
}

export function euro(n){
  return Number(n||0).toLocaleString("it-IT",{style:"currency",currency:"EUR"});
}

export function ymd(d){
  const z=(x)=>String(x).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}

export function escapeHtml(x){
  return String(x ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

export async function fileToAttachment(file){
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Errore lettura file"));
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      resolve(i>=0 ? s.slice(i+1) : "");
    };
    r.readAsDataURL(file);
  });
  return { name: file.name, mime: file.type || "", base64 };
}

export function openAttachment(mime, base64){
  if(!mime || !base64) return;
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for(let i=0;i<byteChars.length;i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if(!w) alert("Popup bloccato: consenti pop-up per aprire la ricevuta.");
  setTimeout(()=>URL.revokeObjectURL(url), 60_000);
}

export function parseEuroToNumber(input){
  let s = String(input ?? "").trim();
  if(!s) return NaN;

  s = s.replace(/\s/g,"").replace(/€/g,"");

  if(s.includes(",") && s.includes(".")){
    s = s.replace(/\./g,"").replace(",",".");
  } else if(s.includes(",")){
    s = s.replace(",",".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function normName(s){
  return String(s ?? "").trim().toLowerCase();
}