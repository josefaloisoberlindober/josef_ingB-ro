// Kleine Helfer für die Oberfläche.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function lsLesen(k, std) {
  try { const v = localStorage.getItem("fs." + k); return v ? JSON.parse(v) : std; } catch { return std; }
}
export function lsSchreiben(k, v) { try { localStorage.setItem("fs." + k, JSON.stringify(v)); } catch { /* egal */ } }

let toastT;
export function toast(text, ms = 2600) {
  const el = $("#toast"); el.textContent = text; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), ms);
}

let sheetZu = null;
/** Öffnet ein Sheet; html wird eingesetzt, init(el) bindet Ereignisse. Gibt Promise beim Schließen. */
export function sheet(html, init) {
  const h = $("#sheet-huelle"), s = $("#sheet");
  s.innerHTML = html; h.hidden = false; s.scrollTop = 0;
  return new Promise(res => {
    sheetZu = v => { h.hidden = true; s.innerHTML = ""; sheetZu = null; res(v); };
    h.onclick = e => { if (e.target === h) sheetZu(null); };
    init?.(s, sheetZu);
  });
}
export const schliesseSheet = v => sheetZu?.(v);

export function frage(text, ja = "OK", nein = "Abbrechen", gefahr = false) {
  return sheet(`<h2>${esc(text)}</h2><div class="fuss"><button class="btn" data-n>${esc(nein)}</button>
    <button class="btn ${gefahr ? "gefahr" : "primaer"}" data-j>${esc(ja)}</button></div>`,
    (s, zu) => { $("[data-n]", s).onclick = () => zu(false); $("[data-j]", s).onclick = () => zu(true); });
}
export function eingabe(titel, wert = "") {
  return sheet(`<h2>${esc(titel)}</h2><input class="feld" id="eg" value="${esc(wert)}">
    <div class="fuss"><button class="btn" data-n>Abbrechen</button><button class="btn primaer" data-j>OK</button></div>`,
    (s, zu) => {
      const i = $("#eg", s); setTimeout(() => i.focus(), 50);
      $("[data-n]", s).onclick = () => zu(null); $("[data-j]", s).onclick = () => zu(i.value.trim());
      i.onkeydown = e => { if (e.key === "Enter") zu(i.value.trim()); };   // kein &&: false als Rückgabe blockiert jede Taste
    });
}

export function entprellt(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function herunterladen(blob, name) {
  // iPad: Teilen-Menü (AirDrop, Dateien) wenn möglich, sonst normaler Download
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function dateiWaehlen(accept) {
  return new Promise(res => {
    const i = Object.assign(document.createElement("input"), { type: "file", accept });
    i.onchange = () => res(i.files[0] || null); i.click();
  });
}
