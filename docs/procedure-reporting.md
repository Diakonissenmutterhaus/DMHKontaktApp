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

## Lokale Ergänzung: Anmeldung und Synchronisierungsfehler

Anmeldung wird erst nach Abschluss der nachfolgenden Einrichtung als Erfolg gemeldet. Fehler beim Windows-/Browser-/Code-Login, bei der Statusprüfung und bei der anschließenden Vorbereitung werden auch ohne ermittelte E-Mail-Adresse gespeichert. Computer und Windows-Benutzer ergänzt die native App unabhängig von Microsoft. Synchronisierungsfehler und bestätigte Wiederherstellung erscheinen als eigener Vorgang `m365_sync` im Portal und Excel. Hintergrundfehler werden nicht als technischer roter Hinweis im normalen M365-Card angezeigt; eine nicht abgeschlossene Benutzeraktion behält ihre kurze Handlungsanweisung.

Die Quellenauswahl wird an die aktuelle Microsoft-Konto-ID gebunden. Der alte globale Initialisierungsmarker allein genügt nicht mehr; bei der Migration werden Quellen erneut ermittelt. Eine fehlgeschlagene Abfrage überschreibt die gespeicherte Auswahl nicht, Warteschlangen werden nicht gelöscht und eine pausierte Konfiguration bleibt pausiert.

Die native Ausgangsqueue übernimmt zusätzlich den letzten in `synchronization_runtime_status_v1` gespeicherten Synchronisierungsfehler mit stabiler Ereignis-ID und Originalzeitpunkt. Fehlt eine lokale Fehleraufzeichnung vollständig, kann sie nicht rückwirkend rekonstruiert werden. WebView-Schreibfehler werden mit bereinigter Meldung und Originalzeitpunkt lokal für erneute native Übergabe aufbewahrt. Einzelne vom Server abgelehnte Datensätze bleiben erhalten, blockieren aber nicht alle nachfolgenden Berichte.

Diese Änderungen benötigen bei Veröffentlichung zuerst die aktualisierte Portal-API und anschließend eine neue App-Version. Eine lokale Codekorrektur verändert die bereits veröffentlichte Version nicht.
