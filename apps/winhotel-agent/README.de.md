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

3. `install.ps1` legt die geplante Aufgabe **„ALiSiO Winhotel-Agent“** an (täglich
   03:00 Uhr) und speichert das Token in `agent.token`. Diese Datei ist nur für
   Administratoren und SYSTEM lesbar — bitte so lassen.

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

## Was der Agent nicht tut

- Er ändert oder löscht nichts im Winhotel-Ordner.
- Er schreibt das Token und Passwörter nicht ins Protokoll.
- Er liest die Datenbank nicht über das Netz — nur eine Sicherung bzw. Kopie.

## Deinstallation

```powershell
Unregister-ScheduledTask -TaskName "ALiSiO Winhotel-Agent" -Confirm:$false
Remove-Item C:\ALiSiO\winhotel-agent -Recurse
```
