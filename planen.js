// Modus „Planen“: Trassenvarianten zeichnen, Nulllinie, Längs- und Querneigung aus dem DGM.
import { app, geaendert } from "./main.js";
import { karte, setzeDaten } from "./karte.js";
import { hoehenGK } from "./dem.js";
import { zuGK, zuWGS, abstand, teile, vereinfache, fmt, hm } from "./geo.js";
import { $, $$, esc, toast, frage, eingabe, sheet, entprellt } from "./ui.js";
import { neueId } from "./store.js";

const FARBEN = ["#c0392b", "#7b1fa2", "#d35400", "#00897b", "#283593", "#6d4c41"];
let panel = null, aktivModus = false, werkzeug = null, nullStart = null, marker = [], hoverMarker = null;
const analysen = new Map();   // Varianten-ID -> {key, daten}

const P = () => app.projekt.plan;
const aktiv = () => P().varianten.find(v => v.id === P().aktiv) || null;
const grenzen = () => ({ max: app.projekt.weg.laengsneigung_max ?? 0.10, min: app.projekt.weg.laengsneigung_min ?? 0.05 });

export function farbeNeigung(g) {
  const { max, min } = grenzen(), a = Math.abs(g);
  if (a > max + 0.02) return "#c62828";
  if (a > max) return "#ef6c00";
  if (a < min) return "#d4a400";
  return "#2e9d4a";
}

// ---------- Kartenebenen ----------
export function zeichnePlanung() {
  if (!app.projekt) return;
  setzeDaten("plan-alle", {
    type: "FeatureCollection",
    features: P().varianten.filter(v => v.punkte.length > 1).map(v => ({
      type: "Feature", properties: { farbe: v.farbe, aktiv: v.id === P().aktiv, name: v.name },
      geometry: { type: "LineString", coordinates: v.punkte },
    })),
  });
  const v = aktiv(), a = v && analysen.get(v.id);
  setzeDaten("plan-neigung", {
    type: "FeatureCollection",
    features: a && a.key === key(v) ? a.daten.stuecke.map(s => ({
      type: "Feature", properties: { farbe: farbeNeigung(s.g) }, geometry: { type: "LineString", coordinates: s.ll },
    })) : [],
  });
}

function setzeKnoten() {
  marker.forEach(m => m.remove()); marker = [];
  const v = aktiv();
  if (!aktivModus || !v) return;
  v.punkte.forEach((ll, i) => {
    const el = document.createElement("div");
    el.className = "knoten" + (i === 0 ? " erster" : ""); el.style.setProperty("--k", v.farbe);
    el.title = i === 0 ? "Anfang (AP)" : `Knoten ${i + 1}`;
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(ll).addTo(karte);
    m.on("dragstart", () => { el._gezogen = true; });
    m.on("drag", () => { v.punkte[i] = m.getLngLat().toArray(); zeichnePlanung(); });
    m.on("dragend", () => { v.punkte[i] = m.getLngLat().toArray(); geaendert("plan"); setTimeout(() => (el._gezogen = false), 50); });
    el.addEventListener("click", async e => {
      e.stopPropagation();
      if (el._gezogen) return;
      if (werkzeug === "zeichnen" && i === v.punkte.length - 1) { werkzeug = null; render(); return; }
      if (await frage(`Knoten ${i + 1} löschen?`, "Löschen", "Behalten", true)) {
        v.punkte.splice(i, 1); geaendert("plan");
      }
    });
    marker.push(m);
  });
}

// ---------- Analyse aus dem Höhenmodell ----------
const key = v => JSON.stringify(v.punkte) + JSON.stringify(grenzen());

async function analysiere(v) {
  if (v.punkte.length < 2) return null;
  const k = key(v), alt = analysen.get(v.id);
  if (alt?.key === k) return alt.daten;
  const ds = 5, Q = 10, s = teile(v.punkte, ds);
  const xy = [];
  for (const p of s) xy.push([p.x, p.y], [p.x - p.uy * Q, p.y + p.ux * Q], [p.x + p.uy * Q, p.y - p.ux * Q]);
  const h = await hoehenGK(xy);
  s.forEach((p, i) => { p.h = h[3 * i]; p.quer = Math.abs(h[3 * i + 1] - h[3 * i + 2]) / (2 * Q); });
  const stuecke = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const j = Math.min(i + 2, s.length - 1), a = s[i], b = s[j];
    stuecke.push({ von: a.st, bis: b.st, g: (b.h - a.h) / (b.st - a.st || 1), ll: [zuWGS([a.x, a.y]), ...(j > i + 1 ? [zuWGS([s[i + 1].x, s[i + 1].y])] : []), zuWGS([b.x, b.y])] });
  }
  const { max, min } = grenzen(), L = s[s.length - 1].st;
  const lang = f => stuecke.filter(f).reduce((t, x) => t + x.bis - x.von, 0);
  const d = {
    s, stuecke, L, h0: s[0].h, h1: s[s.length - 1].h,
    gMax: Math.max(...stuecke.map(x => Math.abs(x.g))),
    ueberMax: lang(x => Math.abs(x.g) > max), unterMin: lang(x => Math.abs(x.g) < min),
    querMax: Math.max(...s.map(p => p.quer)), querMittel: s.reduce((t, p) => t + p.quer, 0) / s.length,
    steil: s.filter(p => p.quer >= 0.68).length * ds,
  };
  if (!d.s.every(p => isFinite(p.h))) d.luecke = true;
  analysen.set(v.id, { key: k, daten: d });
  return d;
}

// ---------- Nulllinie (Linie gleicher Steigung im Gelände) ----------
const winkel = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * Nulllinie für einen Schenkel: läuft vom Start in Schritten von `schritt` m Richtung Ziel, jeder Schritt
 * mit der Steigung g (wie mit dem Stechzirkel auf der Schichtenkarte).
 * Endet am Ziel oder dort, wo die Steigung Richtung Ziel nicht mehr zu halten ist – dort ist eine Kehre nötig.
 */
export async function nulllinie(startLL, zielLL, g, { schritt = 10, maxL = 3000 } = {}) {
  let cur = zuGK(startLL); const ziel = zuGK(zielLL), s0 = cur.slice();
  const D = abstand(s0, ziel), ax = [(ziel[0] - s0[0]) / D, (ziel[1] - s0[1]) / D];
  const laengs = p => (p[0] - s0[0]) * ax[0] + (p[1] - s0[1]) * ax[1];
  let hc = (await hoehenGK([cur]))[0], kurs = Math.atan2(ax[0], ax[1]);
  const out = [cur], TOL = 0.025 * schritt;            // 2,5 % Abweichung je Schritt erlaubt
  let L = 0, grund = "maxlaenge", fehlschritte = 0, bester = 0, ohneFortschritt = 0;
  while (L < maxL) {
    if (abstand(cur, ziel) < schritt * 1.5) { grund = "ziel"; break; }
    const azZ = Math.atan2(ziel[0] - cur[0], ziel[1] - cur[1]), kand = [];
    for (let d = -66; d <= 66; d += 2) {
      const a = kurs + d * Math.PI / 180;
      if (winkel(a, azZ) > 1.6) continue;              // nicht vom Ziel weg (max. ~90°)
      kand.push([cur[0] + schritt * Math.sin(a), cur[1] + schritt * Math.cos(a), a]);
    }
    if (!kand.length) { grund = "kehre"; break; }
    const hs = await hoehenGK(kand); let b = null;
    kand.forEach((c, i) => {
      if (!isFinite(hs[i])) return;
      const err = Math.abs(hs[i] - hc - g * schritt);
      const k = err + 0.1 * winkel(c[2], azZ) + 0.2 * winkel(c[2], kurs);
      if (!b || k < b.k) b = { k, err, p: [c[0], c[1]], a: c[2], h: hs[i] };
    });
    if (!b) { grund = "daten"; break; }
    if (b.err > TOL) { if (++fehlschritte >= 2) { out.splice(out.length - 1, 1); L -= schritt; grund = "kehre"; break; } }
    else fehlschritte = 0;
    cur = b.p; hc = b.h; kurs = b.a; out.push(cur); L += schritt;
    if (laengs(cur) >= D) { grund = "ziel"; break; }   // Höhe des Ziels überschritten → Ziel querab erreicht
    if (laengs(cur) > bester + 1) { bester = laengs(cur); ohneFortschritt = 0; } else if (++ohneFortschritt > 40) { grund = "kehre"; break; }
  }
  return { ll: vereinfache(out.map(zuWGS), 0.7), L, grund, erreicht: grund === "ziel" };
}

// ---------- Panel ----------
export function betreten(el) {
  panel = el; aktivModus = true; werkzeug = null; nullStart = null;
  karte.on("click", kartenKlick);
  render(); setzeKnoten();
}
export function verlassen() {
  aktivModus = false; werkzeug = null;
  karte.off("click", kartenKlick); karte.getCanvas().style.cursor = "";
  marker.forEach(m => m.remove()); marker = []; hoverMarker?.remove(); hoverMarker = null;
}
export function projektGeaendert(was) {
  zeichnePlanung();
  if (!aktivModus) return;
  setzeKnoten();
  if (was === "plan" || was === "geoeffnet" || was === "import") aktualisiereAnalyse();
  if (was === "geoeffnet" || was === "import") render();
}

function render() {
  if (!aktivModus) return;
  const vs = P().varianten, v = aktiv(), { max, min } = grenzen();
  karte.getCanvas().style.cursor = werkzeug ? "crosshair" : "";
  panel.innerHTML = `
    <h2>Vorplanung</h2>
    <p class="klein">Varianten am Mac vorplanen, dann über „Daten“ aufs iPad übertragen und im Gelände abgehen.</p>
    <h3>Varianten</h3>
    <ul class="liste">${vs.map(x => `<li data-id="${x.id}" class="${x.id === P().aktiv ? "aktiv" : ""}">
        <span class="farbpunkt" style="background:${x.farbe}"></span>
        <div class="wachsen"><b>${esc(x.name)}</b><small>${x.punkte.length} Knoten${analysen.get(x.id)?.daten ? " · " + fmt(analysen.get(x.id).daten.L) + " m" : ""}</small></div>
        <button class="btn" data-umb="${x.id}" title="Umbenennen">✎</button>
      </li>`).join("") || `<li class="klein">Noch keine Variante. Lege eine an und klicke Punkte in die Karte.</li>`}</ul>
    <div class="zeile" style="margin-top:8px">
      <button class="btn primaer" id="v-neu">+ Variante</button>
      <button class="btn" id="v-import" title="Trasse aus DORIS (GeoJSON), KML oder GPX">Importieren …</button>
      ${v ? `<button class="btn" id="v-kopie">Kopieren</button><button class="btn gefahr" id="v-weg">Löschen</button>` : ""}
    </div>
    ${v ? `
    <h3>Werkzeuge</h3>
    <div class="zeile">
      <button class="btn ${werkzeug === "zeichnen" ? "an" : ""}" id="w-zeichnen">${werkzeug === "zeichnen" ? "Zeichnen beenden" : "Knoten setzen"}</button>
      <button class="btn ${werkzeug === "nulllinie" ? "an" : ""}" id="w-null">Nulllinie</button>
      <button class="btn" id="w-zurueck" ${v.punkte.length ? "" : "disabled"}>↶ Letzten</button>
      <button class="btn" id="w-umkehren" ${v.punkte.length > 1 ? "" : "disabled"}>⇄ Richtung</button>
    </div>
    ${werkzeug === "zeichnen" ? `<p class="klein">Klick in die Karte setzt den nächsten Knoten. Klick nahe an der Linie fügt einen Knoten dazwischen ein. Knoten ziehen zum Verschieben, antippen zum Löschen.</p>` : ""}
    ${werkzeug === "nulllinie" ? `<div class="zeile" style="margin-top:8px"><label class="klein">Steigung</label>
        <input class="feld" id="n-g" type="number" step="0.5" style="width:90px" value="${app.projekt.plan.nullG ?? 8}"> <span>%</span>
        <span class="klein">(+ bergauf, − bergab)</span></div>
      <p class="klein">${nullStart ? "Jetzt das <b>Ziel</b> anklicken." : v.punkte.length ? "Ziel anklicken – die Linie startet am Ende der Variante. Oder zuerst <b>Shift</b> + Klick für einen neuen Start." : "<b>Start</b> anklicken, dann das Ziel."}
      Die Linie folgt dem Gelände mit gleichbleibender Steigung (wie mit dem Stechzirkel auf der Schichtenkarte).
      Bleibt sie vor dem Ziel stehen, ist dort eine Kehre nötig: einfach das nächste Ziel in die Gegenrichtung anklicken.</p>` : ""}
    <h3>Grenzwerte Längsneigung</h3>
    <div class="zeile"><span class="klein">min</span><input class="feld" id="g-min" type="number" step="0.5" style="width:80px" value="${min * 100}">
      <span class="klein">max</span><input class="feld" id="g-max" type="number" step="0.5" style="width:80px" value="${max * 100}"><span>%</span></div>
    <div id="analyse"><p class="klein">${v.punkte.length < 2 ? "Mindestens zwei Knoten setzen." : "Rechne …"}</p></div>
    <label class="lab">Notiz zur Variante</label>
    <textarea class="feld" id="v-notiz">${esc(v.notiz || "")}</textarea>` : ""}
  `;
  $$(".liste li[data-id]", panel).forEach(li => li.onclick = e => {
    if (e.target.closest("[data-umb]")) return;
    P().aktiv = li.dataset.id; werkzeug = null; geaendert("plan"); render();
  });
  $$("[data-umb]", panel).forEach(b => b.onclick = async () => {
    const x = vs.find(q => q.id === b.dataset.umb), n = await eingabe("Name der Variante", x.name);
    if (n) { x.name = n; geaendert("plan"); render(); }
  });
  $("#v-neu", panel).onclick = () => neueVariante();
  $("#v-import", panel).onclick = async () => {
    try { await (await import("./daten.js")).importiere(); render(); }
    catch (e) { toast("Import fehlgeschlagen: " + e.message, 6000); }
  };
  if (!v) return;
  $("#v-kopie", panel).onclick = () => neueVariante(v.name + " (Kopie)", v.punkte.map(p => p.slice()));
  $("#v-weg", panel).onclick = async () => {
    if (!(await frage(`Variante „${v.name}“ löschen?`, "Löschen", "Behalten", true))) return;
    P().varianten = vs.filter(x => x !== v); P().aktiv = P().varianten[0]?.id ?? null; geaendert("plan"); render();
  };
  $("#w-zeichnen", panel).onclick = () => { werkzeug = werkzeug === "zeichnen" ? null : "zeichnen"; render(); };
  $("#w-null", panel).onclick = () => { werkzeug = werkzeug === "nulllinie" ? null : "nulllinie"; nullStart = null; render(); };
  $("#w-zurueck", panel).onclick = () => { v.punkte.pop(); geaendert("plan"); render(); };
  $("#w-umkehren", panel).onclick = () => { v.punkte.reverse(); geaendert("plan"); };
  const ng = $("#n-g", panel); if (ng) ng.onchange = () => { app.projekt.plan.nullG = +ng.value; geaendert("einstellung"); };  $("#g-min", panel).onchange = e => { app.projekt.weg.laengsneigung_min = +e.target.value / 100; geaendert("plan"); };
  $("#g-max", panel).onchange = e => { app.projekt.weg.laengsneigung_max = +e.target.value / 100; geaendert("plan"); };
  $("#v-notiz", panel).oninput = entprellt(e => { v.notiz = e.target.value; geaendert("notiz"); }, 500);
  aktualisiereAnalyse();
}

function neueVariante(name, punkte = []) {
  const vs = P().varianten;
  const v = { id: neueId(), name: name || "Variante " + String.fromCharCode(65 + vs.length), farbe: FARBEN[vs.length % FARBEN.length], punkte, notiz: "" };
  vs.push(v); P().aktiv = v.id; werkzeug = punkte.length ? null : "zeichnen"; geaendert("plan"); render();
}

async function kartenKlick(e) {
  const v = aktiv(); if (!v || !werkzeug) return;
  const ll = e.lngLat.toArray();
  if (werkzeug === "zeichnen") {
    const i = einfuegeStelle(e.point, v);
    if (i > 0) v.punkte.splice(i, 0, ll); else v.punkte.push(ll);
    geaendert("plan"); render();
  } else if (werkzeug === "nulllinie") {
    if (e.originalEvent.shiftKey || (!nullStart && !v.punkte.length)) { nullStart = ll; toast("Start gesetzt – jetzt Ziel anklicken"); render(); return; }
    const start = nullStart || v.punkte[v.punkte.length - 1];
    const g = (app.projekt.plan.nullG ?? 8) / 100;
    toast("Nulllinie wird gerechnet …", 10000);
    try {
      const r = await nulllinie(start, ll, g);
      if (nullStart && v.punkte.length) {        // neuer Start → neue Variante
        neueVariante(`Nulllinie ${fmt(g * 100, 1)} %`, r.ll);
      } else {
        v.punkte.push(...(v.punkte.length ? r.ll.slice(1) : r.ll));
        geaendert("plan");
      }
      toast(r.grund === "ziel" ? `Schenkel ${fmt(r.L)} m mit ${fmt(g * 100, 1)} % – Ziel erreicht` :
        r.grund === "kehre" ? `Schenkel ${fmt(r.L)} m – hier ist mit ${fmt(g * 100, 1)} % eine Kehre nötig. Nächstes Ziel in die Gegenrichtung anklicken.` :
        `Schenkel ${fmt(r.L)} m – Linie endet (keine Höhendaten oder zu lang)`, 7000);
    } catch (err) { toast("Nulllinie fehlgeschlagen: " + err.message, 6000); }
    nullStart = null; render();
  }
}

function einfuegeStelle(pt, v) {
  let best = -1, bd = 14;
  for (let i = 1; i < v.punkte.length; i++) {
    const a = karte.project(v.punkte[i - 1]), b = karte.project(v.punkte[i]);
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2));
    if (t <= 0.02 || t >= 0.98) continue;
    const d = Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

let laufNr = 0;
const aktualisiereAnalyse = entprellt(async () => {
  const v = aktiv(), el = panel && $("#analyse", panel);
  if (!v || !el || !aktivModus) return;
  if (v.punkte.length < 2) { el.innerHTML = `<p class="klein">Mindestens zwei Knoten setzen.</p>`; zeichnePlanung(); return; }
  const nr = ++laufNr;
  try {
    const d = await analysiere(v);
    if (nr !== laufNr || !aktivModus) return;
    zeichnePlanung();
    const { max, min } = grenzen();
    el.innerHTML = `
      <h3>Ergebnis (Höhenmodell 10 m)</h3>
      <div class="kennzahlen">
        <div class="kennzahl"><b>${fmt(d.L)} m</b><span>Länge</span></div>
        <div class="kennzahl"><b>${fmt(d.h1 - d.h0, 1)} m</b><span>Höhenunterschied</span></div>
        <div class="kennzahl"><b>${fmt((d.h1 - d.h0) / d.L * 100, 1)} %</b><span>mittl. Neigung</span></div>
        <div class="kennzahl"><b>${fmt(d.gMax * 100, 1)} %</b><span>max. Längsneigung</span></div>
        <div class="kennzahl"><b>${fmt(d.ueberMax)} m</b><span>über ${fmt(max * 100, 1)} %</span></div>
        <div class="kennzahl"><b>${fmt(d.unterMin)} m</b><span>unter ${fmt(min * 100, 1)} %</span></div>
        <div class="kennzahl"><b>${fmt(d.querMittel * 100)} %</b><span>Querneigung mittel</span></div>
        <div class="kennzahl"><b>${fmt(d.querMax * 100)} %</b><span>Querneigung max.</span></div>
        <div class="kennzahl"><b>${fmt(d.steil)} m</b><span>Gelände ≥ 68 %</span></div>
      </div>
      ${d.luecke ? `<p class="klein" style="color:var(--rot)">Für einen Teil der Linie fehlen Höhendaten (offline nicht gespeichert?).</p>` : ""}
      ${profilSVG(d)}
      <div class="legende"><span><i style="background:#2e9d4a"></i>${fmt(min * 100)}–${fmt(max * 100)} %</span>
        <span><i style="background:#d4a400"></i>&lt; ${fmt(min * 100)} %</span><span><i style="background:#ef6c00"></i>bis ${fmt(max * 100 + 2)} %</span>
        <span><i style="background:#c62828"></i>&gt; ${fmt(max * 100 + 2)} %</span><span><i style="background:#555"></i>Querneigung</span></div>
      <p class="klein">Grobe Vorplanung auf dem Gelände (ohne Nivellette). Die genaue Kubatur kommt später aus der Aufnahme und dem DGM 1 m.</p>`;
    bindeProfil(el, d);
  } catch (err) {
    if (nr === laufNr) el.innerHTML = `<p class="klein" style="color:var(--rot)">Höhen konnten nicht geladen werden: ${esc(err.message)}</p>`;
  }
}, 250);

function profilSVG(d) {
  const W = 360, H = 200, l = 38, r = 8, t = 10, hP = 120, yB1 = t + hP + 12, yB2 = yB1 + 16;
  const hs = d.s.map(p => p.h).filter(isFinite), lo = Math.min(...hs), hi = Math.max(...hs), pad = Math.max(2, (hi - lo) * 0.08);
  const X = st => l + st / d.L * (W - l - r), Y = h => t + (1 - (h - lo + pad) / (hi - lo + 2 * pad)) * hP;
  const pfad = d.s.filter(p => isFinite(p.h)).map((p, i) => (i ? "L" : "M") + X(p.st).toFixed(1) + " " + Y(p.h).toFixed(1)).join("");
  const schritt = [1, 2, 5, 10, 20, 50, 100].find(s => (hi - lo + 2 * pad) / s <= 5) || 200;
  let ticks = ""; for (let h = Math.ceil((lo - pad) / schritt) * schritt; h <= hi + pad; h += schritt)
    ticks += `<line x1="${l}" x2="${W - r}" y1="${Y(h)}" y2="${Y(h)}" stroke="currentColor" stroke-opacity=".12"/><text x="${l - 4}" y="${Y(h) + 3}" text-anchor="end">${h}</text>`;
  const sSchritt = [25, 50, 100, 200, 500].find(s => d.L / s <= 8) || 1000;
  let sticks = ""; for (let s = 0; s <= d.L; s += sSchritt) sticks += `<text x="${X(s)}" y="${H - 2}" text-anchor="middle">${hm(s)}</text>`;
  const band1 = d.stuecke.map(s => `<rect x="${X(s.von)}" y="${yB1}" width="${Math.max(0.5, X(s.bis) - X(s.von))}" height="10" fill="${farbeNeigung(s.g)}"/>`).join("");
  const band2 = d.s.map(p => `<rect x="${X(p.st) - 0.6}" y="${yB2 + 12 - Math.min(1, p.quer) * 12}" width="1.6" height="${Math.min(1, p.quer) * 12}" fill="${p.quer >= 0.68 ? "#b3261e" : "#555"}"/>`).join("");
  return `<svg class="profil" viewBox="0 0 ${W} ${H}" id="profil" style="color:var(--text)">
    ${ticks}<path d="${pfad}" fill="none" stroke="#6b4420" stroke-width="1.8"/>
    ${band1}${band2}<text x="2" y="${yB1 + 8}">Längs</text><text x="2" y="${yB2 + 10}">Quer</text>${sticks}
    <line id="profil-cursor" x1="0" x2="0" y1="${t}" y2="${yB2 + 12}" stroke="#1565c0" stroke-width="1" visibility="hidden"/>
    <text id="profil-info" x="${W - r}" y="${t + 10}" text-anchor="end" style="fill:var(--text);font-weight:600"></text>
  </svg>`;
}

function bindeProfil(el, d) {
  const svg = $("#profil", el); if (!svg) return;
  const W = 360, l = 38, r = 8;
  const zeige = e => {
    const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * W;
    const st = Math.max(0, Math.min(d.L, (x - l) / (W - l - r) * d.L));
    const p = d.s.reduce((a, q) => Math.abs(q.st - st) < Math.abs(a.st - st) ? q : a);
    const s = d.stuecke.find(q => st >= q.von && st <= q.bis) || d.stuecke[d.stuecke.length - 1];
    const c = $("#profil-cursor", svg); c.setAttribute("x1", l + p.st / d.L * (W - l - r)); c.setAttribute("x2", c.getAttribute("x1")); c.setAttribute("visibility", "visible");
    $("#profil-info", svg).textContent = `hm ${hm(p.st)} · ${fmt(p.h, 1)} m · längs ${fmt(s.g * 100, 1)} % · quer ${fmt(p.quer * 100)} %`;
    const ll = zuWGS([p.x, p.y]);
    if (!hoverMarker) { const m = document.createElement("div"); m.className = "knoten"; m.style.setProperty("--k", "#1565c0"); hoverMarker = new maplibregl.Marker({ element: m }).setLngLat(ll).addTo(karte); }
    else hoverMarker.setLngLat(ll);
  };
  svg.addEventListener("pointermove", zeige); svg.addEventListener("pointerdown", zeige);
  svg.addEventListener("pointerleave", () => { hoverMarker?.remove(); hoverMarker = null; $("#profil-cursor", svg)?.setAttribute("visibility", "hidden"); });
}

export { analysiere, aktiv as aktiveVariante };
