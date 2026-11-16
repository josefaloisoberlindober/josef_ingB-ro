// Planungsstandards für Forststraßen – Kennwerte für Vorplanung, Trassenvorschlag und Bewertung.
// Quelle: DI Clemens Neuber, „Planungsstandards für Forststraßenprojekte“
// (Forstliche Staatsprüfung 2021, Ausbildungsmodul „Kerngeschäft HOLZ“), sowie Einführung Erschließung,
// Institut für Forsttechnik, BOKU (2024), Stampfer „Linienführung, Querschnittgestaltung und Trassieren“ und
// Malle/Witzmann/Stampfer „Generalprojekt“ (BOKU 2020). Grundsatz: § 60 ForstG – Maßhaltigkeitsgebot: in den Wald nur so
// weit eingreifen, als es die Erschließung erfordert → Massen-, Längen- und Kehrenminimierung.

/** Erdmassen je lfm [m³] nach Querneigung des Geländes (Massenentwicklung progressiv) */
const MASSEN = [[0, 2.5], [0.1, 2.6], [0.2, 2.6], [0.3, 3.0], [0.4, 4.2], [0.5, 5.8], [0.6, 7.9], [0.7, 10.3],
  [0.8, 12.9], [0.9, 15.7], [1.0, 18.8], [1.1, 22.6], [1.2, 27.4]];
/** Massen je Kehre [m³] nach Querneigung (Sprungkosten durch Kehren) */
const KEHRE = [[0, 60], [0.2, 100], [0.3, 160], [0.4, 290], [0.5, 520], [0.6, 920], [0.7, 1650]];

export const STANDARD = {
  laengsOptMin: 0.05, laengsOptMax: 0.10,   // optimal 5–10 %; Abweichungen > 2 % davon sind zu begründen
  wechselVisur: 30,                           // Gefällsdifferenzen nicht über 3 % bei optimaler Visurlänge 30 m (Stampfer, BOKU)
  kehreNeigungMax: 0.06,                      // Kehren max. 6 % Längsneigung (Generalprojekt, BOKU)
  kehreWinkel: 160 / 200 * Math.PI,           // Kehre = Zentriwinkel > 160 gon
  kehreRadius: 10,                            // Kehrenradius 10 m (15 m)
  querausgleichBis: 0.70,                     // bis ca. 70 % Querausgleich (Baggerbauweise), darüber Längsausgleich
  euroQuer: 2.1,                              // Querausgleich 1,8–2,4 €/m³
  euroLaengsZuschlag: 3.0,                    // ab 70 %: Laden, Abtransport, Kippen, Einbringen min. 3 €/m³
  schotterM3: 1.25, euroSchotter: 15,         // Schotterbedarf 1–1,5 m³/lfm, Schottermaterial 15 €/m³
  kurveRaMin: 9.75,                           // Außenradius min. 9,75 m (Wendekreis LKW-Zug ≈ 20 m)
  vertikalRMin: 30,                           // Vertikalradius min. 30 m (Wannen)
  rdlHoehe: 7, rdlAbstand: 100,               // Rohrdurchlass DN400 alle 7 Höhenmeter, max. 100 lfm
  profile: {                                  // Regelprofile (Fahrbahn / Planum ohne bzw. mit Graben) [m]
    F1: { name: "F1 – geringe Verkehrsbedeutung (Stichweg)", fahrbahn: 3.5, planum: 4.1, planumGraben: 4.6 },
    F2: { name: "F2 – Standard LKW-befahrbar", fahrbahn: 4.0, planum: 5.0, planumGraben: 5.5 },
  },
};

const interp = (tab, x) => {
  if (!isFinite(x)) return tab[0][1];
  x = Math.max(0, x);
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  const [x0, y0] = tab[tab.length - 2], [x1, y1] = tab[tab.length - 1];   // darüber linear weiter
  return y1 + (y1 - y0) * (x - x1) / (x1 - x0);
};

/** Erdmassen je lfm [m³] bei Querneigung q (0,7 = 70 %) */
export const massenJeLfm = q => interp(MASSEN, q);
/** Erdmassen einer Kehre [m³] bei Querneigung q */
export const kehrenMassen = q => interp(KEHRE, Math.min(q, 1.0));
/** Kosten Erdbau je m³ bei Querneigung q [€] – ab 70 % Längsausgleich */
export const euroJeM3 = q => STANDARD.euroQuer + (q > STANDARD.querausgleichBis ? STANDARD.euroLaengsZuschlag : 0);
/** Baukosten je lfm (Erdbau + Schotter) [€] */
export const euroJeLfm = q => massenJeLfm(q) * euroJeM3(q) + STANDARD.schotterM3 * STANDARD.euroSchotter;
/** Baukosten einer Kehre (nur Erdbau-Mehrmassen) [€] */
export const euroKehre = q => kehrenMassen(q) * euroJeM3(q);
/** günstigste Kosten je lfm – Untergrenze für die Suche */
export const EURO_MIN_LFM = euroJeLfm(0);
