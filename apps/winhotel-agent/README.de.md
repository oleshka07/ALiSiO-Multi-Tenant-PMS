# ALiSiO Winhotel-Agent

Kleines PowerShell-Skript für den Winhotel-Server. Es erstellt jede Nacht einen
Schnappschuss der Winhotel.MX-Datenbank (Firebird 3) und lädt ihn verschlüsselt
(HTTPS) zu ALiSiO hoch. ALiSiO liest die Kopie — **die laufende Winhotel-Datenbank
wird nie über das Netz gelesen, und im Winhotel-Ordner wird nichts verändert.**

## Was Sie brauchen

- Windows-Server, auf dem Winhotel.MX und Firebird 3 laufen; PowerShell 5.1 oder neuer.
- Administrator-Rechte für die Einrichtung.
- Das **Agent-Token** aus ALiSiO: Einstellungen → Apps → Karte „Import aus Winhotel“ →
  „Token erstellen“. Das Token wird nur einmal angezeigt. Ein neues Token macht das
  alte ungültig.
- Die ALiSiO-Adresse, z. B. `https://pms.example.com`.

## Einrichtung (einmalig)

1. Diesen Ordner nach `C:\ALiSiO\winhotel-agent\` kopieren.
2. PowerShell **als Administrator** öffnen und ausführen:

   ```powershell
   cd C:\ALiSiO\winhotel-agent
   .\install.ps1 -AlisioUrl https://pms.example.com -Token <Token> -BackupDir D:\Winhotel\Backup
   ```

   `-BackupDir` ist der Ordner, in den Winhotel selbst seine `.fbk`-Sicherungen
   schreibt (falls vorhanden). `-Database` nur angeben, wenn die Datenbank nicht unter
   `C:\winhotelmx\daten\winhotel.fdb` liegt. `-Password` nur, wenn das SYSDBA-Passwort
   weder `masterkey` ist noch in `SYSDBA.password` im Firebird-Ordner steht.

3. `install.ps1` legt zwei geplante Aufgaben an — **„ALiSiO Winhotel-Agent“**
   (Schnappschuss, täglich 03:00 Uhr) und **„ALiSiO Winhotel-Delta“** (Tagesdelta,
   alle 15 Minuten; `-NoDelta` lässt sie weg, `-DeltaMinutes` ändert den Takt) — und
   speichert das Token in `agent.token`. Diese Datei ist nur für Administratoren und
   SYSTEM lesbar — bitte so lassen. Das Tagesdelta braucht `isql.exe` aus dem
   Firebird-Ordner (liegt neben `gbak.exe`).

4. Sofort testen:

   ```powershell
   Start-ScheduledTask -TaskName "ALiSiO Winhotel-Agent"
   Get-Content .\winhotel-agent.log -Tail 20
   ```

   Die letzte Zeile muss `Fertig.` sein; in ALiSiO erscheint der Schnappschuss auf der
   Karte „Import aus Winhotel“.

## Wie der Schnappschuss entsteht

Der Agent probiert drei Wege, in dieser Reihenfolge, und schreibt ins Protokoll,
welcher gegriffen hat:

| Modus | Wann | Was passiert |
|---|---|---|
| **(a) Backup** | in `-BackupDir` liegt ein `.fbk`, jünger als 24 h | die Datei wird kopiert — Winhotel läuft ungestört |
| **(b) gbak** | `gbak.exe` gefunden und ein SYSDBA-Passwort passt | `gbak -b` erstellt eine Sicherung über den Firebird-Server; Winhotel kann laufen |
| **(c) Kopie** | Winhotel **und** Firebird sind geschlossen | `winhotel.fdb` wird kopiert; ist die Datei in Benutzung, bricht der Agent hier ab |

Danach: gzip, SHA-256, Upload (bis zu 3 Versuche). Temporäre Dateien werden gelöscht.

## Tagesdelta (alle 15 Minuten)

Der Selbstbedienungs-Terminal (Kiosk) in ALiSiO muss die Buchungen **des Tages**
sehen, nicht den Stand von 03:00 Uhr. Deshalb liest der Agent mit `-Mode Delta`
alle 15 Minuten per `isql.exe` **nur die Buchungen mit An- oder Abreise im Fenster
gestern … +3 Tage** (Buchungen, Belegung, Adressen dieser Buchungen, ihre
Buchungszeilen und Zahlungen; dazu die kleinen Stammdaten) und sendet den
rohen Text als ein gzip-Paket (`X-Winhotel-Mode: delta`, `X-Winhotel-Window`).
Die Datenbank wird dabei nur gelesen — keine Sicherung, keine Kopie, kein
Schreiben. ALiSiO aktualisiert damit **nur** die Buchungen aus dem Fenster und
storniert nichts, was im Delta fehlt. Die Regel „ein Schnappschuss pro Tag“ gilt
für das Delta nicht.

Die SQL-Vorlagen liegen in `sql-delta\` (Platzhalter `{{FROM}}`/`{{TO}}`); sie
haben dieselben Spalten wie die Abfragen der Brücke und werden dort geprüft.

## Wenn etwas rot ist

Die geplante Aufgabe zeigt einen Fehlercode ≠ 0. Ursache steht in `winhotel-agent.log`:

| Zeile im Protokoll | Bedeutung |
|---|---|
| `Kein Token` | `agent.token` fehlt oder ist leer — `install.ps1` erneut ausführen |
| `Upload … (401)` | Token unbekannt — in ALiSiO ein neues erstellen und `install.ps1` erneut ausführen |
| `Upload … (404)` | die App „Import aus Winhotel“ ist in ALiSiO ausgeschaltet |
| `Upload … (400) Kontrollsumme` | Datei unterwegs beschädigt — der nächste Lauf sendet neu |
| `Upload … (409)` | für heute wurde schon ein Schnappschuss angenommen — morgen wieder |
| `Kein Schnappschuss möglich` | kein frisches Backup, gbak ohne Passwort, Datei in Benutzung — Backup-Ordner oder `-Password` angeben |
| `isql.exe nicht gefunden` | Tagesdelta: `-FirebirdDir` in der Delta-Aufgabe angeben |
| `Delta: isql konnte die Datenbank nicht lesen` | Firebird-Dienst läuft nicht oder Passwort passt nicht — `-Password` angeben |
| `Upload … (400) … X-Winhotel-Window` | Delta ohne Datumsfenster — Skript veraltet, Ordner neu kopieren |

## Was der Agent nicht tut

- Er ändert oder löscht nichts im Winhotel-Ordner.
- Er schreibt das Token und Passwörter nicht ins Protokoll.
- Er liest die Datenbank nicht über das Netz — nur eine Sicherung bzw. Kopie; das
  Tagesdelta liest lokal über den Firebird-Dienst und nur die Buchungen des Fensters.

## Deinstallation

```powershell
Unregister-ScheduledTask -TaskName "ALiSiO Winhotel-Agent" -Confirm:$false
Unregister-ScheduledTask -TaskName "ALiSiO Winhotel-Delta" -Confirm:$false
Remove-Item C:\ALiSiO\winhotel-agent -Recurse
```
