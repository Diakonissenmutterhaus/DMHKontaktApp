# Verfahrensberichte für die EDV

Öffentliche Anleitung: https://migration.dmh-aidlingen.de/.
EDV-Berichte mit Anmeldung: https://migration.dmh-aidlingen.de/login.
Vercel-Projekt: `dmh-migration`.
Der bestehende Anleitungssite `dmh-backup` bleibt getrennt. Das Portal wird aus
`website` mit `REPORTING_SITE_ONLY=1` gebaut. Die öffentliche Startseite zeigt
das Video und darunter die Anleitung für Microsoft 365 und Exchange, ohne Link
zur Anmeldung oder Verwaltung. Die Anmeldung ist nur direkt unter `/login` erreichbar;
alte HTML-Adressen unter `/edv/` leiten dorthin um. CSS und JavaScript des Panels
liegen weiterhin unter `/edv/` und enthalten keine Zugangsdaten.
Die Quelldateien der Startseite liegen unter `website/migration`. Video und echte
vollständige App-Captures werden in `migration-media.js` eingetragen. Auf ausdrücklichen Wunsch der EDV wird vorübergehend der Film der bisherigen Backup-/Importetappe wiederverwendet. Die Seite kennzeichnet dies; die Exchange-Anleitung steht darunter. `temporaryVideo` nach Einfügen der neuen Aufnahme entfernen.

## Zugriff und Inbetriebnahme

Der lokal vorbereitete Login verwendet den Benutzernamen `edv` und die vom
Administrator festgelegte, nicht im Quellcode gespeicherte Passwortkonfiguration.
`website/.env.local` enthält `EDV_USERNAME`, einen gesalzenen scrypt-Hash unter
`EDV_PASSWORD_HASH` und einen separaten `EDV_SESSION_SECRET`. Die Datei ist von
Git und Deployments ausgeschlossen. Die Anmeldung per Zugangscode wird ersetzt.
Die Anmeldung ist im Projekt dmh-migration eingerichtet. Zugangsdaten werden ausschließlich über die Server-Umgebung konfiguriert.
Sitzungen laufen nach acht Stunden ab; Cookies sind
HttpOnly, Secure und SameSite=Strict. POST-Anfragen der Verwaltung prüfen den Ursprung.

Aktuelle App-Versionen registrieren sich automatisch beim Portal. Keine Konfigurationsdatei und keine Freischaltung pro PC erforderlich. Windows DPAPI schützt den individuellen Schreibzugang im Windows-Benutzerprofil. Der Zugang erlaubt keine Abfrage von Berichten oder administrativen Aktionen. Automatische Registrierungen erscheinen unter **PC-Zugänge**, wo sie gesperrt werden können. Angaben zu Computer und Benutzer sind App-Meldungen, keine bestätigte Microsoft-Identität. Die Selbstregistrierung verwendet einen kurzlebigen signierten SHA-256-Rechennachweis (18 Bit), um Masseneinträge zu erschweren. Bereits vorhandene manuelle Zugänge bleiben unterstützt; die manuelle Erstellung ist im Portal unter einer erweiterten Option verfügbar.

Zuerst die neue Portal/API-Version bereitstellen, anschließend die neue App-Version verteilen. Alle PCs müssen diese App-Version einmal erhalten. Ein Website-Deploy allein ändert bereits installierte Programme nicht.

Die Berichtsfunktion wird mit der offiziellen Version 0.1.38 eingeführt. Version 0.1.37 und ältere enthalten sie noch nicht.
Das Webportal allein kann alten App-Versionen keine Berichtsfunktion nachrüsten.

## Inhalt und Ablauf

Erfasst werden ausdrücklich gestartete Microsoft-365-Anmeldungen und
Outlook-Exchange-Einrichtungen, einschließlich Office-Kontoprüfung, Fehler,
Abbruch und Zeitüberschreitung. Erfolg bei M365 bedeutet bestätigte Anmeldung,
nicht zwingend vollständige Kontakte-/Kalendersynchronisierung. Exchange-Erfolg
wird erst nach nativer Abschlussbestätigung und Aktualisierung der Profilansicht gemeldet.

Die App schreibt immer zuerst in eine SQLite-Outbox, auch vor Registrierung und ohne Internet; Versand erfolgt
unabhängig vom M365-Login. Ein Bericht wird erst nach bestätigtem Empfang entfernt.
Bei fehlender Verbindung wird ungefähr jede Minute und beim Online-Ereignis erneut
versucht. Event-ID und Sequenz verhindern doppelte Ergebnisse nach Wiederholungen.
Beim Start übernimmt die App auch den bestehenden lokalen Verlauf (bis zu 500 noch gespeicherte Ereignisse) mit Originalzeitpunkt, Versuch und Fehlermeldung. Bestätigte Empfangsbelege verhindern erneutes Einreihen. Bereits gelöschte Ereignisse lassen sich nicht wiederherstellen; ungesendete Queue-Einträge werden vom Verlaufslimit nicht entfernt. Die Standardübersicht bewertet den Zeitpunkt des Versuchs, sodass nachgelieferte alte Fehler keinen neueren Erfolg ersetzen.

Das Portal zeigt standardmäßig den letzten Versuch je Windows-Benutzer, PC und
Vorgang. „Alle Versuche“ bewahrt frühere Fehler. Excel enthält Übersicht,
Versuche und Versuchsverlauf. Ein fehlender Abschluss ist unbekannt, kein Erfolg.
Ein nach einem Absturz übrig gebliebener Start kann daher weiterhin „In Bearbeitung“
anzeigen. Kontonamen sind vom PC gemeldete Angaben, keine unabhängige Identitätsprüfung.
Ohne Mitarbeiter-Soll-Liste kann nicht festgestellt werden, wer noch nie begonnen hat.

Speicherung: bislang privater Vercel-Blob-Store in Frankfurt; die lokal vorbereitete
Supabase-Umstellung ist unten beschrieben. Daten und Exporte benötigen
EDV-Anmeldung; ein PC-Zugang erlaubt nur das Senden eigener Berichte. Ein Zugang
kann über „Sperren“ widerrufen werden. Bekannte Kennwort-/Tokenmuster werden vor
dem lokalen Einreihen und erneut am Server entfernt. Gesendet werden keine
Microsoft-Zugangsdaten, Postfachinhalte oder Dokumente.

## Prüfung

`npm test --prefix website`: API-Zugriff, Sitzungen, Wiederholungen, XLSX und Statusauswahl.
`node scripts/test-procedure-reporting-site.mjs https://migration.dmh-aidlingen.de`:
Live-Test gegen Browser, API und privaten Speicher. Er erstellt klar bezeichnete
Testdaten und löscht ausschließlich diese eigenen Testeinträge wieder.
Die privaten Testzugänge liegen außerhalb des Repositorys auf dem Verwaltungs-PC.

## Supabase-Umstellung

Am 14.11.2026 wurde das separate kostenlose Projekt `dmh-migration` in der vom
Administrator ausgewählten `JuliusOttoOrganization` erstellt. Projekt-ID:
`ettaqdfjnxutylgoedgs`, Region Frankfurt (`eu-central-1`), API-URL:
`https://ettaqdfjnxutylgoedgs.supabase.co`. Die Migration
`create_private_dmh_reporting` wurde angewendet. Schreibzugriffe, Aggregation,
Versuchszahlen, Widerruf und Serverrechte wurden auf dem gehosteten PostgreSQL
innerhalb einer zurückgerollten Testtransaktion geprüft; Testdatensätze blieben
nicht gespeichert. Die bestehende serverseitige Secret API key wurde anschließend
direkt aus dem angemeldeten Dashboard in `website/.env.supabase.local` gespeichert,
ohne den Wert im Chat auszugeben. Ein echter REST-Test über den lokalen API-Handler
bestätigte PC-Zugang, Schreibzugriff, Duplikate, Sequenzkonflikte, nachgelieferte
Fehler, Versuchszahlen, Identifikation ohne E-Mail, die drei Excel-Blätter und
Widerruf. Seine drei Ereignisse und sein einzelner klar markierter Testzugang
wurden danach gezielt entfernt. Die Produktionsseite wurde noch nicht umgeschaltet.

Die Supabase-Sicherheitsprüfung meldet erwartete Hinweise
[`rls_enabled_no_policy`](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy):
Diese Tabellen haben absichtlich keine Freigabepolicies für `anon` oder
`authenticated`, und deren Tabellenrechte sind zusätzlich entzogen. Die
Serverrolle hat nur die benötigten Rechte. Keine öffentliche Freigabe hinzufügen,
um diesen informativen Hinweis zu unterdrücken.

Der neue Provider verwendet PostgreSQL statt einzelner Blob-Dateien. Das bestehende
`/api/edv`-Protokoll, EDV-Login, Geräte-IDs und Schreibzugänge bleiben erhalten.
Diese Speicherumstellung allein benötigt keine neue App-Version. Die laufende
Produktionsseite verwendet bis zu einer ausdrücklich freigegebenen Umstellung
weiterhin ihren bisherigen Provider.

1. Ein separates kostenloses Supabase-Projekt `dmh-migration` anlegen; Organisation
   ausdrücklich auswählen und die Region Frankfurt verwenden.
2. Vorhandene Tabellen prüfen, dann `website/server/supabase-schema.sql` anwenden.
   Die beiden Tabellen haben RLS; `anon`/`authenticated` erhalten weder Tabellen-
   noch Funktionszugriff. Nur die Serverrolle kann lesen und schreiben.
3. Für den Server `SUPABASE_URL` und `SUPABASE_SECRET_KEY` konfigurieren. Moderne
   `sb_secret_…`-Schlüssel bleiben ausschließlich auf dem Server. Die Vorlage
   `website/.env.supabase.example` enthält keine echten Zugangsdaten.
   Die tatsächliche lokale Konfiguration liegt in der ignorierten Datei
   `website/.env.supabase.local`; ihren Inhalt niemals im Chat oder Git speichern.
4. Den alten Blob-Store und seinen Token behalten. Mit dem privaten Server-Env:
   `node --env-file=PRIVATE_ENV_FILE scripts/import-procedure-reports-supabase.mjs`
   prüft zunächst ausschließlich lesend. Erst mit `--apply` werden fehlende
   Datensätze kopiert und nach jedem Schreiben zurückgelesen. Abweichende
   Zieldatensätze stoppen die Vorbereitung vor dem ersten Schreibzugriff.
   Widerrufene Zugänge, Event-IDs, Sequenzen und Originalzeitpunkte bleiben erhalten.
   Während des finalen Imports keine parallelen Änderungen am alten Portal zulassen.
5. Erst nach bestätigter Datenübernahme `REPORTING_STORAGE=supabase` setzen und
   die freigegebene Website bereitstellen. Die drei bestehenden EDV-Loginvariablen
   nicht ändern. Bei Supabase-Fehlern erfolgt kein stiller Wechsel zu Blob.
6. In der bereitgestellten Umgebung Registrierung, Wiederholung, Anmeldung,
   Berichte, Sperrung, Sortierung und Excel prüfen. Ein lokaler Test ersetzt diese
   Live-Prüfung nicht.

Die Supabase-Übersicht erhält einen konsistenten SQL-Snapshot mit dem letzten
Ereignis pro Versuch und den Versuchszahlen. Sie lädt keine einzelne Datei pro
Ereignis. Nur der vollständige Excel-Verlauf liest zusätzlich Rohereignisse.
Die sichtbare Administrationsseite aktualisiert automatisch alle zwei Minuten;
bei Fehlern wird bis auf 15 Minuten verzögert. Manuelle Aktualisierung bleibt
sofort verfügbar. Lesefehler werden niemals als leere erfolgreiche Datenabfrage
behandelt. Einträge oberhalb der Sicherheitsgrenze werden nicht still abgeschnitten.

Wichtig für den aktuellen Vorfall: Ein `403` des gesperrten Blob-Stores verhindert
auch den historischen Import. Neue Datenbanken können bereits bestätigte,
nur dort gespeicherte Meldungen nicht ohne Lesezugriff rekonstruieren. Nicht
bestätigte App-Meldungen bleiben in der lokalen Outbox und können nach der
Umstellung erneut gesendet werden. Die alte Datenquelle deshalb nicht löschen.

## Lokale Ergänzung: Anmeldung und Synchronisierungsfehler

Eine bestätigte Microsoft-365-Anmeldung wird unabhängig vom anschließenden Laden der Kontakte und Kalender als Erfolg gemeldet. Fehler bei dieser Synchronisierung gehören zu `m365_sync`, nicht zu `m365_login`. Fehler beim Windows-/Browser-/Code-Login und bei der Statusprüfung werden auch ohne ermittelte E-Mail-Adresse gespeichert. Computer und Windows-Benutzer ergänzt die native App unabhängig von Microsoft. Synchronisierungsfehler und bestätigte Wiederherstellung erscheinen als eigener Vorgang `m365_sync` im Portal und Excel. Hintergrundfehler werden nicht als technischer roter Hinweis im normalen M365-Card angezeigt; eine nicht abgeschlossene Benutzeraktion behält ihre kurze Handlungsanweisung.

Die Quellenauswahl wird an die aktuelle Microsoft-Konto-ID gebunden. Der alte globale Initialisierungsmarker allein genügt nicht mehr; bei der Migration werden Quellen erneut ermittelt. Eine fehlgeschlagene Abfrage überschreibt die gespeicherte Auswahl nicht, Warteschlangen werden nicht gelöscht und eine pausierte Konfiguration bleibt pausiert.

Die native Ausgangsqueue übernimmt zusätzlich den letzten in `synchronization_runtime_status_v1` gespeicherten Synchronisierungsfehler mit stabiler Ereignis-ID und Originalzeitpunkt. Fehlt eine lokale Fehleraufzeichnung vollständig, kann sie nicht rückwirkend rekonstruiert werden. WebView-Schreibfehler werden mit bereinigter Meldung und Originalzeitpunkt lokal für erneute native Übergabe aufbewahrt. Einzelne vom Server abgelehnte Datensätze bleiben erhalten, blockieren aber nicht alle nachfolgenden Berichte.

Diese Änderungen benötigen bei Veröffentlichung zuerst die aktualisierte Portal-API und anschließend eine neue App-Version. Eine lokale Codekorrektur verändert die bereits veröffentlichte Version nicht.


## EDV-Diagnoseprotokolle

Die normale App zeigt keine Diagnosefenster, Fehlercodes oder Protokoll-Schaltflächen mehr.
Nur eine vom nativen Ablauf bestätigte Exchange-Verbindung mit gespeichertem Standardprofil
führt zur Erfolgsmeldung. Ein unvollständiger Ablauf verweist knapp an die EDV.

Fehler in Anmeldung, Exchange-Einrichtung und Synchronisierung erzeugen im Diagnose-Build
einen bereinigten lokalen Snapshot. Nach dem sofort gespeicherten Ergebnis ergänzt eine
weitere Sequenz desselben Versuchs das Protokoll. Status, ursprünglicher Zeitpunkt und
Versuchszahl bleiben dabei unverändert. Die bestehende lokale Outbox übernimmt Wiederholungen;
Netzwerk- oder Diagnosefehler dürfen den ursprünglichen Vorgang nicht verändern.

Der Schreibzugang sendet an `action=ingest-diagnostic`. Diese separate Aktion und die
Bestätigung `diagnosticAccepted` verhindern, dass ein älterer Server ein Protokoll still
verwirft. Die neue Website muss vor der neuen App veröffentlicht werden. Ohne Bestätigung
bleibt das Protokoll in der Queue, normale Ergebnisberichte können weitergesendet werden.

Nur die angemeldete EDV kann über Eigenschaften → Protokoll laden den Text lesen, kopieren
oder als `.log` herunterladen. Tabellenantworten enthalten nur den Verfügbarkeitshinweis,
nicht den vollständigen Text. Die Daten bleiben im bestehenden privaten JSON-Payload;
keine zusätzlichen öffentlichen Datenbankrechte oder Schemaänderungen sind nötig.
Pro Protokoll werden höchstens 60.000 Zeichen übertragen; größere Protokolle sind als
gekürzt gekennzeichnet, die vollständige bereinigte Kopie bleibt lokal. Kennwörter, Tokens
und Zugangsdaten werden vor der Queue und nochmals serverseitig entfernt.
