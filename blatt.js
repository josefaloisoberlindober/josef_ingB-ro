// Modus „Projektblatt“: Blatt 1 der Feldaufnahme (Stammdaten und Rahmenbedingungen).
import { app, geaendert } from "./main.js";
import { $$, esc, entprellt } from "./ui.js";

// t = Text, z = Zahl, d = Datum, l = langer Text, k = Ankreuzliste
export const ABSCHNITTE = [
  ["A   Projekt und Beteiligte", [
    ["bezeichnung", "Projektbezeichnung", "t"], ["nr", "Projekt-Nr.", "t"],
    ["kurz", "Kurzname (für Dateinamen)", "t"], ["bauwerber", "Auftraggeber / Bauwerber", "t"],
    ["kontakt", "Kontakt (Tel., E-Mail)", "t"], ["adresse", "Adresse Auftraggeber", "t"],
    ["ansprech", "Ansprechperson vor Ort", "t"], ["waldeigentuemer", "Waldeigentümer (falls abweichend)", "t"],
    ["anzahl_eig", "Anzahl Eigentümer", "z"], ["gemeinde", "Gemeinde", "t"],
    ["kg", "Katastralgemeinde (Name / Nr.)", "t"], ["grundstuecke", "Grundstücke (mit Beistrich trennen)", "t"],
    ["bezirk", "Bezirk / BH", "t"], ["begehung", "Begehung am", "d"], ["teilnehmer", "Teilnehmer", "t"],
    ["gnss_datum", "GNSS-Aufnahme am", "d"], ["geraet", "Gerät / Korrekturdienst", "t"],
  ]],
  ["B   Rechtliche Rahmenbedingungen", [
    ["waldkategorie", "Waldkategorie", "k", ["Wirtschaftswald", "Schutzwald (Standort)", "Objektschutzwald", "Bannwald"]],
    ["bannwald_bescheid", "Bannwald – Bescheid", "t"], ["bannwald_kote", "Grenze / Kote", "t"],
    ["interessen", "Berührte Interessen", "k", ["Eisenbahn (§ 43 EisbG)", "öffentliche Straße", "Leitung (Strom/Gas/Wasser)", "Gewässer / Gerinne",
      "WLV-Gefahrenzone", "Natura 2000 / Schutzgebiet", "Landschafts-/Uferschutz", "Wasserschutz-/Schongebiet, Quellen", "Alpenkonvention",
      "fremde Grundstücke", "öffentliches Gut", "Jagd / Wildökologie"]],
    ["verfahren", "Verfahren", "k", ["Anzeige", "Bewilligung (§ 62 ForstG)", "Naturschutzverfahren", "Wasserrecht", "Rodung"]],
    ["vorgaben", "Vorgaben aus Vorgesprächen (Behörde, Bahn, Eigentümer)", "l"],
  ]],
  ["C   Weg und Ausbau", [
    ["wegtyp", "Wegtyp", "k", ["Traktorweg", "LKW-Forststraße", "Rückeweg / Maschinenweg"]],
    ["laenge", "Länge ca. [m]", "z"], ["fahrzeug", "Bemessungsfahrzeug", "t"],
    ["planum", "Planum [m]", "z"], ["fahrbahn", "Fahrbahn [m]", "z"], ["aufhieb", "Aufhieb [m]", "z"], ["ln_max", "max. Längsneigung [%]", "z"],
    ["querprofil", "Querprofil", "k", ["talseitig geneigt (hängend)", "bergseitig mit Graben", "Dachprofil"]],
    ["quergefaelle", "Quergefälle [%]", "z"],
    ["oberbau", "Oberbau", "k", ["Aushubmaterial", "Fremdmaterial"]], ["oberbau_koernung", "Körnung", "t"], ["oberbau_cm", "Stärke [cm]", "z"],
    ["entwaesserung", "Entwässerung", "k", ["flächig über Querneigung", "Spitzgraben", "Wasserauskehren", "Rohrdurchlass", "Furt"]],
    ["durchlaesse", "Rohrdurchlässe Stk.", "z"],
    ["bauweise", "Bauweise", "k", ["Bagger, Querausgleich", "Längsausgleich / Abtransport", "Fels: Meißel", "Fels: Sprengung"]],
    ["kehren", "Kehren Stk.", "z"], ["plaetze", "Umkehr-/Lagerplätze Stk.", "z"],
    ["einbau", "Einbau-/Deponiemöglichkeit für Überschuss (Berme, Altweg, Mulde – Lage hm)", "l"],
  ]],
  ["D   Nutzungs- und Bringungskonzept", [
    ["bringung", "Bringung", "k", ["Seilkran bergauf", "Seilkran bergab", "Harvester / Forwarder", "Traktor + Seilwinde"]],
    ["bringung_sonst", "Bringung sonstiges", "t"],
    ["hiebsart", "Hiebsart", "k", ["Einzelstamm / Plenterung", "Femel / Gruppen", "Schlag"]],
    ["ueberschirmung", "Überschirmung mind.", "t"], ["holzanfall", "Holzanfall ca. [fm]", "z"],
    ["seiltrassen", "Seiltrassen (Richtung, Abstand)", "t"], ["bringungsverfahren", "Bringungsverfahren (Baum/Stamm/Sortiment)", "t"],
    ["baumarten", "Bestand – Baumarten", "t"], ["alter", "Alter / Entwicklungsstufe / Verjüngung", "t"],
  ]],
  ["E   Ökologie und Naturschutz", [
    ["vorkommen", "Vorkommen", "k", ["Horst-/Höhlenbäume", "Totholz / Biotopbäume", "Feuchtstellen / Quellen", "geschützte Pflanzen",
      "Felsbildungen", "Wildwechsel / Einstand", "Ameisenhaufen", "Bodendenkmal"]],
    ["begruenung", "Begrünung / Bau", "k", ["standortgerechtes Saatgut", "Humusandeckung", "Heublumen / Mähgut"]],
    ["zeitfenster", "Zeitfenster Bau", "t"], ["bemerkungen", "Bemerkungen", "l"],
  ]],
];

let panel = null, aktivModus = false;
const B = () => app.projekt.blatt;

export function betreten(el) { panel = el; aktivModus = true; render(); }
export function verlassen() { aktivModus = false; }
export function projektGeaendert(was) { if (aktivModus && (was === "geoeffnet" || was === "import")) render(); }

function feld([k, label, typ, opt]) {
  const v = B()[k];
  if (typ === "k") return `<div class="ganz"><label class="lab">${esc(label)}</label><div class="ankreuz">${opt.map(o =>
    `<label><input type="checkbox" data-k="${k}" value="${esc(o)}" ${(v || []).includes(o) ? "checked" : ""}>${esc(o)}</label>`).join("")}</div></div>`;
  if (typ === "l") return `<div class="ganz"><label class="lab">${esc(label)}</label><textarea class="feld" data-k="${k}">${esc(v)}</textarea></div>`;
  return `<div><label class="lab">${esc(label)}</label><input class="feld" data-k="${k}" ${typ === "z" ? 'inputmode="decimal"' : ""} ${typ === "d" ? 'type="date"' : ""} value="${esc(v)}"></div>`;
}

function render() {
  panel.innerHTML = `<h2>Projektblatt</h2>
    <p class="klein">Blatt 1 der Feldaufnahme. Wird beim Export zu <code>projekt.json</code> für das Forststraßen-Werkzeug.</p>
    <form class="blatt" onsubmit="return false">${ABSCHNITTE.map(([t, fs]) =>
      `<fieldset><legend>${esc(t)}</legend><div class="gitter">${fs.map(feld).join("")}</div></fieldset>`).join("")}</form>`;
  const speichern = entprellt(() => geaendert("blatt"), 400);
  panel.querySelector("form").addEventListener("input", e => {
    const el = e.target, k = el.dataset.k; if (!k) return;
    if (el.type === "checkbox") B()[k] = $$(`input[data-k="${k}"]:checked`, panel).map(x => x.value);
    else B()[k] = el.value;
    if (k === "ln_max" && el.value) app.projekt.weg.laengsneigung_max = parseFloat(el.value.replace(",", ".")) / 100;
    if (k === "planum" && el.value) app.projekt.weg.planum_m = parseFloat(el.value.replace(",", "."));
    speichern();
  });
}
