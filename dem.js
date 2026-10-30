// Geländehöhen aus dem Höhenmodell (Terrarium-Kacheln, für Österreich aus dem DGM 10 m).
// Dieselben Kacheln nutzt die Karte für Höhenlinien, sie werden offline mitgespeichert.
export const DEM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
export const DEM_Z = 15;
import { zuWGS } from "./geo.js";

const kacheln = new Map();
let canvas;

function ladeKachel(tx, ty) {
  const key = tx + "/" + ty;
  if (!kacheln.has(key)) {
    const p = (async () => {
      const url = DEM_URL.replace("{z}", DEM_Z).replace("{x}", tx).replace("{y}", ty);
      const r = await fetch(url);
      if (!r.ok) throw new Error("Höhenkachel fehlt");
      const bmp = await createImageBitmap(await r.blob());
      canvas ??= Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, 256, 256); ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) h[i] = d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768;
      return h;
    })();
    p.catch(() => kacheln.delete(key));
    kacheln.set(key, p);
  }
  return kacheln.get(key);
}

function pixel(lon, lat) {
  const n = 2 ** DEM_Z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n * 256 - 0.5,
          (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * 256 - 0.5];
}

/** Höhen für viele Punkte [lon,lat] – lädt benötigte Kacheln, dann bilinear */
export async function hoehen(ll) {
  const px = ll.map(([lo, la]) => pixel(lo, la)), need = new Set();
  for (const [x, y] of px) for (const dx of [0, 1]) for (const dy of [0, 1])
    need.add(((Math.floor(x) + dx) >> 8) + "/" + ((Math.floor(y) + dy) >> 8));
  const tiles = {};
  await Promise.all([...need].map(async k => {
    const [a, b] = k.split("/").map(Number);
    try { tiles[k] = await ladeKachel(a, b); } catch { tiles[k] = null; }
  }));
  const v = (ix, iy) => { const t = tiles[(ix >> 8) + "/" + (iy >> 8)]; return t ? t[(iy & 255) * 256 + (ix & 255)] : NaN; };
  return px.map(([x, y]) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy;
  });
}
export const hoehe = async ll => (await hoehen([ll]))[0];
/** wie hoehen(), aber Eingabe in GK [x,y] */
export const hoehenGK = xy => hoehen(xy.map(zuWGS));
