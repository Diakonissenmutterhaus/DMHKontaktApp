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
vollständige App-Captures werden in `migration-media.js` eingetragen. Der Film
der vorherigen Backup-/Importetappe wird dafür nicht wiederverwendet.

## Zugriff und Inbetriebnahme

Der lokal vorbereitete Login verwendet den Benutzernamen `edv` und die vom
Administrator festgelegte, nicht im Quellcode gespeicherte Passwortkonfiguration.
`website/.env.local` enthält `EDV_USERNAME`, einen gesalzenen scrypt-Hash unter
`EDV_PASSWORD_HASH` und einen separaten `EDV_SESSION_SECRET`. Die Datei ist von
Git und Deployments ausgeschlossen. Die Anmeldung per Zugangscode wird ersetzt.
Diese Änderung ist nur lokal vorbereitet; sie wurde nicht in Vercel veröffentlicht.
Sitzungen laufen nach acht Stunden ab; Cookies sind
HttpOnly, Secure und SameSite=Strict. POST-Anfragen der Verwaltung prüfen den Ursprung.

Im Portal unter **PC-Zugänge** pro PC eine Konfigurationsdatei herunterladen.
In einer App-Version mit Berichtsfunktion: **EDV Tools → Erweitert →
Verfahrensberichte → PC-Zugang importieren**. Die Datei enthält nur einen
widerrufbaren Schreibzugang für diesen PC. Sie muss vertraulich verteilt werden.
Windows DPAPI schützt den Zugang im Benutzerprofil. Er gehört nicht in Git,
mobile Backups oder öffentliche Download-Verzeichnisse.

Die offizielle App 0.1.37 enthält die Berichtsfunktion noch nicht. Die Änderungen
am App-Client benötigen eine ausdrücklich beauftragte neue Release.
Das Webportal allein kann alten App-Versionen keine Berichtsfunktion nachrüsten.

## Inhalt und Ablauf

Erfasst werden ausdrücklich gestartete Microsoft-365-Anmeldungen und
Outlook-Exchange-Einrichtungen, einschließlich Office-Kontoprüfung, Fehler,
Abbruch und Zeitüberschreitung. Erfolg bei M365 bedeutet bestätigte Anmeldung,
nicht zwingend vollständige Kontakte-/Kalendersynchronisierung. Exchange-Erfolg
wird erst nach nativer Abschlussbestätigung und Aktualisierung der Profilansicht gemeldet.

Ohne konfigurierten PC-Zugang werden keine Berichte gespeichert oder hochgeladen.
Nach Einrichtung schreibt die App zuerst in eine SQLite-Outbox; Versand erfolgt
unabhängig vom M365-Login. Ein Bericht wird erst nach bestätigtem Empfang entfernt.
Bei fehlender Verbindung wird ungefähr jede Minute und beim Online-Ereignis erneut
versucht. Event-ID und Sequenz verhindern doppelte Ergebnisse nach Wiederholungen.

Das Portal zeigt standardmäßig den letzten Versuch je Windows-Benutzer, PC und
Vorgang. „Alle Versuche“ bewahrt frühere Fehler. Excel enthält Übersicht,
Versuche und Versuchsverlauf. Ein fehlender Abschluss ist unbekannt, kein Erfolg.
Ein nach einem Absturz übrig gebliebener Start kann daher weiterhin „In Bearbeitung“
anzeigen. Kontonamen sind vom PC gemeldete Angaben, keine unabhängige Identitätsprüfung.
Ohne Mitarbeiter-Soll-Liste kann nicht festgestellt werden, wer noch nie begonnen hat.

Speicherung: privater Vercel-Blob-Store in Frankfurt. Daten und Exporte benötigen
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
