# ALiSiO Kiosk Shell — Einrichtung am Terminal

Diese Erweiterung macht genau zwei Dinge und sonst nichts:

* auf fremden Seiten (z. B. der eigenen Onlinebuchung des Hauses) erscheint
  oben eine Leiste **„← Zurück zum Start“**;
* nach 60 Sekunden ohne Berührung kehrt der Bildschirm von selbst zum
  Kiosk-Start zurück — und löscht dabei Cookies und Speicher **nur** der
  fremden Seite, damit der nächste Gast kein halb ausgefülltes Formular des
  vorherigen sieht. Die Sitzung des Kiosks selbst bleibt erhalten.

Die Erweiterung liest keine Eingabefelder, sendet nichts ins Netz und kennt
keine Adresse ausser der, die Sie unten selbst eintragen.

## 1. Erweiterung installieren

1. Ordner `apps/kiosk-shell/` auf den Terminal-PC kopieren.
2. Chrome öffnen → `chrome://extensions` → **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** → den kopierten Ordner auswählen.
4. Bei der Erweiterung auf **Details → Erweiterungsoptionen** klicken und die
   Kiosk-Adresse eintragen, z. B. `https://<Ihr-Server>/kiosk`. Speichern.

Ohne diesen Schritt bleibt die Erweiterung stumm — das ist Absicht: eine
Leiste auf einer beliebigen Seite wäre schlimmer als keine.

## 2. Chrome im Kiosk-Modus starten

Verknüpfung auf dem Desktop anlegen, Ziel:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --touch-events=enabled --disable-pinch --overscroll-history-navigation=0 --noerrdialogs --disable-session-crashed-bubble --disable-infobars "https://<Ihr-Server>/kiosk"
```

* `--kiosk` — Vollbild ohne Adressleiste;
* `--touch-events=enabled` — Touch am 10-Punkt-Display;
* `--disable-pinch` — der Gast kann den Bildschirm nicht versehentlich
  zoomen, bis die Schaltflächen aus dem Bild wandern;
* `--overscroll-history-navigation=0` — Wischen nach rechts blättert nicht
  zurück;
* die letzten drei unterdrücken Chrome-Dialoge, die niemand wegklicken kann,
  weil im Foyer keine Tastatur steht.

## 3. Autostart

`Win + R` → `shell:startup` → die Verknüpfung aus Schritt 2 hineinkopieren.

## 4. Kein Standby, kein Bildschirmschoner

Einstellungen → System → Netzbetrieb und Energiesparen:

* Bildschirm ausschalten: **Nie**
* Energiesparmodus: **Nie**

Zusätzlich in `chrome://settings/system` „Fortsetzen der Ausführung von
Hintergrund-Apps“ aktiviert lassen.

## 5. Terminal koppeln

Beim ersten Start fragt der Bildschirm nach einem **sechsstelligen Code**.
Den Code erzeugt die Verwaltung: Apps → Kiosk → „Terminal hinzufügen“. Der
Code gilt 10 Minuten und nur einmal.

Geht das Terminal verloren oder wird getauscht: in derselben Karte
**„Widerrufen“** — das alte Gerät antwortet danach nicht mehr, sein Protokoll
des Tages bleibt erhalten.
