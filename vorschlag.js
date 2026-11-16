// Automatischer Trassenvorschlag: günstigste Linie vom Start über Zwischenziele in den Zielbereich.
//
// Suche (A*) auf einem Gitter aus 10-m-Schritten in 24 Richtungen (15°). Je Schritt darf die Richtung um
// höchstens 45° drehen (Kurvenradius ca. 13 m, für Kehren); enge Kurven kosten mehr. Bewertet wird wie in der
// Analyse im Panel: Längsneigung aus dem Gelände je 10 m, Neigungswechsel gegenüber dem vorigen Schritt,
// Querneigung des Geländes. Alle Grenzwerte sind „weich“ (hohe Strafkosten), damit auch in schwierigem Gelände
// ein Vorschlag kommt; was übrig bleibt, zeigt die Analyse der neuen Variante.
// Zwischenziele (Bereiche, die erschlossen werden sollen) werden in einer gemeinsamen Suche berücksichtigt:
// der Zustand merkt sich, welcher Bereich als nächster erreicht werden muss. So wird die ganze Linie
// gemeinsam optimiert und nicht Abschnitt für Abschnitt (das gäbe Schleifen an den Bereichen).
import { hoehenGK } from "./dem.js";
import { zuGK, zuWGS, abstand, vereinfache } from "./geo.js";

const RICHTUNGEN = 24, SCHRITT = 10, RASTER = 5;
const MAX_ZELLEN = 160000;      // Höhenraster 5 m → ca. 2 × 2 km Suchgebiet
const MAX_ZUSTAENDE = 3e6;      // Speicher ca. 75 MB; bei großen Gebieten wird das Suchgitter gröber

/**
 * @param startLL [lon,lat]  Startpunkt (z. B. Anschluss an die bestehende Straße)
 * @param ziele   [{ll, r}]  Zwischenziele in Reihenfolge, zuletzt das Ziel (ll = Mitte, r = Radius in m)
 * @param o {max, min, wechsel, qMax, fortschritt(n)}
 * @returns {ll, L, geprueft}
 */
export async function sucheTrasse(startLL, ziele, o) {
  if (typeof ziele[0] === "number") ziele = [{ ll: ziele, r: o.zielRadius ?? 20 }];   // ein einzelnes Ziel
  const S = zuGK(startLL), m = ziele.length;
  const C = ziele.map(z => zuGK(z.ll)), R = ziele.map(z => Math.max(5, z.r ?? 20));

  // Suchgebiet: Rechteck um alle Punkte, mit Rand für Umwege und Kehren
  const alle = [S, ...C], xs = alle.map(p => p[0]), ys = alle.map(p => p[1]);
  const bx = Math.max(...xs) - Math.min(...xs), by = Math.max(...ys) - Math.min(...ys);
  let rand = Math.max(250, 0.5 * Math.hypot(bx, by));
  while (rand > 150 && ((bx + 2 * rand) / RASTER + 1) * ((by + 2 * rand) / RASTER + 1) > MAX_ZELLEN) rand -= 25;
  const x0 = Math.min(...xs) - rand, y0 = Math.min(...ys) - rand;
  const nx = Math.ceil((bx + 2 * rand) / RASTER) + 1, ny = Math.ceil((by + 2 * rand) / RASTER) + 1;
  if (nx * ny > MAX_ZELLEN) throw new Error("Die Punkte liegen zu weit auseinander (Gebiet bis ca. 2 × 2 km). In Abschnitten planen.");

  // Geländehöhen im Raster laden
  const pts = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts[j * nx + i] = [x0 + i * RASTER, y0 + j * RASTER];
  const hr = Float32Array.from(await hoehenGK(pts));
  if (!isFinite(hr[Math.round((S[1] - y0) / RASTER) * nx + Math.round((S[0] - x0) / RASTER)]))
    throw new Error("Keine Höhendaten am Start (offline nicht gespeichert?).");

  // ab hier lokale Koordinaten (Ursprung x0/y0), damit Float32 reicht
  const s = [S[0] - x0, S[1] - y0], c = C.map(p => [p[0] - x0, p[1] - y0]);
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

  // Zustände: Stufe (nächstes Ziel) × Gitterzelle × Richtung. Je Zustand Lage, Höhe, Neigung und Vorgänger.
  const W = nx * RASTER, Hh = ny * RASTER;
  const ZELLE = Math.max(7, Math.sqrt(W * Hh * RICHTUNGEN * m / MAX_ZUSTAENDE));
  const zx = Math.ceil(W / ZELLE), zy = Math.ceil(Hh / ZELLE), N = m * zx * zy * RICHTUNGEN;
  const kosten = new Float32Array(N).fill(Infinity), vor = new Int32Array(N).fill(-1), zu = new Uint8Array(N);
  const px = new Float32Array(N), py = new Float32Array(N), ph = new Float32Array(N), pg = new Float32Array(N);
  const idx = (st, x, y, d) => {
    const i = Math.floor(x / ZELLE), j = Math.floor(y / ZELLE);
    return i < 0 || j < 0 || i >= zx || j >= zy ? -1 : ((st * zy + j) * zx + i) * RICHTUNGEN + d;
  };
  const stufeVon = k => Math.floor(k / (zx * zy * RICHTUNGEN));
  const drin = (st, x, y) => Math.hypot(c[st][0] - x, c[st][1] - y) <= R[st];
  // nach einem Schritt: alle Bereiche, in denen man jetzt steht, gelten als erreicht (außer dem Ziel)
  const weiter = (st, x, y) => { while (st < m - 1 && drin(st, x, y)) st++; return st; };
  // Schätzung der Restlänge: bis zum Rand des nächsten Bereichs + Abstände der weiteren Bereiche
  const rest = new Float64Array(m);
  for (let i = m - 2; i >= 0; i--) rest[i] = rest[i + 1] + Math.max(0, abstand(c[i], c[i + 1]) - R[i] - R[i + 1]);
  const heu = (st, x, y) => Math.max(0, Math.hypot(c[st][0] - x, c[st][1] - y) - R[st]) + rest[st];

  const heap = new Heap();
  const h0 = H(s[0], s[1]), st0 = weiter(0, s[0], s[1]);
  for (let d = 0; d < RICHTUNGEN; d++) {
    const k = idx(st0, s[0], s[1], d);
    kosten[k] = 0; px[k] = s[0]; py[k] = s[1]; ph[k] = h0; pg[k] = NaN;
    heap.push(heu(st0, s[0], s[1]), k);
  }

  const { max, min, wechsel, qMax } = o;
  let ziel = -1, n = 0, besteStufe = st0, besterAbst = Infinity;
  while (heap.size) {
    const k = heap.pop();
    if (zu[k]) continue;
    zu[k] = 1;
    const x = px[k], y = py[k], st = stufeVon(k);
    if (st === m - 1 && drin(st, x, y)) { ziel = k; break; }
    const r = Math.hypot(c[st][0] - x, c[st][1] - y);
    if (st > besteStufe || (st === besteStufe && r < besterAbst)) { besteStufe = st; besterAbst = r; }
    if (++n % 20000 === 0) { o.fortschritt?.(n); await new Promise(res => setTimeout(res, 0)); }
    if (n > 6e6) break;

    const d0 = k % RICHTUNGEN, hc = ph[k], gv = pg[k];
    for (let dd = -3; dd <= 3; dd++) {
      const d = (d0 + dd + RICHTUNGEN) % RICHTUNGEN;
      const x2 = x + SCHRITT * SIN[d], y2 = y + SCHRITT * COS[d];
      const h2 = H(x2, y2); if (!isFinite(h2)) continue;
      const g = (h2 - hc) / SCHRITT, ag = Math.abs(g);
      if (ag > max + 0.05) continue;                       // deutlich zu steil: nicht weiter verfolgen
      let kk = SCHRITT + Math.abs(dd) * 1.5 + (Math.abs(dd) === 3 ? 6 : 0);   // Länge + etwas für Kurven, enge Kurven mehr
      if (ag > max) kk += (ag - max) * 100 * 60;
      if (ag < min) kk += (min - ag) * 100 * 2;
      if (isFinite(gv)) { const dg = Math.abs(g - gv); if (dg > wechsel) kk += (dg - wechsel) * 100 * 8; }
      const q = quer((x + x2) / 2, (y + y2) / 2, SIN[d], COS[d]);
      if (isFinite(q)) { kk += q * 2; if (q > qMax) kk += (q - qMax) * 100 * 15; }
      const st2 = weiter(st, x2, y2);
      const k2 = idx(st2, x2, y2, d); if (k2 < 0 || zu[k2]) continue;
      const kn = kosten[k] + kk;
      if (kn < kosten[k2]) {
        kosten[k2] = kn; vor[k2] = k; px[k2] = x2; py[k2] = y2; ph[k2] = h2; pg[k2] = g;
        heap.push(kn + heu(st2, x2, y2), k2);
      }
    }
  }
  if (ziel < 0) {
    const was = besteStufe === m - 1 ? "Zielbereich" : `Zwischenziel ${besteStufe + 1}`;
    throw new Error(isFinite(besterAbst)
      ? `Kein Weg gefunden – die Suche kam bis auf ${Math.round(Math.max(0, besterAbst - R[besteStufe]))} m an ${was} heran. Grenzwerte lockern, Bereich vergrößern oder ein Zwischenziel (Kehre) setzen.`
      : "Kein Weg gefunden – das Gelände ist mit diesen Grenzwerten zu steil.");
  }
  const linie = [];
  for (let k = ziel; k >= 0; k = vor[k]) linie.push([px[k] + x0, py[k] + y0]);
  linie.reverse();
  const ll = vereinfache(linie.filter((p, i) => i === 0 || abstand(p, linie[i - 1]) > 0.01).map(zuWGS), 1.0);
  let L = 0; for (let i = 1; i < linie.length; i++) L += abstand(linie[i - 1], linie[i]);
  return { ll, L, geprueft: n };
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
