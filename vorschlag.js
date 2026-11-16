// Automatischer Trassenvorschlag: günstigste Linie vom Start in den Zielbereich über das Höhenmodell.
//
// Suche (A*) auf einem Gitter aus 10-m-Schritten in 24 Richtungen (15°). Je Schritt darf die Richtung um
// höchstens 45° drehen (Kurvenradius ca. 13 m, für Kehren); enge Kurven kosten mehr. Bewertet wird wie in der Analyse im Panel: Längsneigung aus
// dem Gelände je 10 m, Neigungswechsel gegenüber dem vorigen Schritt, Querneigung des Geländes.
// Alle Grenzwerte sind „weich“ (hohe Strafkosten), damit auch in schwierigem Gelände ein Vorschlag kommt;
// was übrig bleibt, zeigt die Analyse der neuen Variante.
import { hoehenGK } from "./dem.js";
import { zuGK, zuWGS, abstand, vereinfache } from "./geo.js";

const RICHTUNGEN = 24, SCHRITT = 10, ZELLE = 7, RASTER = 5;
const MAX_ZELLEN = 160000;      // Raster 5 m → ca. 2 × 2 km Suchgebiet

/**
 * @param startLL [lon,lat]  Startpunkt (z. B. Anschluss an die bestehende Straße)
 * @param zielLL  [lon,lat]  Mitte des Zielbereichs
 * @param o {max, min, wechsel, qMax, zielRadius, fortschritt(n),
 *            startRichtung (Azimut rad, optional: Fortsetzung eines vorigen Abschnitts), startNeigung (optional)}
 * @returns {ll, L, endRichtung, endNeigung}
 */
export async function sucheTrasse(startLL, zielLL, o) {
  const S = zuGK(startLL), Z = zuGK(zielLL), D = abstand(S, Z), R = Math.max(5, o.zielRadius ?? 20);
  if (D <= R) throw new Error("Start liegt schon im Zielbereich.");

  // Suchgebiet: Rechteck um Start und Ziel, mit Rand für Umwege und Kehren
  const rand = Math.max(250, 0.6 * D);
  const x0 = Math.min(S[0], Z[0]) - rand, y0 = Math.min(S[1], Z[1]) - rand;
  const nx = Math.ceil((Math.max(S[0], Z[0]) + rand - x0) / RASTER) + 1;
  const ny = Math.ceil((Math.max(S[1], Z[1]) + rand - y0) / RASTER) + 1;
  if (nx * ny > MAX_ZELLEN) throw new Error("Start und Ziel liegen zu weit auseinander (bis ca. 1 km Luftlinie möglich). Ziel näher setzen und in Abschnitten planen.");

  // Geländehöhen im Raster laden
  const pts = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts[j * nx + i] = [x0 + i * RASTER, y0 + j * RASTER];
  const hr = Float32Array.from(await hoehenGK(pts));
  if (!isFinite(hr[Math.round((S[1] - y0) / RASTER) * nx + Math.round((S[0] - x0) / RASTER)]))
    throw new Error("Keine Höhendaten am Start (offline nicht gespeichert?).");

  // ab hier lokale Koordinaten (Ursprung x0/y0), damit Float32 reicht
  const s = [S[0] - x0, S[1] - y0], z = [Z[0] - x0, Z[1] - y0];
  const H = (x, y) => {
    const fx = x / RASTER, fy = y / RASTER, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return NaN;
    const a = fx - i, b = fy - j, k = j * nx + i;
    return hr[k] * (1 - a) * (1 - b) + hr[k + 1] * a * (1 - b) + hr[k + nx] * (1 - a) * b + hr[k + nx + 1] * a * b;
  };
  // Querneigung wie in der Analyse: Höhendifferenz 10 m links/rechts der Achse
  const quer = (x, y, sin, cos) => Math.abs(H(x - cos * 10, y + sin * 10) - H(x + cos * 10, y - sin * 10)) / 20;

  const SIN = [], COS = [];
  for (let d = 0; d < RICHTUNGEN; d++) { const a = d * 2 * Math.PI / RICHTUNGEN; SIN.push(Math.sin(a)); COS.push(Math.cos(a)); }

  // Zustände: Gitterzelle × Richtung. Je Zustand die tatsächliche Lage, Höhe, Neigung und Vorgänger.
  const zx = Math.ceil((nx * RASTER) / ZELLE), zy = Math.ceil((ny * RASTER) / ZELLE), N = zx * zy * RICHTUNGEN;
  const kosten = new Float32Array(N).fill(Infinity), vor = new Int32Array(N).fill(-1), zu = new Uint8Array(N);
  const px = new Float32Array(N), py = new Float32Array(N), ph = new Float32Array(N), pg = new Float32Array(N);
  const idx = (x, y, d) => {
    const i = Math.floor(x / ZELLE), j = Math.floor(y / ZELLE);
    return i < 0 || j < 0 || i >= zx || j >= zy ? -1 : (j * zx + i) * RICHTUNGEN + d;
  };
  const heu = (x, y) => Math.max(0, Math.hypot(z[0] - x, z[1] - y) - R);

  const heap = new Heap();
  const h0 = H(s[0], s[1]);
  for (let d = 0; d < RICHTUNGEN; d++) {
    // Fortsetzung: nur Richtungen bis 45° neben der bisherigen, sonst entsteht am Übergang ein Knick
    if (o.startRichtung != null) {
      const a = d * 2 * Math.PI / RICHTUNGEN, w = Math.abs(Math.atan2(Math.sin(a - o.startRichtung), Math.cos(a - o.startRichtung)));
      if (w > Math.PI / 4 + 1e-6) continue;
    }
    const k = idx(s[0], s[1], d);
    kosten[k] = 0; px[k] = s[0]; py[k] = s[1]; ph[k] = h0; pg[k] = o.startNeigung ?? NaN;
    heap.push(heu(s[0], s[1]), k);
  }

  const { max, min, wechsel, qMax } = o;
  let ziel = -1, n = 0, naechster = -1, naechsterAbst = Infinity;
  while (heap.size) {
    const k = heap.pop();
    if (zu[k]) continue;
    zu[k] = 1;
    const x = px[k], y = py[k];
    const r = Math.hypot(z[0] - x, z[1] - y);
    if (r <= R) { ziel = k; break; }
    if (r < naechsterAbst) { naechsterAbst = r; naechster = k; }
    if (++n % 20000 === 0) { o.fortschritt?.(n); await new Promise(res => setTimeout(res, 0)); }
    if (n > 4e6) break;

    const d0 = k % RICHTUNGEN, hc = ph[k], gv = pg[k];
    for (let dd = -3; dd <= 3; dd++) {
      const d = (d0 + dd + RICHTUNGEN) % RICHTUNGEN;
      const x2 = x + SCHRITT * SIN[d], y2 = y + SCHRITT * COS[d];
      const h2 = H(x2, y2); if (!isFinite(h2)) continue;
      const g = (h2 - hc) / SCHRITT, ag = Math.abs(g);
      if (ag > max + 0.05) continue;                       // deutlich zu steil: nicht weiter verfolgen
      let c = SCHRITT + Math.abs(dd) * 1.5 + (Math.abs(dd) === 3 ? 6 : 0);   // Länge + etwas für Kurven, enge Kurven mehr
      if (ag > max) c += (ag - max) * 100 * 60;
      if (ag < min) c += (min - ag) * 100 * 2;
      if (isFinite(gv)) { const dg = Math.abs(g - gv); if (dg > wechsel) c += (dg - wechsel) * 100 * 8; }
      const q = quer((x + x2) / 2, (y + y2) / 2, SIN[d], COS[d]);
      if (isFinite(q)) { c += q * 2; if (q > qMax) c += (q - qMax) * 100 * 15; }
      const k2 = idx(x2, y2, d); if (k2 < 0 || zu[k2]) continue;
      const kn = kosten[k] + c;
      if (kn < kosten[k2]) {
        kosten[k2] = kn; vor[k2] = k; px[k2] = x2; py[k2] = y2; ph[k2] = h2; pg[k2] = g;
        heap.push(kn + heu(x2, y2), k2);
      }
    }
  }
  if (ziel < 0) {
    throw new Error(naechster >= 0 && naechsterAbst < D
      ? `Kein Weg in den Zielbereich gefunden – am nächsten kam die Suche auf ${Math.round(naechsterAbst)} m. Grenzwerte lockern, Zielbereich vergrößern oder Zwischenziel (Kehre) setzen.`
      : "Kein Weg gefunden – das Gelände ist mit diesen Grenzwerten zu steil.");
  }
  const linie = [];
  for (let k = ziel; k >= 0; k = vor[k]) linie.push([px[k] + x0, py[k] + y0]);
  linie.reverse();
  // gleiche Startpunkte (alle Richtungen) zusammenfassen
  const ll = vereinfache(linie.filter((p, i) => i === 0 || abstand(p, linie[i - 1]) > 0.01).map(zuWGS), 1.0);
  let L = 0; for (let i = 1; i < linie.length; i++) L += abstand(linie[i - 1], linie[i]);
  return { ll, L, geprueft: n, endRichtung: (ziel % RICHTUNGEN) * 2 * Math.PI / RICHTUNGEN, endNeigung: isFinite(pg[ziel]) ? pg[ziel] : null };
}

/** kleiner Binär-Heap (Priorität, Wert) */
class Heap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.p.length; }
  push(p, v) {
    const P = this.p, V = this.v; let i = P.length; P.push(p); V.push(v);
    while (i > 0) { const j = (i - 1) >> 1; if (P[j] <= p) break; P[i] = P[j]; V[i] = V[j]; i = j; }
    P[i] = p; V[i] = v;
  }
  pop() {
    const P = this.p, V = this.v, top = V[0], lp = P.pop(), lv = V.pop(), n = P.length;
    if (n) {
      let i = 0;
      for (;;) {
        let j = 2 * i + 1; if (j >= n) break;
        if (j + 1 < n && P[j + 1] < P[j]) j++;
        if (P[j] >= lp) break;
        P[i] = P[j]; V[i] = V[j]; i = j;
      }
      P[i] = lp; V[i] = lv;
    }
    return top;
  }
}
