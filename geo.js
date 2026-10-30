// Koordinaten und Geometrie. Gerechnet wird in GK M31 (EPSG:31255), Meter.
proj4.defs("EPSG:31255",
  "+proj=tmerc +lat_0=0 +lon_0=13.33333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel " +
  "+towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs");
const fwd = proj4("EPSG:4326", "EPSG:31255");

export const zuGK = ([lon, lat]) => fwd.forward([lon, lat]);
export const zuWGS = ([x, y]) => fwd.inverse([x, y]);

export const abstand = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const abstandLL = (a, b) => abstand(zuGK(a), zuGK(b));

/** Stationen (kumulierte Länge) einer Linie in WGS84 */
export function stationen(ll) {
  const g = ll.map(zuGK); const st = [0];
  for (let i = 1; i < g.length; i++) st.push(st[i - 1] + abstand(g[i - 1], g[i]));
  return st;
}

/** Punkte alle ds Meter entlang der Linie, mit Richtung (Einheitsvektor) */
export function teile(ll, ds) {
  const g = ll.map(zuGK); const out = [];
  if (g.length < 2) return out;
  let st = 0, rest = 0;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i], L = abstand(a, b);
    if (L === 0) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let t = rest;
    while (t <= L + 1e-9) {
      const x = a[0] + ux * t, y = a[1] + uy * t;
      out.push({ st: st + t, x, y, ux, uy });
      t += ds;
    }
    rest = t - L; st += L;
  }
  const e = g[g.length - 1], l = out[out.length - 1];
  if (st - l.st > 0.5) out.push({ st, x: e[0], y: e[1], ux: l.ux, uy: l.uy });
  return out;
}

/** Projektion eines Punktes auf eine Linie: Station, Abstand (+ = rechts der Achse) */
export function aufLinie(pLL, ll) {
  if (ll.length < 2) return null;
  const p = zuGK(pLL), g = ll.map(zuGK); let best = null, st0 = 0;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx, qy = a[1] + t * dy, d = Math.hypot(p[0] - qx, p[1] - qy);
    const seite = Math.sign(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) || 1;
    if (!best || d < best.abstand) best = { abstand: d, seite: -seite, station: st0 + t * L };
    st0 += L;
  }
  return best;
}

/** Douglas-Peucker in GK; Rückgabe WGS84 */
export function vereinfache(ll, tol) {
  const g = ll.map(zuGK);
  if (g.length < 3) return ll.slice();
  const keep = new Uint8Array(g.length); keep[0] = keep[g.length - 1] = 1;
  const stack = [[0, g.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let dmax = 0, k = -1;
    const a = g[i], b = g[j], L = abstand(a, b) || 1e-9;
    for (let m = i + 1; m < j; m++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - g[m][1]) - (a[0] - g[m][0]) * (b[1] - a[1])) / L;
      if (d > dmax) { dmax = d; k = m; }
    }
    if (dmax > tol) { keep[k] = 1; stack.push([i, k], [k, j]); }
  }
  return ll.filter((_, i) => keep[i]);
}

export const fmt = (v, n = 0) => v == null || isNaN(v) ? "–" :
  v.toLocaleString("de-AT", { minimumFractionDigits: n, maximumFractionDigits: n });
export const hm = st => fmt(st / 100, 2);
