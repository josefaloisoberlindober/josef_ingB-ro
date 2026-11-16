# Forststraße – Vorplanung und Feldaufnahme (Web-App)

Eine App für Mac und iPad, gleiche Daten, kein App Store.

| Modus | wo | was |
|---|---|---|
| **Planen** | Mac | Varianten zeichnen, **Nulllinie** mit fester Steigung (schenkelweise, Kehren selbst setzen), Längs- und Querneigung aus dem DGM, Längsprofil, **Trasse anpassen** (Knoten automatisch in die Neigungsgrenzen schieben), **Trassenvorschlag** (Start, Zwischenziele = Erschließungsbereiche und Ziel anklicken → automatische Linie nach den Grenzwerten) |
| **Aufnehmen** | iPad | GPS-Punkte (gemittelt), Codes und Attribute wie Formular Blatt 2/3, Fotos, Doppelmessung a/b, Hinweise (Punkt fällig, Querneigung fällig, Abstand zur Planung) |
| **Projektblatt** | beide | Blatt 1 (A–E) → `projekt.json` |
| **Daten** | beide | Projekte, Export/Import (ZIP), Offline-Karte, Einstellungen |

## Ablauf
1. Mac: Projekt anlegen, Varianten planen → **Daten → Projekt exportieren** (ZIP).
2. ZIP per AirDrop aufs iPad → in der App **Importieren**. Im WLAN **Offline speichern** (Projektgebiet).
3. Im Wald aufnehmen. Danach exportieren → AirDrop an den Mac.
4. Im ZIP liegen `trasse.csv` (SW-Maps-Format) und `projekt.json` → weiter mit `01_aufbereitung.py` usw.
   Auf dem Mac in der App wieder importieren, um Aufnahme und Planung zu vergleichen.

## Grundlagen
- Karten: basemap.at (Grundkarte, grau, Orthofoto, Schummerung).
- Höhen/Höhenlinien: AWS Terrain Tiles, für Österreich aus dem DGM 10 m. Für die Vorplanung gut, für die Kubatur weiter DGM 1 m (DORIS) verwenden.
- Koordinaten intern GK M31 (EPSG:31255, 7-Parameter). Die DORIS-Korrektur wird nur in `projekt.json` eingetragen.
- Daten liegen nur im Browser des Geräts (IndexedDB). **Regelmäßig exportieren** – das ZIP ist die Sicherung.

## Lokal starten (Mac)
```
ruby -run -e httpd forststrasse-app -p 8642 -b 127.0.0.1
```
dann http://localhost:8642 öffnen.

## Aufs iPad
Das iPad braucht die App über **https** (sonst kein GPS). Dazu die Dateien dieses Ordners auf einen
Webspace legen, z. B. GitHub Pages. Dann in Safari öffnen → Teilen → **Zum Home-Bildschirm**.

Hinweis: Nur iPads mit **Mobilfunk (Cellular)** haben einen GPS-Empfänger. WLAN-iPads orten nur über WLAN – im Wald unbrauchbar.
RTK (ArduSimple): Safari kann keine Bluetooth-Empfänger direkt ansprechen. Bis dahin Punkte mit SW Maps aufnehmen und die CSV hier importieren.
