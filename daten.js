// Modus „Daten“: Projekte, Export/Import, Offline-Karte, Einstellungen.
import { app, geaendert, oeffneProjekt, neuesProjekt } from "./main.js";
import { karte, KACHEL_QUELLEN, ebenen } from "./karte.js";
import { stationen, fmt, zuWGS } from "./geo.js";
import { $, esc, toast, frage, eingabe, herunterladen, dateiWaehlen } from "./ui.js";
import * as store from "./store.js";

let panel = null, aktivModus = false, laeuft = null;
export const KACHEL_CACHE = "kacheln-v1";

export function betreten(el) { panel = el; aktivModus = true; render(); }
export function verlassen() { aktivModus = false; }
export function projektGeaendert(was) { if (aktivModus && (was === "geoeffnet" || was === "import")) render(); }

async function render() {
  const p = app.projekt, E = p.einstellungen, alle = (await store.alleProjekte()).sort((a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""));
  if (!aktivModus) return;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  panel.innerHTML = `
    <h2>Daten</h2>
    <h3>Projekte</h3>
    <ul class="liste">${alle.map(x => `<li data-id="${x.id}" class="${x.id === p.id ? "aktiv" : ""}">
      <div class="wachsen"><b>${esc(x.blatt?.bezeichnung || "Projekt")}</b>
      <small>${x.punkte?.length || 0} Punkte · ${x.plan?.varianten?.length || 0} Varianten · ${x.geaendert ? new Date(x.geaendert).toLocaleString("de-AT") : ""}</small></div>
      ${x.id === p.id ? `<span class="klein">offen</span>` : `<button class="btn gefahr" data-weg="${x.id}" title="Löschen">✕</button>`}</li>`).join("")}</ul>
    <div class="zeile" style="margin-top:8px"><button class="btn primaer" id="p-neu">+ Neues Projekt</button></div>

    <h3>Übertragen Mac ⇄ iPad</h3>
    <p class="klein">Export erzeugt ein ZIP: <b>feldbuch.json</b> (ganzes Projekt zum Wiedereinlesen), <b>projekt.json</b> + <b>trasse.csv</b> (SW-Maps-Format, direkt für <code>01_aufbereitung.py</code>), <b>planung.geojson</b> und die Fotos. Am iPad öffnet sich das Teilen-Menü (AirDrop, Dateien).</p>
    <div class="zeile"><button class="btn primaer" id="x-export">Projekt exportieren</button>
      <button class="btn" id="x-import">Importieren …</button></div>
    <p class="klein">Import: Projekt-ZIP, SW-Maps-CSV (z. B. später RTK-Punkte mit dem ArduSimple) , GeoJSON, KML oder GPX (z. B. Trasse aus DORIS) als Variante.</p>

    <h3>Offline-Karte</h3>
    <p class="klein">Vor der Begehung mit WLAN speichern. Gespeichert wird der aktuelle Kartenausschnitt (oder das Projektgebiet).</p>
    <div class="zeile">
      <label class="klein"><input type="checkbox" id="o-basis" checked> ${esc(KACHEL_QUELLEN[ebenen.basis].name)}</label>
      ${ebenen.basis !== "ortho" ? `<label class="klein"><input type="checkbox" id="o-ortho"> Orthofoto</label>` : ""}
      <label class="klein"><input type="checkbox" id="o-gel" checked> Schummerung</label>
      <label class="klein"><input type="checkbox" id="o-dem" checked> Höhenlinien/Höhen</label>
    </div>
    <div class="zeile" style="margin-top:6px"><span class="klein">bis Zoomstufe</span>
      <select class="feld" id="o-z" style="width:auto">${[16, 17, 18, 19].map(z => `<option ${z === 17 ? "selected" : ""}>${z}</option>`).join("")}</select>
      <select class="feld" id="o-geb" style="width:auto"><option value="ansicht">Kartenausschnitt</option><option value="projekt">Projektgebiet + 300 m</option></select></div>
    <p class="klein" id="o-info"></p>
    <div class="fortschritt" id="o-fort" hidden><div></div></div>
    <div class="zeile"><button class="btn primaer" id="o-start">Offline speichern</button><button class="btn gefahr" id="o-leeren">Offline-Karten löschen</button></div>
    ${est ? `<p class="klein">Belegt: ${fmt(est.usage / 1e6)} MB${est.quota ? " von " + fmt(est.quota / 1e6) + " MB" : ""}</p>` : ""}

    <h3>Einstellungen Aufnahme</h3>
    <div class="zeile">
      <div class="wachsen"><label class="lab">Mitteln je Punkt [s]</label><input class="feld" data-e="mitteln_s" inputmode="numeric" value="${E.mitteln_s}"></div>
      <div class="wachsen"><label class="lab">Hinweis Punktabstand [m]</label><input class="feld" data-e="punktabstand_m" inputmode="numeric" value="${E.punktabstand_m}"></div>
    </div>
    <div class="zeile">
      <div class="wachsen"><label class="lab">Hinweis Querneigung alle [m]</label><input class="feld" data-e="qn_abstand_m" inputmode="numeric" value="${E.qn_abstand_m}"></div>
      <div class="wachsen"><label class="lab">Warnung Genauigkeit ab [m]</label><input class="feld" data-e="genauigkeit_m" inputmode="decimal" value="${E.genauigkeit_m}"></div>
    </div>
    <div class="zeile">
      <div class="wachsen"><label class="lab">Korrektur GNSS → DORIS X [m]</label><input class="feld" data-k="0" inputmode="decimal" value="${(E.korrektur_m || [0, 0])[0]}"></div>
      <div class="wachsen"><label class="lab">Korrektur Y [m]</label><input class="feld" data-k="1" inputmode="decimal" value="${(E.korrektur_m || [0, 0])[1]}"></div>
    </div>
    <p class="klein">Die Korrektur wird nur in <code>projekt.json</code> geschrieben und von <code>01_aufbereitung.py</code> angewendet (Steyrling: −0,11 / +0,30).</p>
  `;
  panel.querySelectorAll("li[data-id]").forEach(li => li.onclick = async e => {
    if (e.target.closest("[data-weg]") || li.dataset.id === p.id) return;
    await oeffneProjekt(await store.ladeProjekt(li.dataset.id)); toast("Projekt geöffnet");
  });
  panel.querySelectorAll("[data-weg]").forEach(b => b.onclick = async () => {
    const x = alle.find(q => q.id === b.dataset.weg);
    if (await frage(`Projekt „${x.blatt?.bezeichnung}“ mit allen Punkten und Fotos endgültig löschen?`, "Löschen", "Behalten", true)) { await store.loescheProjekt(x.id); render(); }
    else render();
  });
  $("#p-neu", panel).onclick = async () => {
    const n = await eingabe("Name des neuen Projekts", ""); if (!n) return render();
    const np = neuesProjekt(n); await store.speichereProjekt(np); await oeffneProjekt(np);
  };
  $("#x-export", panel).onclick = () => exportiere().catch(e => toast("Export fehlgeschlagen: " + e.message, 6000));
  $("#x-import", panel).onclick = () => importiere().catch(e => toast("Import fehlgeschlagen: " + e.message, 6000));
  panel.querySelectorAll("[data-e]").forEach(i => i.onchange = () => { E[i.dataset.e] = parseFloat(i.value.replace(",", ".")) || 0; geaendert("einstellung"); });
  panel.querySelectorAll("[data-k]").forEach(i => i.onchange = () => {
    E.korrektur_m = E.korrektur_m || [0, 0]; E.korrektur_m[+i.dataset.k] = parseFloat(i.value.replace(",", ".")) || 0; geaendert("einstellung");
  });
  const info = () => { const t = kachelListe(); $("#o-info", panel).textContent = `${fmt(t.length)} Kacheln, ca. ${fmt(t.length * 0.022, 0)} MB`; return t; };
  ["o-basis", "o-ortho", "o-gel", "o-dem", "o-z", "o-geb"].forEach(id => { const el = $("#" + id, panel); if (el) el.onchange = info; });
  info();
  $("#o-start", panel).onclick = () => offlineSpeichern(info());
  $("#o-leeren", panel).onclick = async () => {
    if (await frage("Alle offline gespeicherten Kartenkacheln löschen?", "Löschen", "Behalten", true)) { await caches.delete(KACHEL_CACHE); toast("Offline-Karten gelöscht"); }
    render();
  };
}

// ---------- Offline-Kacheln ----------
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };

function gebiet() {
  if ($("#o-geb", panel)?.value === "projekt") {
    const pts = [...app.projekt.punkte.map(q => [q.lon, q.lat]), ...app.projekt.plan.varianten.flatMap(v => v.punkte)];
    if (pts.length) {
      const lo = pts.map(p => p[0]), la = pts.map(p => p[1]), dLa = 300 / 110540, dLo = 300 / (111320 * Math.cos(la[0] * Math.PI / 180));
      return [Math.min(...lo) - dLo, Math.min(...la) - dLa, Math.max(...lo) + dLo, Math.max(...la) + dLa];
    }
  }
  const b = karte.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

function kachelListe() {
  const [w, s, e, n] = gebiet(), zMax = +$("#o-z", panel).value, urls = [];
  const quellen = [];
  if ($("#o-basis", panel).checked) quellen.push(ebenen.basis);
  if ($("#o-ortho", panel)?.checked) quellen.push("ortho");
  if ($("#o-gel", panel).checked) quellen.push("gelaende");
  if ($("#o-dem", panel).checked) quellen.push("dem");
  for (const k of quellen) {
    const q = KACHEL_QUELLEN[k];
    for (let z = 10; z <= Math.min(zMax, q.max); z++) {
      // Höhenmodell: maplibre-contour lädt auch Nachbarkacheln → 1 Kachel Rand
      const r = k === "dem" ? 1 : 0;
      for (let x = lon2x(w, z) - r; x <= lon2x(e, z) + r; x++)
        for (let y = lat2y(n, z) - r; y <= lat2y(s, z) + r; y++)
          urls.push(q.url.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    }
  }
  return urls;
}

async function offlineSpeichern(urls) {
  if (laeuft) return;
  if (urls.length > 40000) { toast("Zu viele Kacheln – Ausschnitt verkleinern oder Zoomstufe senken.", 5000); return; }
  if (!("caches" in window)) { toast("Dieser Browser kann keine Offline-Karten speichern."); return; }
  const c = await caches.open(KACHEL_CACHE), fort = $("#o-fort", panel), bar = fort.firstElementChild;
  fort.hidden = false; laeuft = true; let fertig = 0, fehler = 0, i = 0;
  const arbeiter = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        if (!(await c.match(u))) { const r = await fetch(u, { mode: "cors" }); if (r.ok) await c.put(u, r); else if (r.status !== 404) fehler++; }
      } catch { fehler++; }
      fertig++;
      if (fertig % 20 === 0 && aktivModus) { bar.style.width = (fertig / urls.length * 100) + "%"; $("#o-info", panel).textContent = `${fmt(fertig)} / ${fmt(urls.length)} Kacheln`; }
    }
  };
  await Promise.all(Array.from({ length: 8 }, arbeiter));
  laeuft = null;
  toast(fehler ? `Offline gespeichert, ${fehler} Kacheln fehlgeschlagen` : `${fmt(urls.length)} Kacheln offline gespeichert`, 5000);
  if (aktivModus) render();
}

// ---------- Export ----------
const datumAT = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d.split("-").reverse().join(".") : (d || "");
const zahl = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : null; };
const csvFeld = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export function projektJson(p) {
  const b = p.blatt, w = p.weg, planum = zahl(b.planum) ?? w.planum_m ?? 4.5, fahrbahn = zahl(b.fahrbahn) ?? w.fahrbahn_m ?? 3.5;
  const wk = [...(b.waldkategorie || [])];
  if (b.bannwald_bescheid || b.bannwald_kote) wk.push(`Bannwald${b.bannwald_kote ? " bis " + b.bannwald_kote : ""}${b.bannwald_bescheid ? " (Bescheid " + b.bannwald_bescheid + ")" : ""}`);
  return {
    projekt: {
      bezeichnung: b.bezeichnung || "", kurz: b.kurz || kurzname(p), wegtyp: (b.wegtyp || [])[0] || "Traktorweg",
      bauwerber: b.bauwerber || "", bauwerber_adresse: b.adresse || "", bauwerber_kontakt: b.kontakt || "",
      waldeigentuemer: b.waldeigentuemer || b.bauwerber || "", gemeinde: b.gemeinde || "", kg: b.kg || "",
      grundstuecke: (b.grundstuecke || "").split(/[,;]/).map(s => s.trim()).filter(Boolean),
      bezirk: b.bezirk || "", behoerde: b.bezirk ? "Bezirkshauptmannschaft " + b.bezirk : "",
      waldkategorie: [...new Set(wk)].join(", "), beruehrte_interessen: b.interessen || [],
      datum: new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }),
    },
    planung: { buero: "Ingenieurbüro für Forstwirtschaft Oberlindober e.U.", name: "DI Josef Alois Oberlindober", adresse: "Roßbergstraße 1, 4493 Wolfern" },
    aufnahme: {
      datum_begehung: datumAT(b.begehung), datum_gnss: datumAT(b.gnss_datum), csv: "trasse.csv",
      korrektur_m: p.einstellungen.korrektur_m || [0, 0], doppel_abstand_m: 2.0, ausschliessen: [],
      genauigkeit_warnung_m: p.einstellungen.genauigkeit_m ?? 2.0,
    },
    weg: {
      planum_m: planum, fahrbahn_m: fahrbahn, bankett_m: Math.max(0, (planum - fahrbahn) / 2),
      quergefaelle: (zahl(b.quergefaelle) ?? 3) / 100,
      quergefaelle_art: (b.querprofil || []).join(", ") || "talseitig geneigt (hängendes Planum)",
      oberbau_m: (zahl(b.oberbau_cm) ?? 30) / 100,
      oberbau_material: (b.oberbau || []).includes("Fremdmaterial") ? "Fremdmaterial " + (b.oberbau_koernung || "") : "Material aus dem Aushub",
      anschnitt_HV: 1.5, damm_HV: 0.8, damm_HV_steil: 1.0, steil_ab: 0.68,
      aufhieb_m: zahl(b.aufhieb) ?? 12.0,
      laengsneigung_max: w.laengsneigung_max ?? 0.10, laengsneigung_opt: [w.laengsneigung_min ?? 0.05, w.laengsneigung_max ?? 0.10],
    },
    regelprofile: [],
    massenausgleich: { einbau: b.einbau || "" },
  };
}
function ortszeit(z) {
  const d = new Date(z); if (!z || isNaN(d)) return z || "";
  const n = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}`;
}
const kurzname = p => (p.blatt.kurz || p.blatt.bezeichnung || "Projekt").replace(/[^\wäöüÄÖÜß-]+/g, "_").slice(0, 40);

async function exportiere() {
  const { blob, name } = await baueExport(app.projekt);
  await herunterladen(blob, name);
  toast("Export fertig");
}

export async function baueExport(p) {
  const zip = new JSZip(), datum = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const ordner = zip.folder(`${kurzname(p)}_${datum}`), fotoDateien = {};
  const st = stationen(p.punkte.map(q => [q.lon, q.lat]));
  const kopf = ["ID", "Remarks", "Time", "Latitude", "Longitude", "Ortho Height", "Horizontal Accuracy", "code", "qn_berg", "qn_tal", "boden", "fels", "wasser", "bestand", "bem", "foto", "station_m", "dgm_hoehe"];
  const zeilen = [kopf.join(",")];
  for (const [i, q] of p.punkte.entries()) {
    const namen = [];
    for (const [k, id] of (q.fotos || []).entries()) {
      const blob = await store.ladeFoto(id); if (!blob) continue;
      const n = `${q.name}_${k + 1}.jpg`; ordner.file("fotos/" + n, blob); fotoDateien[id] = "fotos/" + n; namen.push(n);
    }
    zeilen.push([i + 1, q.name, ortszeit(q.zeit),q.lat.toFixed(9), q.lon.toFixed(9),
      q.alt != null ? q.alt.toFixed(1) : (q.dgm != null ? q.dgm.toFixed(1) : ""), q.acc != null ? q.acc.toFixed(2) : "",
      q.code || "TA", q.qn_berg, q.qn_tal, q.boden, q.fels, q.wasser, q.bestand, q.bem, namen.join("|"),
      st[i].toFixed(1), q.dgm != null ? q.dgm.toFixed(1) : ""].map(csvFeld).join(","));
  }
  ordner.file("trasse.csv", "﻿" + zeilen.join("\n") + "\n");
  ordner.file("projekt.json", JSON.stringify(projektJson(p), null, 2));
  ordner.file("planung.geojson", JSON.stringify({ type: "FeatureCollection", features: p.plan.varianten.map(v => ({
    type: "Feature", properties: { name: v.name, farbe: v.farbe, notiz: v.notiz || "" }, geometry: { type: "LineString", coordinates: v.punkte } })) }, null, 1));
  ordner.file("feldbuch.json", JSON.stringify({ format: "forststrasse-feldbuch", version: 1, projekt: p, fotoDateien }));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob: new Blob([blob], { type: "application/zip" }), name: `${kurzname(p)}_${datum}.zip` };
}

// ---------- Import ----------
export async function importiere() {
  const f = await dateiWaehlen(".zip,.csv,.json,.geojson,.kml,.gpx");
  if (f) await importDatei(f);
}
export async function importDatei(f) {
  const n = f.name.toLowerCase();
  if (n.endsWith(".zip")) return importZip(f);
  if (n.endsWith(".csv")) return importCSV(await f.text());
  if (n.endsWith(".kml")) return importLinien(ausXML(await f.text(), "kml"), f.name);
  if (n.endsWith(".gpx")) return importLinien(ausXML(await f.text(), "gpx"), f.name);
  return importLinien(ausGeoJSON(JSON.parse(await f.text())), f.name);
}

async function importZip(f) {
  const zip = await JSZip.loadAsync(f);
  const fb = Object.values(zip.files).find(x => x.name.endsWith("feldbuch.json"));
  if (!fb) {
    const csv = Object.values(zip.files).find(x => /\.csv$/i.test(x.name));
    if (csv) return importCSV(await csv.async("string"));
    throw new Error("Kein Projekt im ZIP gefunden");
  }
  const basis = fb.name.slice(0, -"feldbuch.json".length);
  const d = JSON.parse(await fb.async("string")), p = d.projekt;
  const vorhanden = await store.ladeProjekt(p.id);
  if (vorhanden) {
    const ersetzen = await frage(`„${p.blatt.bezeichnung}“ gibt es schon (zuletzt geändert ${new Date(vorhanden.geaendert).toLocaleString("de-AT")}). Ersetzen? Sonst wird eine Kopie angelegt.`, "Ersetzen", "Als Kopie");
    if (!ersetzen) { p.id = store.neueId(); p.blatt.bezeichnung += " (Kopie)"; }
  }
  const neu = {};
  for (const [alt, pfad] of Object.entries(d.fotoDateien || {})) {
    const z = zip.file(basis + pfad); if (!z) continue;
    const id = vorhanden && p.id !== vorhanden.id ? store.neueId() : alt;
    await store.speichereFoto(id, p.id, new Blob([await z.async("arraybuffer")], { type: "image/jpeg" })); neu[alt] = id;
  }
  for (const q of p.punkte) q.fotos = (q.fotos || []).map(id => neu[id]).filter(Boolean);
  await store.speichereProjekt(p);
  await oeffneProjekt(p); geaendert("import");
  toast(`Projekt importiert: ${p.punkte.length} Punkte, ${p.plan.varianten.length} Varianten`, 4000);
}

function teileCSV(text) {
  const zeilen = text.replace(/^﻿/, "").split(/\r?\n/).filter(z => z.trim());
  const tr = [",", ";", "\t"].sort((a, b) => zeilen[0].split(b).length - zeilen[0].split(a).length)[0];
  const parse = z => { const out = []; let cur = "", q = false;
    for (let i = 0; i < z.length; i++) { const c = z[i];
      if (q) { if (c === '"' && z[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === tr) { out.push(cur); cur = ""; } else cur += c; }
    out.push(cur); return out; };
  const kopf = parse(zeilen[0]).map(s => s.trim());
  return zeilen.slice(1).map(z => { const w = parse(z), o = {}; kopf.forEach((k, i) => (o[k] = (w[i] ?? "").trim())); return o; });
}

async function importCSV(text) {
  const rows = teileCSV(text); if (!rows.length) throw new Error("CSV ist leer");
  const cols = Object.keys(rows[0]);
  const find = (...re) => { for (const r of re) { const c = cols.find(k => r.test(k)); if (c) return c; } };
  const cN = find(/^remarks?$/i, /^name$/i, /^bezeichnung$/i, /^punkt/i, /^id$/i), cLa = find(/^lat/i, /^breite/i), cLo = find(/^lon/i, /^l(ä|ae)nge/i);
  const cA = find(/accuracy/i, /genauigkeit/i), cZ = find(/ortho.?height/i, /elevation/i, /^h(ö|oe)he/i, /altitude/i), cT = find(/^time$/i, /zeit/i);
  if (!cLa || !cLo) throw new Error("Spalten Latitude/Longitude nicht gefunden");
  const ATTR = ["code", "qn_berg", "qn_tal", "boden", "fels", "wasser", "bestand", "bem"];
  const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const neu = rows.map(r => {
    let lat = num(r[cLa]), lon = num(r[cLo]); if (lat == null || lon == null) return null;
    if (Math.abs(lat) < Math.abs(lon)) [lat, lon] = [lon, lat];
    const q = { id: store.neueId(), name: r[cN] || "", lat, lon, acc: cA ? num(r[cA]) : null, alt: cZ ? num(r[cZ]) : null,
      zeit: r[cT] || "", quelle: "import", fotos: [] };
    for (const a of ATTR) { const c = cols.find(k => k.toLowerCase() === a); q[a] = c ? r[c] : ""; }
    q.code = q.code || "TA";
    return q;
  }).filter(Boolean);
  if (!neu.length) throw new Error("Keine Punkte erkannt");
  const ersetzen = app.projekt.punkte.length
    ? await frage(`${neu.length} Punkte gefunden. Bestehende ${app.projekt.punkte.length} Punkte ersetzen? Sonst werden sie angehängt.`, "Ersetzen", "Anhängen") : true;
  app.projekt.punkte = ersetzen ? neu : [...app.projekt.punkte, ...neu];
  neu.forEach((q, i) => { if (!q.name) q.name = "P" + (i + 1); });
  geaendert("import"); toast(`${neu.length} Punkte importiert`);
  const b = new maplibregl.LngLatBounds(); neu.forEach(q => b.extend([q.lon, q.lat])); karte.fitBounds(b, { padding: 60, maxZoom: 17 });
}

// Koordinaten vereinheitlichen: WGS84 bleibt, GK M31 (EPSG:31255) und Web-Mercator werden umgerechnet
function zuLonLat([x, y]) {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return [x, y];
  if (Math.abs(y) > 2e6) {                                    // Web-Mercator (EPSG:3857)
    return [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI];
  }
  return zuWGS([x, y]);                                       // GK M31
}

/** GeoJSON (z. B. DORIS-Zeichnung) → Linien und Punkte */
function ausGeoJSON(g) {
  const feats = g.type === "FeatureCollection" ? g.features : g.type === "Feature" ? [g] : [{ type: "Feature", properties: {}, geometry: g }];
  const linien = [], punkte = []; let mess = 0;
  for (const f of feats) {
    const gm = f.geometry, pr = f.properties || {}; if (!gm) continue;
    if (pr.woType === "MEASURE_LINE" || pr._meta?.tool === "measure") { mess++; continue; }   // DORIS-Messstrecken
    const name = pr.name || pr.Name || (typeof pr.text === "string" ? pr.text : null) || pr._meta?.text || null;
    if (gm.type === "LineString") linien.push([name, gm.coordinates]);
    if (gm.type === "MultiLineString") gm.coordinates.forEach(c => linien.push([name, c]));
    if (gm.type === "Point") punkte.push([name, gm.coordinates]);
  }
  return { linien, punkte, mess };
}

/** KML (DORIS, Google Earth, SW Maps) und GPX → Linien und Punkte */
function ausXML(text, art) {
  const d = new DOMParser().parseFromString(text, "application/xml");
  if (d.querySelector("parsererror")) throw new Error("Datei ist kein gültiges " + art.toUpperCase());
  const linien = [], punkte = [];
  const kmlKoord = s => s.trim().split(/\s+/).map(t => t.split(",").map(Number)).filter(c => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]));
  if (art === "kml") {
    for (const pm of d.getElementsByTagName("Placemark")) {
      const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || null;
      for (const ls of pm.getElementsByTagName("LineString")) linien.push([name, kmlKoord(ls.getElementsByTagName("coordinates")[0]?.textContent || "")]);
      for (const pt of pm.getElementsByTagName("Point")) { const c = kmlKoord(pt.getElementsByTagName("coordinates")[0]?.textContent || ""); if (c[0]) punkte.push([name, c[0]]); }
    }
  } else {
    const pt = e => [parseFloat(e.getAttribute("lon")), parseFloat(e.getAttribute("lat"))];
    for (const t of [...d.getElementsByTagName("trk"), ...d.getElementsByTagName("rte")]) {
      const name = t.getElementsByTagName("name")[0]?.textContent?.trim() || null;
      const segs = t.tagName === "trk" ? [...t.getElementsByTagName("trkseg")] : [t];
      for (const s of segs) linien.push([name, [...s.getElementsByTagName(t.tagName === "trk" ? "trkpt" : "rtept")].map(pt)]);
    }
    for (const w of d.getElementsByTagName("wpt")) punkte.push([w.getElementsByTagName("name")[0]?.textContent?.trim() || null, pt(w)]);
  }
  return { linien, punkte };
}

/** Linien als Varianten übernehmen; reine Punktdateien auf Wunsch zu einer Linie verbinden */
async function importLinien({ linien, punkte, mess = 0 }, dateiname) {
  linien = linien.map(([n, c]) => [n, c.map(zuLonLat).filter(p => isFinite(p[0]) && isFinite(p[1]))]).filter(([, c]) => c.length > 1);
  const basis = dateiname.replace(/\.[^.]+$/, "").replace(/^GeoJSON_weboffice.*$/i, "DORIS-Zeichnung");
  if (!linien.length) {
    if (punkte.length < 2) throw new Error(mess ? `nur ${mess} DORIS-Messstrecke(n), keine gezeichnete Trasse` : "keine Linien oder Punkte in der Datei");
    if (!(await frage(`Keine Linie gefunden, aber ${punkte.length} Punkte. In der gespeicherten Reihenfolge zu einer Variante verbinden?`, "Verbinden", "Abbrechen"))) return;
    linien = [[basis, punkte.map(([, c]) => zuLonLat(c))]];
  }
  const vs = app.projekt.plan.varianten, F = ["#c0392b", "#7b1fa2", "#d35400", "#00897b", "#283593", "#6d4c41"];
  linien.forEach(([name, c], i) => {
    const v = { id: store.neueId(), name: name || (linien.length > 1 ? `${basis} ${i + 1}` : basis), farbe: F[vs.length % F.length],
      punkte: c.map(p => [p[0], p[1]]), notiz: "importiert aus " + dateiname };
    vs.push(v); app.projekt.plan.aktiv = v.id;
  });
  geaendert("import"); toast(`${linien.length} Linie(n) als Variante importiert – unter „Planen“ auswerten`, 5000);
  const b = new maplibregl.LngLatBounds(); linien.forEach(([, c]) => c.forEach(p => b.extend(p))); karte.fitBounds(b, { padding: 60, maxZoom: 17 });
}
