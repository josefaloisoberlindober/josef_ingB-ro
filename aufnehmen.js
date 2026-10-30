// Modus „Aufnehmen“: GPS-Punkte mit den Attributen aus dem Feldaufnahme-Formular (Blatt 2/3).
import { app, geaendert } from "./main.js";
import { karte, setzeDaten, kreis } from "./karte.js";
import { hoehe } from "./dem.js";
import { stationen, abstandLL, aufLinie, fmt, hm } from "./geo.js";
import { $, $$, esc, toast, sheet, frage } from "./ui.js";
import * as store from "./store.js";
import { aktiveVariante } from "./planen.js";

export const CODES = [
  ["TA", "Achse"], ["AP", "Anfang"], ["EP", "Ende"], ["ZW", "Zwangspunkt"], ["KE", "Kehre"], ["UP", "Umkehrplatz"],
  ["LP", "Lagerplatz"], ["GQ", "Gerinnequerung"], ["QU", "Quelle/Vernässung"], ["FE", "Fels"], ["RU", "Rutschung"],
  ["BE", "Berme/Altweg"], ["GR", "Grenzpunkt"], ["BB", "Biotopbaum/Horst"], ["ST", "Seiltrassenstart"],
];
const BODEN = [["S", "Skelett"], ["L", "Lehm"], ["T", "Ton"], ["H", "Humus"], ["G", "Fels anst."]];
const FELS = [["0", "kein"], ["1", "reißbar"], ["2", "kompakt"]];
const WASSER = [["0", "trocken"], ["Z", "zeitweise"], ["G", "Gerinne"], ["Q", "Quelle"], ["N", "nass"]];

let panel = null, aktivModus = false, watchId = null, fix = null, folgen = false, sammler = null, wakeLock = null;
const E = () => app.projekt.einstellungen;
const pkte = () => app.projekt.punkte;

// ---------- Karte ----------
export function zeichneAufnahme() {
  if (!app.projekt) return;
  const p = pkte();
  setzeDaten("aufnahme-punkte", { type: "FeatureCollection", features: p.map(q => ({
    type: "Feature", properties: { name: q.name, code: q.code || "TA" }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } })) });
  setzeDaten("aufnahme-linie", { type: "FeatureCollection", features: p.length > 1 ? [{
    type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.map(q => [q.lon, q.lat]) } }] : [] });
}
function zeichnePosition() {
  setzeDaten("position", { type: "FeatureCollection", features: fix ? [
    { type: "Feature", properties: { art: "genau" }, geometry: kreis([fix.lon, fix.lat], fix.acc) },
    { type: "Feature", properties: { art: "pos" }, geometry: { type: "Point", coordinates: [fix.lon, fix.lat] } }] : [] });
}

// ---------- GPS ----------
function gpsStart() {
  if (watchId != null) return;
  if (!navigator.geolocation) { toast("Dieses Gerät liefert keine Position."); return; }
  watchId = navigator.geolocation.watchPosition(pos => {
    const c = pos.coords;
    fix = { lon: c.longitude, lat: c.latitude, acc: c.accuracy, alt: c.altitude, altAcc: c.altitudeAccuracy, t: pos.timestamp };
    sammler?.push(fix);
    zeichnePosition();
    if (folgen) karte.easeTo({ center: [fix.lon, fix.lat], duration: 400 });
    if (aktivModus) zeigeGPS();
  }, err => {
    toast(err.code === 1 ? "Standortzugriff verweigert – in den Einstellungen für Safari erlauben." : "GPS: " + err.message, 6000);
    gpsStopp();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  navigator.wakeLock?.request("screen").then(w => (wakeLock = w)).catch(() => {});
  if (aktivModus) render();
}
function gpsStopp() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; fix = null; wakeLock?.release?.(); wakeLock = null; zeichnePosition();
  if (aktivModus) render();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && watchId != null) navigator.wakeLock?.request("screen").then(w => (wakeLock = w)).catch(() => {});
});

export function bindePositionsKnopf() {
  const b = $("#btn-position");
  b.onclick = () => {
    folgen = !folgen; b.classList.toggle("an", folgen);
    if (folgen) { gpsStart(); if (fix) karte.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(karte.getZoom(), 17) }); }
  };
  karte.on("dragstart", () => { if (folgen) { folgen = false; b.classList.remove("an"); } });
}

// ---------- Hilfen ----------
function naechsterName() {
  let n = 0; for (const p of pkte()) { const m = /^P(\d+)/i.exec(p.name); if (m) n = Math.max(n, +m[1]); }
  return "P" + (n + 1);
}
const letzter = () => pkte()[pkte().length - 1];
function seitQN() {
  const p = pkte(); let L = 0;
  for (let i = p.length - 1; i > 0; i--) {
    if (p[i].qn_berg || p[i].qn_tal) return L;
    L += abstandLL([p[i - 1].lon, p[i - 1].lat], [p[i].lon, p[i].lat]);
  }
  return p.length && (p[0].qn_berg || p[0].qn_tal) ? L : Infinity;
}
const genauKlasse = a => a == null ? "" : a <= E().genauigkeit_m ? "gut" : a <= 2 * E().genauigkeit_m ? "mittel" : "schlecht";

function hinweise() {
  const band = $("#hinweisband"); if (!aktivModus) return;
  const h = [], l = letzter(), pos = fix ? [fix.lon, fix.lat] : null;
  if (fix && fix.acc > E().genauigkeit_m) h.push(["rot", `Genauigkeit ±${fmt(fix.acc, 1)} m`]);
  if (pos && l) { const d = abstandLL(pos, [l.lon, l.lat]); if (d > E().punktabstand_m) h.push(["", `Punkt fällig – ${fmt(d)} m seit ${l.name}`]); }
  const q = seitQN(); if (pkte().length && q > E().qn_abstand_m) h.push(["", `Querneigung messen (${q === Infinity ? "noch keine" : fmt(q) + " m seit letzter"})`]);
  const v = aktiveVariante();
  if (pos && v?.punkte.length > 1) {
    const a = aufLinie(pos, v.punkte);
    h.push([a.abstand > 15 ? "rot" : "", `${v.name}: hm ${hm(a.station)}, ${fmt(a.abstand)} m ${a.seite > 0 ? "rechts" : "links"} der Planung`]);
  }
  band.innerHTML = h.map(([k, t]) => `<span class="${k}">${esc(t)}</span>`).join(""); band.hidden = !h.length;
}

// ---------- Panel ----------
export function betreten(el) { panel = el; aktivModus = true; render(); }
export function verlassen() { aktivModus = false; $("#hinweisband").hidden = true; }
export function projektGeaendert() { zeichneAufnahme(); if (aktivModus) render(); }

function zeigeGPS() {
  const g = $("#gps", panel); if (!g) return;
  g.className = "gps " + genauKlasse(fix?.acc);
  g.innerHTML = fix ? `<span class="genau">±${fmt(fix.acc, 1)} m</span><span class="klein">${new Date(fix.t).toLocaleTimeString("de-AT")}</span>
     <span class="klein">${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}</span><span class="klein">${fix.alt != null ? "GPS-Höhe " + fmt(fix.alt, 0) + " m" : ""}</span>`
    : `<span class="klein">${watchId != null ? "Warte auf GPS …" : "GPS aus"}</span><span></span>`;
  const b = $("#btn-punkt", panel); if (b && !sammler) b.disabled = !fix;
  hinweise();
}

function render() {
  if (!aktivModus) return;
  const p = pkte(), st = stationen(p.map(q => [q.lon, q.lat])), l = letzter();
  const dbl = l && /^P\d+[ab]?$/i.test(l.name) && !/b$/i.test(l.name);
  panel.innerHTML = `
    <h2>Trassenaufnahme</h2>
    <div id="gps" class="gps"></div>
    <div class="zeile">
      <button class="btn ${watchId != null ? "an" : "primaer"} wachsen" id="btn-gps">${watchId != null ? "GPS läuft – stoppen" : "GPS starten"}</button>
    </div>
    <div style="margin-top:10px"><button class="btn primaer gross" id="btn-punkt" ${fix ? "" : "disabled"}>Punkt ${esc(naechsterName())} aufnehmen</button></div>
    <div class="zeile" style="margin-top:8px">
      <button class="btn wachsen" id="btn-doppel" ${dbl && fix ? "" : "disabled"}>Doppelmessung${dbl ? " " + esc(l.name.replace(/a$/i, "")) + "b" : ""}</button>
      <button class="btn wachsen" id="btn-kreuz">Auf Fadenkreuz setzen</button>
    </div>
    <p class="klein">Mitteln: ${E().mitteln_s ? E().mitteln_s + " s je Punkt" : "aus"} · Hinweis bei Punktabstand &gt; ${E().punktabstand_m} m (ändern unter „Daten“).</p>
    <div class="kennzahlen">
      <div class="kennzahl"><b>${p.length}</b><span>Punkte</span></div>
      <div class="kennzahl"><b>${fmt(st[st.length - 1] || 0)} m</b><span>Länge</span></div>
      <div class="kennzahl"><b>${p.filter(q => (q.code || "TA") !== "TA").length}</b><span>Sonderpunkte</span></div>
    </div>
    <h3>Punkte</h3>
    <ul class="liste">${p.map((q, i) => ({ q, i })).reverse().map(({ q, i }) => `<li data-i="${i}">
      <span class="code">${esc(q.code || "TA")}</span>
      <div class="wachsen"><b>${esc(q.name)}</b> <span class="klein">hm ${hm(st[i])}</span>
        <small>${[q.qn_berg && "QN " + q.qn_berg + "/" + (q.qn_tal || "–") + " %", q.boden, q.fels !== "" && q.fels != null && "Fels " + q.fels, q.bestand, q.bem].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</small></div>
      <span class="klein">±${fmt(q.acc, 1)}${q.fotos?.length ? " · 📷" + q.fotos.length : ""}</span></li>`).join("")
      || `<li class="klein">Noch keine Punkte. Stationierung vom Anschluss (AP) weg, Achspunkte alle 15–25 m und an jedem Wechsel.</li>`}</ul>`;
  $("#btn-gps", panel).onclick = () => (watchId != null ? gpsStopp() : gpsStart());
  $("#btn-punkt", panel).onclick = () => aufnehmen(false);
  $("#btn-doppel", panel).onclick = () => aufnehmen(true);
  const kreuz = $("#fadenkreuz");
  $("#btn-kreuz", panel).onclick = () => {
    if (kreuz.hidden) { kreuz.hidden = false; $("#btn-kreuz", panel).textContent = "Hier setzen"; $("#btn-kreuz", panel).classList.add("an"); return; }
    kreuz.hidden = true; const c = karte.getCenter();
    neuerPunkt({ lon: c.lng, lat: c.lat, acc: null, alt: null, n: 0, quelle: "karte" }, false);
  };
  $$(".liste li[data-i]", panel).forEach(li => li.onclick = () => bearbeite(pkte()[+li.dataset.i]));
  zeigeGPS();
}

async function aufnehmen(doppel) {
  if (!fix) return;
  const s = E().mitteln_s || 0, b = $("#btn-punkt", panel);
  let fixe = [fix];
  if (s > 0) {
    sammler = [];
    const ende = Date.now() + s * 1000;
    await new Promise(res => {
      const t = setInterval(() => {
        const rest = Math.ceil((ende - Date.now()) / 1000);
        if (b) { b.disabled = true; b.textContent = `Messe … ${Math.max(0, rest)} s (${sammler.length} Fixe)`; }
        if (Date.now() >= ende) { clearInterval(t); res(); }
      }, 250);
    });
    fixe = sammler.length ? sammler : [fix]; sammler = null;
  }
  const w = fixe.map(f => 1 / Math.max(0.5, f.acc) ** 2), W = w.reduce((a, b) => a + b, 0);
  const avg = k => fixe.reduce((t, f, i) => t + f[k] * w[i], 0) / W;
  const accs = fixe.map(f => f.acc).sort((a, b) => a - b), alts = fixe.map(f => f.alt).filter(a => a != null);
  neuerPunkt({ lon: avg("lon"), lat: avg("lat"), acc: accs[Math.floor(accs.length / 2)],
    alt: alts.length ? alts.reduce((a, b) => a + b, 0) / alts.length : null, n: fixe.length, quelle: "gps" }, doppel);
}

async function neuerPunkt(m, doppel) {
  const l = letzter();
  let name = naechsterName();
  if (doppel && l) {
    const basis = l.name.replace(/[ab]$/i, "");
    if (!/a$/i.test(l.name)) l.name = basis + "a";
    name = basis + "b";
  }
  const p = {
    id: store.neueId(), name, lon: m.lon, lat: m.lat, acc: m.acc, alt: m.alt, n_mittel: m.n, quelle: m.quelle,
    zeit: new Date().toISOString(), code: doppel ? l.code : (pkte().length ? "TA" : "AP"),
    qn_berg: doppel ? l.qn_berg : "", qn_tal: doppel ? l.qn_tal : "",
    boden: l?.boden ?? "", fels: l?.fels ?? "", wasser: l?.wasser ?? "", bestand: l?.bestand ?? "",
    bem: doppel ? l.bem : "", fotos: [],
  };
  try { p.dgm = await hoehe([p.lon, p.lat]); } catch { /* offline ohne Höhendaten */ }
  const ok = await bearbeite(p, true);
  if (ok) toast(`${p.name} gespeichert`); else if (doppel && l) { l.name = l.name.replace(/a$/i, ""); }
  if (aktivModus) render();
}

const chips = (feld, liste, wert) => `<div class="chips" data-feld="${feld}">${liste.map(([k, t]) =>
  `<button type="button" data-w="${k}" class="${String(wert) === k ? "an" : ""}">${k}<small>${t}</small></button>`).join("")}</div>`;

/** Punkt-Formular. neu=true: Punkt wird erst beim Speichern angelegt. */
export async function bearbeite(p, neu = false) {
  const z = structuredClone(p);
  const bestaende = [...new Set(pkte().map(q => q.bestand).filter(Boolean))];
  const ok = await sheet(`
    <h2>${neu ? "Neuer Punkt" : "Punkt bearbeiten"}</h2>
    <p class="klein">${z.acc != null ? "±" + fmt(z.acc, 1) + " m" + (z.n_mittel > 1 ? ", gemittelt aus " + z.n_mittel : "") : "von Karte gesetzt"}
      ${z.dgm ? " · DGM " + fmt(z.dgm, 1) + " m" : ""}</p>
    <div class="zeile"><div class="wachsen"><label class="lab">Punkt-Nr.</label><input class="feld" id="f-name" value="${esc(z.name)}"></div></div>
    <label class="lab">Code</label>
    <div class="chips" data-feld="code">${CODES.map(([k, t]) => `<button type="button" data-w="${k}" class="${(z.code || "TA") === k ? "an" : ""}">${k}<small>${t}</small></button>`).join("")}</div>
    <div class="zeile">
      <div class="wachsen"><label class="lab">QN berg [%]</label><input class="feld" id="f-qnb" inputmode="numeric" value="${esc(z.qn_berg)}"></div>
      <div class="wachsen"><label class="lab">QN tal [%]</label><input class="feld" id="f-qnt" inputmode="numeric" value="${esc(z.qn_tal)}"></div>
    </div>
    <label class="lab">Boden</label>${chips("boden", BODEN, z.boden)}
    <label class="lab">Fels</label>${chips("fels", FELS, z.fels)}
    <label class="lab">Wasser</label>${chips("wasser", WASSER, z.wasser)}
    <label class="lab">Bestand / Baumarten</label>
    <input class="feld" id="f-bestand" list="dl-bestand" value="${esc(z.bestand)}" placeholder="z. B. Fi-Bu-Ta BH">
    <datalist id="dl-bestand">${bestaende.map(b => `<option value="${esc(b)}">`).join("")}</datalist>
    <label class="lab">Zwangspunkt / Bemerkung</label>
    <textarea class="feld" id="f-bem">${esc(z.bem)}</textarea>
    <label class="lab">Fotos</label>
    <div class="fotos" id="f-fotos"></div>
    <div class="zeile" style="margin-top:6px"><button class="btn" id="f-foto" type="button">📷 Foto aufnehmen</button></div>
    <div class="fuss">
      ${neu ? "" : `<button class="btn gefahr" data-weg>Löschen</button>`}
      <button class="btn" data-n>${neu ? "Verwerfen" : "Abbrechen"}</button>
      <button class="btn primaer" data-j>Speichern</button>
    </div>`, (s, zu) => {
    $$(".chips", s).forEach(c => c.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      const f = c.dataset.feld, an = b.classList.contains("an");
      $$("button", c).forEach(x => x.classList.remove("an"));
      if (!an || f === "code") { b.classList.add("an"); z[f] = b.dataset.w; } else z[f] = "";
    });
    const zeigeFotos = async () => {
      const el = $("#f-fotos", s); el.innerHTML = "";
      for (const id of z.fotos) {
        const blob = await store.ladeFoto(id); if (!blob) continue;
        const img = document.createElement("img"); img.src = URL.createObjectURL(blob); img.title = "Antippen zum Entfernen";
        img.onclick = () => { if (confirm("Foto entfernen?")) { z.fotos = z.fotos.filter(x => x !== id); zeigeFotos(); } };
        el.append(img);
      }
    };
    $("#f-foto", s).onclick = () => {
      const i = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment" });
      i.onchange = async () => {
        if (!i.files[0]) return;
        const id = `${z.id}_${z.fotos.length + 1}_${Date.now().toString(36)}`;
        await store.speichereFoto(id, app.projekt.id, await verkleinere(i.files[0]));
        z.fotos.push(id); zeigeFotos();
      };
      i.click();
    };
    zeigeFotos();
    const lies = () => Object.assign(z, {
      name: $("#f-name", s).value.trim() || z.name, qn_berg: $("#f-qnb", s).value.trim(), qn_tal: $("#f-qnt", s).value.trim(),
      bestand: $("#f-bestand", s).value.trim(), bem: $("#f-bem", s).value.trim(),
    });
    $("[data-n]", s).onclick = () => zu(false);
    $("[data-j]", s).onclick = () => { lies(); zu(true); };
    const weg = $("[data-weg]", s);
    if (weg) weg.onclick = () => zu("loeschen");
  });
  if (ok === "loeschen") {
    if (await frage(`Punkt ${p.name} löschen?`, "Löschen", "Behalten", true)) {
      app.projekt.punkte = pkte().filter(q => q.id !== p.id);
      for (const f of p.fotos || []) store.loescheFoto(f);
      geaendert("punkte");
    }
    return false;
  }
  if (!ok) { if (neu) for (const f of z.fotos) store.loescheFoto(f); return false; }
  if (!neu) for (const f of p.fotos || []) if (!z.fotos.includes(f)) store.loescheFoto(f);
  if (neu) pkte().push(z); else Object.assign(p, z);
  geaendert("punkte");
  return true;
}

async function verkleinere(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const f = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * f), height: Math.round(bmp.height * f) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, "image/jpeg", 0.82));
}
