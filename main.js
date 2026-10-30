// Start, Projektzustand und Moduswechsel.
import * as store from "./store.js";
import { $, $$, lsLesen, lsSchreiben, entprellt, toast } from "./ui.js";
import { erstelleKarte } from "./karte.js";
import * as planen from "./planen.js";
import * as aufnehmen from "./aufnehmen.js";
import * as blatt from "./blatt.js";
import * as daten from "./daten.js";

export const app = { projekt: null, modus: null };
const MODI = { planen, aufnehmen, blatt, daten };

export function neuesProjekt(name = "Neues Projekt") {
  return {
    id: store.neueId(), version: 1, erstellt: new Date().toISOString(),
    blatt: { bezeichnung: name, kurz: "", wegtyp: ["Traktorweg"] },
    weg: { planum_m: 4.5, fahrbahn_m: 3.5, laengsneigung_max: 0.10, laengsneigung_min: 0.05 },
    plan: { varianten: [], aktiv: null },
    punkte: [],
    einstellungen: { mitteln_s: 5, punktabstand_m: 25, qn_abstand_m: 50, genauigkeit_m: 2 },
  };
}

const speichernSpaeter = entprellt(async () => {
  try { await store.speichereProjekt(app.projekt); $("#speicherstatus").textContent = "gespeichert"; }
  catch (e) { $("#speicherstatus").textContent = "Speichern fehlgeschlagen"; console.error(e); }
}, 400);

/** Nach jeder Änderung am Projekt aufrufen */
export function geaendert(was = "alles") {
  app.projekt.geaendert = new Date().toISOString();
  $("#speicherstatus").textContent = "…";
  speichernSpaeter();
  $("#projektname").textContent = app.projekt.blatt.bezeichnung || "Projekt";
  for (const m of Object.values(MODI)) m.projektGeaendert?.(was);
}

export async function oeffneProjekt(p) {
  app.projekt = p;
  p.plan ??= { varianten: [], aktiv: null }; p.punkte ??= []; p.weg ??= {}; p.einstellungen ??= neuesProjekt().einstellungen;
  await store.metaSchreiben("letztes", p.id);
  $("#projektname").textContent = p.blatt.bezeichnung || "Projekt";
  for (const m of Object.values(MODI)) m.projektGeaendert?.("geoeffnet");
  wechsle(app.modus || lsLesen("modus", "planen"));
}

export function wechsle(modus) {
  if (app.modus && app.modus !== modus) MODI[app.modus].verlassen?.();
  app.modus = modus; lsSchreiben("modus", modus);
  $$("#tabs button").forEach(b => b.classList.toggle("aktiv", b.dataset.modus === modus));
  document.body.classList.toggle("breit", modus === "blatt");
  $("#fadenkreuz").hidden = true; $("#hinweisband").hidden = true;
  const panel = $("#panel"); panel.scrollTop = 0;
  MODI[modus].betreten(panel);
}

async function start() {
  erstelleKarte();
  aufnehmen.bindePositionsKnopf();
  $$("#tabs button").forEach(b => (b.onclick = () => wechsle(b.dataset.modus)));
  $("#projektname").onclick = () => wechsle("daten");
  navigator.storage?.persist?.();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e));
  }
  let p = null;
  try { const id = await store.metaLesen("letztes"); if (id) p = await store.ladeProjekt(id); } catch (e) { console.error(e); }
  if (!p) { p = (await store.alleProjekte()).sort((a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""))[0]; }
  if (!p) { p = neuesProjekt(); await store.speichereProjekt(p); }
  await oeffneProjekt(p);
}
start().catch(e => { console.error(e); toast("Fehler beim Start: " + e.message, 8000); });
