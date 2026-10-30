// Karte: basemap.at, Schummerung, Höhenlinien und die Projekt-Ebenen.
import { DEM_URL } from "./dem.js";
import { lsLesen, lsSchreiben } from "./ui.js";

const BM = "https://maps.wien.gv.at/basemap/";
export const KACHEL_QUELLEN = {
  grund: { name: "Grundkarte", url: BM + "geolandbasemap/normal/google3857/{z}/{y}/{x}.png", max: 19 },
  grau: { name: "Grundkarte grau", url: BM + "bmapgrau/normal/google3857/{z}/{y}/{x}.png", max: 19 },
  ortho: { name: "Orthofoto", url: BM + "bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg", max: 19 },
  gelaende: { name: "Schummerung", url: BM + "bmapgelaende/grau/google3857/{z}/{y}/{x}.jpeg", max: 17 },
  dem: { name: "Höhenmodell (Höhenlinien, Neigungen)", url: DEM_URL, max: 15 },
};
const ATTR_BM = '<a href="https://basemap.at" target="_blank">basemap.at</a>';
const ATTR_DEM = 'Höhen: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles</a> (DGM Österreich)';
const SCHRIFT = ["Noto Sans Regular"];

const EBENEN_STD = { basis: "grund", gelaende: true, hl: true, plan: true, aufnahme: true };
export let ebenen = { ...EBENEN_STD, ...lsLesen("ebenen", {}) };
export let karte;

const leer = () => ({ type: "FeatureCollection", features: [] });

export function erstelleKarte() {
  const dem = new mlcontour.DemSource({ url: DEM_URL, encoding: "terrarium", maxzoom: 15, worker: false, cacheSize: 200 });
  dem.setupMaplibre(maplibregl);
  const ras = (k, attr) => ({ type: "raster", tiles: [KACHEL_QUELLEN[k].url], tileSize: 256, maxzoom: KACHEL_QUELLEN[k].max, attribution: attr });
  const start = lsLesen("ansicht", { center: [14.159, 47.812], zoom: 15 });

  karte = new maplibregl.Map({
    container: "karte",
    center: start.center, zoom: start.zoom, maxZoom: 20, minZoom: 6,
    attributionControl: { compact: true },
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        grund: ras("grund", ATTR_BM), grau: ras("grau", ATTR_BM), ortho: ras("ortho", ATTR_BM),
        gelaende: ras("gelaende", ATTR_BM),
        hl: {
          type: "vector", maxzoom: 16, attribution: ATTR_DEM,
          tiles: [dem.contourProtocolUrl({
            thresholds: { 12: [50, 250], 13: [20, 100], 14: [10, 50], 15: [5, 25] },
            elevationKey: "ele", levelKey: "level", contourLayer: "hl",
          })],
        },
        "plan-alle": { type: "geojson", data: leer() },
        "plan-neigung": { type: "geojson", data: leer() },
        "aufnahme-linie": { type: "geojson", data: leer() },
        "aufnahme-punkte": { type: "geojson", data: leer() },
        position: { type: "geojson", data: leer() },
      },
      layers: [
        { id: "grund", type: "raster", source: "grund" },
        { id: "grau", type: "raster", source: "grau" },
        { id: "ortho", type: "raster", source: "ortho" },
        { id: "gelaende", type: "raster", source: "gelaende", paint: { "raster-opacity": 0.4 } },
        { id: "hl", type: "line", source: "hl", "source-layer": "hl",
          paint: { "line-color": "#8a5a2b", "line-opacity": 0.75, "line-width": ["match", ["get", "level"], 1, 1.3, 0.6] } },
        { id: "hl-text", type: "symbol", source: "hl", "source-layer": "hl", filter: [">", ["get", "level"], 0],
          layout: { "symbol-placement": "line", "text-field": ["to-string", ["get", "ele"]], "text-font": SCHRIFT, "text-size": 10 },
          paint: { "text-color": "#6b4420", "text-halo-color": "#fff", "text-halo-width": 1.2 } },
        { id: "plan-alle", type: "line", source: "plan-alle",
          paint: { "line-color": ["get", "farbe"], "line-width": ["case", ["get", "aktiv"], 3, 2],
                   "line-opacity": ["case", ["get", "aktiv"], 0.9, 0.55], "line-dasharray": [2, 1.2] } },
        { id: "plan-neigung", type: "line", source: "plan-neigung", layout: { "line-cap": "round" },
          paint: { "line-color": ["get", "farbe"], "line-width": 6, "line-opacity": 0.85 } },
        { id: "aufnahme-linie", type: "line", source: "aufnahme-linie",
          paint: { "line-color": "#1565c0", "line-width": 3 } },
        { id: "aufnahme-punkte", type: "circle", source: "aufnahme-punkte",
          paint: { "circle-radius": ["case", ["==", ["get", "code"], "TA"], 5, 7], "circle-color": ["case", ["==", ["get", "code"], "TA"], "#1565c0", "#e65100"],
                   "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
        { id: "aufnahme-text", type: "symbol", source: "aufnahme-punkte",
          layout: { "text-field": ["case", ["==", ["get", "code"], "TA"], ["get", "name"], ["concat", ["get", "name"], " ", ["get", "code"]]],
                    "text-font": SCHRIFT, "text-size": 12, "text-offset": [0.9, -0.9], "text-anchor": "left", "text-optional": true },
          paint: { "text-color": "#0d3c75", "text-halo-color": "#fff", "text-halo-width": 1.5 } },
        { id: "pos-genau", type: "fill", source: "position", filter: ["==", ["get", "art"], "genau"],
          paint: { "fill-color": "#1e88e5", "fill-opacity": 0.15 } },
        { id: "pos", type: "circle", source: "position", filter: ["==", ["get", "art"], "pos"],
          paint: { "circle-radius": 8, "circle-color": "#1e88e5", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } },
      ],
    },
  });
  karte.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  karte.on("moveend", () => lsSchreiben("ansicht", { center: karte.getCenter().toArray(), zoom: karte.getZoom() }));
  karte.on("load", wendeEbenenAn);
  new ResizeObserver(() => karte.resize()).observe(document.getElementById("karte"));
  baueEbenenMenue();
  return karte;
}

export function setzeDaten(id, fc) {
  const s = karte?.getSource(id);
  if (s) s.setData(fc); else karte?.once("load", () => karte.getSource(id).setData(fc));
}

function wendeEbenenAn() {
  const v = (id, an) => karte.getLayer(id) && karte.setLayoutProperty(id, "visibility", an ? "visible" : "none");
  for (const b of ["grund", "grau", "ortho"]) v(b, ebenen.basis === b);
  v("gelaende", ebenen.gelaende); v("hl", ebenen.hl); v("hl-text", ebenen.hl);
  v("plan-alle", ebenen.plan); v("plan-neigung", ebenen.plan);
  for (const id of ["aufnahme-linie", "aufnahme-punkte", "aufnahme-text"]) v(id, ebenen.aufnahme);
  lsSchreiben("ebenen", ebenen);
}

function baueEbenenMenue() {
  const el = document.getElementById("ebenen");
  const r = (k, t) => `<label><input type="radio" name="basis" value="${k}" ${ebenen.basis === k ? "checked" : ""}>${t}</label>`;
  const c = (k, t) => `<label><input type="checkbox" data-k="${k}" ${ebenen[k] ? "checked" : ""}>${t}</label>`;
  el.innerHTML = `<h4>Hintergrund</h4>${r("grund", "Grundkarte")}${r("grau", "Grundkarte grau")}${r("ortho", "Orthofoto")}
    <h4>Darüber</h4>${c("gelaende", "Schummerung")}${c("hl", "Höhenlinien")}${c("plan", "Planung")}${c("aufnahme", "Aufnahme")}`;
  el.addEventListener("change", e => {
    const t = e.target;
    if (t.name === "basis") ebenen.basis = t.value; else ebenen[t.dataset.k] = t.checked;
    wendeEbenenAn();
  });
  const btn = document.getElementById("btn-ebenen");
  btn.onclick = () => { el.hidden = !el.hidden; btn.classList.toggle("an", !el.hidden); };
}

/** Kreis (Genauigkeit) als Polygon */
export function kreis([lon, lat], r) {
  const pts = [], k = 111320 * Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= 40; i++) { const a = i / 40 * 2 * Math.PI; pts.push([lon + r * Math.cos(a) / k, lat + r * Math.sin(a) / 110540]); }
  return { type: "Polygon", coordinates: [pts] };
}
