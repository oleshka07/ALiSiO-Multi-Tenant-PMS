# Verfahrensdokumentation nach GoBD — ALiSiO ERP (Kassenmodul)

> Vorlage für den Hotelbetrieb. Die mit `[…]` gekennzeichneten Stellen füllt
> das Hotel mit seinen eigenen Angaben aus (Name, Steuernummer, Seriennummern,
> Verantwortliche). Kundendaten gehören nicht in dieses Repository — das ist
> eine bewusste Regel des Projekts (`scripts/check-no-tenant-names.mjs`).
>
> Rechtsgrundlagen: GoBD (BMF-Schreiben v. 28.11.2019), § 146a AO,
> KassenSichV, DSFinV-K. Технічне тло українською: docs/TSE-KASSENSICHV.md.

## 1. Allgemeine Beschreibung

Betrieb: **[Hotelname, Rechtsform, Anschrift, Steuernummer]**
Verantwortlich für das Verfahren: **[Name, Funktion]**

Eingesetztes System: **ALiSiO ERP** — ein Property-Management-System mit
integriertem Kassenmodul. Das System erfasst Reservierungen, Leistungen
(Übernachtung, Frühstück, Veranstaltungsräume), erstellt Rechnungen nach
§ 14 UStG und zeichnet Zahlungen auf. Bargeld und Kartenzahlungen am Empfang
werden als Kassenvorgänge behandelt und durch eine zertifizierte technische
Sicherheitseinrichtung (TSE) signiert; Banküberweisungen sind keine
Kassenvorgänge.

TSE: **fiskaly SIGN DE (Cloud-TSE), BSI-zertifiziert** —
TSS-ID: **[…]**, Client-ID: **[…]**, Seriennummer des
Aufzeichnungssystems: **[…]** (identisch mit der Angabe in der
ELSTER-Kassenmeldung).

## 2. Anwenderdokumentation (Ablauf am Empfang)

1. Der Gast erhält seine Rechnung (fortlaufende Nummer je Organisation,
   Rechnungskreis mit Periodensperre).
2. Die Zahlung wird im Folio erfasst: Zahlart `Bargeld`,
   `Kartenzahlung am Terminal`, `Überweisung` oder `Gutschein`.
3. Bei Bargeld und Kartenzahlung wird die Transaktion VOR dem Speichern von
   der TSE signiert; der Beleg druckt die Angaben nach § 6 KassenSichV in
   Textform **und** als QR-Code.
4. Ist die TSE nicht erreichbar, wird der Checkout **nicht** blockiert: der
   Beleg trägt den Hinweis „TSE-Signatur nicht verfügbar:
   Sicherungseinrichtung ausgefallen", der Ausfall wird mit Beginn und Ende
   im Ausfalljournal festgehalten, und die Rezeption sieht die Liste der
   nicht signierten Vorgänge.
5. Am Tagesende wird der Kassenabschluss erstellt (ein Datensatz je Haus und
   Tag, fortlaufende Abschlussnummer). Ein zweiter Abschluss für denselben
   Tag wird vom System abgewiesen.
6. Korrekturen: eine Rechnung wird nie geändert oder gelöscht, sondern durch
   eine Stornorechnung neutralisiert; eine Zahlung wird nie gelöscht,
   sondern durch eine Gegenbuchung mit umgekehrtem Vorzeichen korrigiert.

## 3. Technische Systemdokumentation

- Architekturbeschreibung: `docs/ARCHITECTURE.md` (Schichten, Module,
  Mandantentrennung). Datenbank: PostgreSQL mit Row-Level-Security —
  jede Zeile trägt ihre Organisation; ein Mandant kann Daten eines anderen
  weder lesen noch ändern (laufend bewiesen durch `check-isolation.mjs`).
- Unveränderbarkeit: Rechnungszeilen und Steuerbeträge werden beim
  Ausstellen eingefroren (`fin_invoice_lines`, `fin_invoice_tax_totals`);
  der Steuersatz steht als Zahl auf der Zeile und ändert sich mit keiner
  späteren Satzänderung. Storno verweist auf das Original.
- Kassenvorgänge: `fin_folio_payments` (Zahlart, Betrag mit Vorzeichen,
  Zeitpunkt, erfassender Benutzer aus der Session, TSE-Felder).
  Kassenabschlüsse: `fin_cash_closings`. TSE-Ausfälle:
  `fin_fiscal_outages`. TSE-Zuordnung je Haus: `fin_fiscal_settings`.
- Schnittstelle zur TSE: `FiscalDevice` (Start → Finish → Signatur),
  Implementierung fiskaly SIGN DE API v2. Zugangsdaten liegen verschlüsselt
  je Organisation (`channel_credentials`), nie im Quellcode.
- Sicherung gegen Betrieb ohne TSE: solange das Fiskalmodul einer deutschen
  Organisation nicht aktiviert ist, verweigert das System die Erfassung von
  Bargeld- und Terminalzahlungen — das PMS kann nicht unbemerkt zur nicht
  registrierten Kasse werden.

## 4. Betriebsdokumentation

- Betriebsumgebungen, Deployment und Rollback: `docs/DEPLOY.md`.
- Datensicherung: **[Turnus und Aufbewahrungsort der Backups eintragen —
  Grundlage in docs/DEPLOY.md]**.
- Softwareänderungen: jede Änderung als Git-Commit mit Begründung;
  automatische Prüfketten (Typen, Selbsttests, Schema-Abgleich,
  Mandantentrennung) laufen vor jeder Auslieferung (CI).

## 5. Internes Kontrollsystem

- Rollen und Berechtigungen je Benutzer (`docs/ARCHITECTURE.md`, Abschnitt
  «Особа запиту»): Zahlungen und Abschlüsse erfordern das Recht
  `manage_documents`; der erfassende Benutzer wird aus der Session
  übernommen, nie vom Client behauptet.
- Vier-Augen-Prinzip organisatorisch: **[Regelung des Hotels eintragen]**.
- Jede Schutzvorkehrung im Code ist durch einen automatischen Test belegt,
  der bei ihrer Entfernung fehlschlägt (Projektregel: Beweis durch
  Wiedereinführung des Fehlers).

## 6. Aufbewahrung und Datenzugriff

- Rechnungen, Zahlungen, Kassenabschlüsse, TSE-Daten und Ausfalljournal
  verbleiben unverändert im System; Aufbewahrungsfrist 10 Jahre (§ 147 AO).
- Kassenjournal-Export (CSV mit den § 6-Feldern je Vorgang):
  `/api/finance/cash-closings/export`. DSFinV-K-Export für die
  Außenprüfung: **[Weg festlegen — fiskaly DSFINVK DE oder eigene
  Generierung; Stand siehe docs/TSE-KASSENSICHV.md, Block D]**.
- Meldescheine: Aufbewahrung ein Jahr ab Abreise, Vernichtung binnen drei
  Monaten danach (`guests/domain/retention`).

---

Stand: 2026-08-21. Dieses Dokument beschreibt den umgesetzten Zustand der
Blöcke A–D aus docs/TSE-KASSENSICHV.md §6.4 und wird mit jeder Änderung am
Kassenmodul fortgeschrieben.
