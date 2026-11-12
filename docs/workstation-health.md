# Arbeitsplatzübersicht und zentrale EDV-Mitteilungen

EDV Tools → Erweitert zeigt nach dem Entsperren unter „Mein Arbeitsplatz“ Konto, Outlook-Konfiguration,
Synchronisierung, Version und Berichtsversand. Die Übersicht wird beim Öffnen,
nach gemeldeten Vorgängen und alle fünf Minuten bei sichtbarer App abgefragt.
„Aktualisieren“ fragt sofort ab. Profile, Postfächer und PST/OST werden nur bei
Anforderung geladen. Eine gespeicherte Konfiguration belegt keine Online-Verbindung.
Office-Identitäten belegen nicht die aktuell in Excel aktive Identität.

„Vorprüfung“ liest Installation, Outlook-Prozess und freien Platz und prüft die
Erreichbarkeit von Microsoft-Anmeldung, Graph, Exchange Online und Berichtsserver.
Sie führt keine Anmeldung aus, öffnet Outlook nicht und verändert keine Profile.
HTTP 401/403 bei einem Dienst kann Erreichbarkeit bestätigen, aber keine Berechtigung.
Es gibt keinen pauschalen Speicher-Grenzwert: der Bedarf hängt vom Postfach ab.

Verfahren werden ab dieser Version auf dem Windows-PC aufgezeichnet, auch ohne
konfigurierten Berichtsversand. Maximal 500 Ereignisse bleiben im lokalen Verlauf.
Ältere Installationen liefern keine nachträglichen Erfolgsnachweise. Ohne bestätigten
Abschluss bleibt das Ergebnis unbekannt. Die konfigurierte Versandwarteschlange
bleibt getrennt erhalten und wird alle 60 Sekunden sowie bei Wiederverbindung
weitergeleitet. Nur bestätigte Serverannahmen entfernen einen Eintrag.

„Diagnose senden“ zeigt vor dem Versand die Zusammenfassung. Bei eingerichtetem
PC-Zugang wird der Bericht in derselben dauerhaften Warteschlange gespeichert.
Ohne Zugang kann eine JSON-Datei gespeichert werden. Kennwörter, Tokens,
Mailinhalte und Unterschriften gehören nicht in die Diagnose. Das Webportal muss
mit dem neuen Vorgangstyp `diagnostics` veröffentlicht werden, bevor solche
Berichte dort angenommen werden. Die Datei kann bis dahin lokal gespeichert werden.

## Zentrale Mitteilungen ohne neue App-Version

Im Repository `Diakonissenmutterhaus/DMHKontaktApp` auf dem Branch `feature-flags`
die Datei `edv-news.json` erstellen. Die Vorlage liegt neben dieser Dokumentation.
Nur veröffentlichen, wenn der Administrator dies ausdrücklich beauftragt.
Die App liest die Datei beim Öffnen und anschließend alle 15 Minuten, solange die
EDV-Ansicht sichtbar ist. Der letzte gültige Stand bleibt bei Netzfehlern erhalten.
Die Nachricht erscheint ab `publishAt` und verschwindet ab `expiresAt`.
Zeitangaben müssen Zeitzone enthalten; für Deutschland z.B. `+01:00` im Winter.
Maximal 30 Nachrichten, nur Klartext, keine HTML- oder Skriptinhalte.
Die Datei ist öffentlich: keine personenbezogenen oder vertraulichen Angaben.
Keine automatische Öffnung von Links, keine ausführbaren Aktionen.

Die KI-Nachweise sind weiterhin auf diesen PC bzw. Windows-Benutzer gebunden.
Eine neue Richtlinienrevision oder ein anderes PDF erfordert eine neue Bestätigung.
Vorhandene Nachweise werden unverändert aufbewahrt.

## Lokale Entwicklung

`npm run dev` startet die Browser-Vorschau unter http://127.0.0.1:4000/.
PC-, Office- und Outlook-Abfragen stehen nur in der Tauri-Windows-App zur Verfügung.
`npm run tauri:dev` startet die native Entwicklung mit derselben lokalen Oberfläche.
Die Browser-Vorschau zeigt keine erfundenen PC-Daten.

Für reguläre Benutzer bleibt das gesamte Arbeitsplatzpanel ausgeblendet. Es wird
auf der Startseite nicht eingebunden und startet dort keine PC-/Outlook-Abfragen.
