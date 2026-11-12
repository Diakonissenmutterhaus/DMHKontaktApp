# KI: Richtlinien und IT-Schulungen

Der Menüpunkt **KI** ist für alle Benutzer sichtbar. Ohne veröffentlichtes
Dokument bleiben Kenntnisnahme und Unterschrift gesperrt. Die bereitgestellte
**KI-Leitlinie, Stand 10.11.2026 (11 Seiten)** ist als aktuelle PDF-Fassung
enthalten und wird ohne bestehende EDV-Konfiguration automatisch verwendet.
Gespeicherte EDV-Konfigurationen werden durch ein App-Update nicht überschrieben.

Die Startseite zeigt eine kurze Einführung und drei kompakte, bordeauxfarbene
Schaltflächen mit weißer, fetter Beschriftung: Richtlinien, Schulungen und Formulare.
Darunter stehen datierte EDV-Mitteilungen im Bereich „Aktuelles zur KI“.
Die Inhalte der drei Bereiche erscheinen erst
nach Auswahl des jeweiligen Bereichs. Unter Formulare liegen zwei getrennte
Vorgänge: Kenntnisnahme/Schulung bestätigen und kostenpflichtigen KI-Zugang
beantragen. Die kompakte Explorer-Liste zeigt Name, Typ, Status und direkte
Aktionen sowie Formularanzahl und Richtlinienversion in der Statusleiste.
Die Richtlinienübersicht nutzt dieselbe Explorer-Ansicht mit Name, Dokumenttyp,
Version, Veröffentlichungsstatus und den Aktionen Lesen/Speichern/Details.
Weitere Dokumentinformationen liegen hinter „Details“. Der PDF-Reader und die Bestätigung
öffnen eigene klassische Dialogfenster. Das Formular trennt Person, Schulung
und Unterschrift in kurze Schritte mit Zurück/Weiter. Die Signaturarten werden
über Name/Zeichnen/Bild gewählt; „Name“ steht zuerst und ist bei einem neuen
Formular voreingestellt. „Weiter“ wechselt nur die Ansicht und löst keine
Abgabe aus. Die verbindliche Abgabe ist erst im letzten
Schritt und nur mit vollständigen Angaben möglich.
Die EDV-Verwaltung trennt „Richtlinien & Schulung“, „Nachweise“, „Zugangsanträge“ und „Nachrichten“ über Reiter.
Nachweise erscheinen als Liste, ihre Angaben und Unterschrift unter
„Eigenschaften“ in einem separaten Fenster. Signaturen und bereits eingegebene
Formulardaten bleiben beim Schließen und erneuten Öffnen des Formulars erhalten.

## Nachrichten der EDV

Unter **EDV Tools → KI → Nachrichten** verwaltet die EDV Titel, Datum,
Kategorie, Kurztext, Inhalt und optional eine HTTPS-Quelle. Beiträge werden
als Entwurf gespeichert oder ausdrücklich veröffentlicht. Nur veröffentlichte
Beiträge bis zum aktuellen Datum erscheinen auf der KI-Startseite, neueste zuerst.
Die vollständige Meldung öffnet ein eigenes Dialogfenster. Externe Quellen
öffnen erst nach einem ausdrücklichen Klick.

Die mitgelieferte erste Mitteilung verweist auf die vorhandene KI-Leitlinie.
Es gibt keinen automatischen externen Nachrichtenfeed. Beiträge liegen lokal
unter `ki_news_v1`, werden mitgesichert und nicht an andere PCs verteilt.
Entwürfe und Änderungen verlangen einen entsperrten EDV-Zugang; allgemeine
Settings-Befehle können die Nachrichten weder lesen noch überschreiben.

## Kostenpflichtigen KI-Zugang beantragen

Der Antrag erfasst Name, dienstliche E-Mail, optional den Bereich, gewünschte
KI-Anwendung und dienstlichen Einsatzzweck. Die native Speicherung validiert die
Angaben und erzeugt ID, Zeitstempel und den Status `prepared`. Es werden keine
Lizenzen bestellt, freigegeben oder automatisch zugeteilt.

Nach der lokalen Speicherung öffnet **E-Mail an EDV** einen vorausgefüllten
Entwurf an `edv@dmh-aidlingen.de`. Der Benutzer muss ihn im E-Mail-Programm selbst
absenden. Die App behauptet weder Versand noch Eingang oder Genehmigung.
Alternativ kann der Antrag mit **Kopieren** übernommen werden. Die EDV sieht
lokal gespeicherte Anträge unter **EDV Tools → KI → Zugangsanträge**. Es existiert
keine zentrale Übermittlung oder Synchronisierung dieser Anträge zwischen PCs.

Die Anträge liegen unter `ki_access_request_v1:<id>` in der lokalen Datenbank,
werden von der vorhandenen Sicherung erfasst und sind vor Änderungen über den
allgemeinen Settings-Schreibbefehl geschützt. Die Listenansicht verlangt einen
entsperrten EDV-Zugang.

## Inhalte und Bestätigungen

**Meine Nachweise** ist auf der KI-Startseite, in der Formularübersicht und
nach dem Unterschreiben erreichbar. Die kompakte Liste zeigt Dokument, Version,
Signaturdatum und Unterzeichner. Über **Öffnen** stehen Unterschrift, Angaben,
das archivierte Originaldokument und der vollständige JSON-Export bereit.
Neue Nachweise erhalten serverseitig eine Bindung an das Windows-Benutzerkonto;
die persönliche Liste erlaubt keine frei eingegebene Benutzerkennung.
Ältere Nachweise ohne diese Bindung erscheinen nur, wenn ihre E-Mail zu einer
Identität des nativ hinterlegten Microsoft-365-Kontos gehört. Ohne Zuordnung
bleiben solche Altbestände in der geschützten EDV-Ansicht zugänglich.
Die EDV-Gesamtliste bleibt geschützt. Es gibt weiterhin keinen zentralen Abruf
von Nachweisen anderer PCs und keinen kryptografisch signierten PDF-Export:
der Export enthält die elektronische Bestätigung, Signaturgrafik und Original-PDF.

Der Bereich **Schulungen** verwendet eine zweigeteilte Outlook-Ansicht:
links die unabhängig scrollbar gehaltene Liste, rechts den ausgewählten Inhalt.
Die Listenbreite kann am Trenner mit Maus oder Pfeiltasten angepasst werden;
die Liste lässt sich über die Symbolleiste ein-/ausblenden. Der vorhandene
EDV-Schulungslink bleibt die Quelle der IT-Schulung. Ohne Link wird nur der
Vorbereitungsstatus gezeigt; es werden keine weiteren Kurse erfunden.
Externe Inhalte laden erst nach **Ansehen**: direkte MP4/WebM/OGV-Links im
Videoplayer, sonst als eingebettete Seite mit Sandbox. **Im Browser öffnen**
steht für Seiten bereit, die keine Einbettung erlauben oder eine eigene
Anmeldung benötigen. Auswahl und Wiedergabe erzeugen keinen Teilnahmenachweis.

Unter **EDV Tools → KI** können berechtigte EDV-Benutzer Titel, Dokumentversion
und offiziellen Text eintragen. Ein optionaler HTTPS-Link aktiviert „Schulung
ansehen“. Inhalte werden erst mit „Offizielle Richtlinien veröffentlichen“
freigegeben. Der native Befehl verlangt einen entsperrten EDV-Zugang.
Neue PDF-Fassungen können bis 10 MB importiert werden. Ein Import setzt den
Entwurf auf unveröffentlicht und verlangt eine neue Dokumentversion, bevor
die EDV ihn wieder veröffentlicht. Das Original wird mit dem bestehenden lokalen
PDF-Viewer angezeigt; die Bestätigung wird nach erfolgreichem Laden der Ansicht
freigeschaltet. Das Öffnen bedeutet nicht automatisch, dass das Dokument gelesen
wurde: Die ausdrückliche Lesebestätigung bleibt notwendig.

Das Formular erfasst Name, E-Mail, optionalen Bereich, ausdrückliche
Lesebestätigung, Teilnahme vor Ort/online und Schulungsdatum. Die Teilnahme ist
eine Selbstauskunft; das Öffnen eines Videos gilt nicht als Teilnahmebeweis.
Unterschriften können gezeichnet, aus dem eingegebenen Namen dargestellt oder
als PNG/JPEG/WebP bis 2 MB importiert werden. Alle Varianten werden lokal in
eine PNG-Grafik mit 900 × 220 Pixeln umgewandelt. Es handelt sich um eine einfache
elektronische Bestätigung, nicht um eine zertifikatsbasierte digitale Signatur.

Die native Speicherung prüft Veröffentlichung, Dokumentrevision, Pflichtangaben,
Schulungsdatum und Signaturformat. Jede Bestätigung erhält eine eigene ID,
einen Zeitstempel, den ursprünglichen Dokumentstand und dessen SHA-256-Prüfsumme.
Gleichzeitige Dokumentänderungen führen zur Ablehnung veralteter Formulare.
Frühere Bestätigungen werden beim Bearbeiten der Richtlinien nicht überschrieben.
Die unveränderten PDF-Bytes werden zusätzlich unter ihrer SHA-256-Prüfsumme
archiviert. Eine neue Fassung ersetzt keine bereits bestätigte Datei. Das gilt
auch dann, wenn eine spätere App-Version ein anderes Standarddokument enthält.

Konfiguration und Bestätigungen liegen in der lokalen SQLite-Datenbank unter
separaten `app_settings`-Schlüsseln und werden von der bestehenden Datensicherung
erfasst. Der allgemeine Settings-Schreibbefehl kann diese Schlüssel nicht
ändern. Das EDV-Panel zeigt die lokalen Nachweise samt Unterschrift und erlaubt
den Export eines vollständigen Nachweises inklusive Original-PDF als JSON. Nach der Abgabe kann auch
der Benutzer seinen gerade erstellten Nachweis exportieren.

Es gibt keine zentrale Übermittlung, keine automatische Verteilung der
Richtlinien auf andere PCs und keine Prüfung durch einen externen Signaturdienst.
Das Standard-PDF wird mit dem App ausgeliefert; spätere lokale EDV-Importe werden
nicht automatisch an andere PCs verteilt. Die Online-Schulung steht noch aus.

Prüfung: `npm run test:e2e -- --grep "KI "` testet gesperrte Veröffentlichung
und alle drei Signaturarten im Browser. `cargo test --manifest-path
src-tauri/Cargo.toml --lib ki::tests` prüft u. a. veraltete Dokumentrevisionen
und den Erhalt des Originaldokuments beim Speichern.
