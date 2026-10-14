# Lokales E-Mail-Archiv

Die Hauptnavigation enthält **M365 Anmeldung** (bestehende Microsoft-365-Verbindung) und **emails speichern**. Das E-Mail-Archiv ist unabhängig von Exchange-Synchronisation und EDV-Zugang. Es kopiert erst nach dem Klick auf „Alle E-Mails der Auswahl lokal kopieren“.

## Daten und unterstützte Quellen

- Thunderbird: alle gefundenen Profile aus `profiles.ini` und `Profiles`, einschließlich individueller `mail.server.*.directory`-Pfade. `Mail` und `ImapMail`, MBOX, Maildir (`cur`/`new`), Unterordner und leere Ordner. Die Mail-Datenspeicher werden zuerst vollständig in eine neue lokale Kopie geschrieben und dann daraus indiziert. Keine Passwörter oder vollständigen Benutzerprofile werden exportiert.
- Outlook Classic: lokale PST/OST-Datenspeicher und IMAP-Konten des geöffneten Profils. Rekursive Ordnerstruktur, lokale vollständig heruntergeladene MailItems, MSG-Unicode-Kopien einschließlich Anhängen. Über `GetActiveObject` wird nur eine laufende Instanz genutzt. Keine Profiländerung, kein Logon, Download, Send, Save, Delete, Unread/MarkForDownload oder Quit. `SaveAs` schreibt ausschließlich ins Archiv.
- Neues Outlook unterstützt kein Outlook Object Model. Nicht geöffnete/angehängte PST-Dateien, andere Outlook-Profile und reine Servernachrichten werden nicht als bereits archiviert behauptet. Outlook Classic mit dem gewünschten Profil und Datenspeichern öffnen; Servernachrichten vorher dort herunterladen. Die Scan-Ergebnisse und Teilfehler zeigen fehlenden Zugriff an.

Das Archiv liegt in `<AppData des aktuellen App-Kanals>/email-archive/`: `archive.sqlite` für Ordner, Suchindex und Outlook-Lesetext; `copies/<UUID>/` für Original-Maildateien. Es ist eine zusätzliche lokale Kopie, kein Ersatz für ein Backup auf einem zweiten Datenträger. Vorhandene Kopien werden nicht gelöscht. Wiederholte Kopien aktualisieren den Index ohne doppelte Nachrichten; identische Nachrichten innerhalb einer MBOX bleiben als getrennte Vorkommen erhalten.

Outlook kann dasselbe E-Mail-Konto gleichzeitig als **Exchange** und **IMAP**
führen; diese Datenspeicher haben unterschiedliche Nachrichten und Ordner. Der
Import ordnet `Account.AccountType` über `Account.DeliveryStore.StoreID` dem
richtigen Datenspeicher zu. `IsDataFileStore=false` schließt ein bestätigtes
IMAP-Konto nicht aus: diese Eigenschaft liefert für IMAP laut Microsoft immer
`false`. Online-Exchange ohne Offlinekopie und unbekannte Remote-Anbieter bleiben
ausgeschlossen. Kopiert werden nur Elemente mit `DownloadState=olFullItem` (1);
andere Zustände bzw. Lesefehler werden als unvollständige Kopie gemeldet.

Konten werden durch ihre StoreID getrennt, nicht durch die sichtbare E-Mail-Adresse.
Der Kontotyp erscheint als **IMAP/Exchange/POP/PST** in Import- und Archivbaum,
in zugänglichen Auswahlbeschriftungen und in den Eigenschaften. Diese Zusatzangabe
wird getrennt gespeichert; vorhandene Ordnerpfade, Nachrichten-IDs, Kategorien,
Sortierungen und ausgeblendete Konten bleiben erhalten. Bei alten Archiven wird
der Typ mit „Quellen prüfen“ aktualisiert; neue Nachrichten benötigen eine neue
Kopie. Ein Archiv ist keine automatische Live-Synchronisation mit Outlook.

Referenzen: [Microsoft IsDataFileStore](https://learn.microsoft.com/en-us/office/vba/api/outlook.store.isdatafilestore),
[AccountType](https://learn.microsoft.com/en-us/office/vba/api/outlook.account.accounttype),
[DownloadState](https://learn.microsoft.com/en-us/office/vba/api/outlook.mailitem.downloadstate).

Eine laufende Kopie wird im nativen Prozess fortgeführt, wenn der Benutzer eine andere App-Seite öffnet. Beim Zurückkehren werden Fortschritt, laufende Sperre und Ergebnis erneut gelesen. Gleichzeitige Kopierläufe sind gesperrt. Beim Beenden des gesamten Apps wird ein laufender Vorgang unterbrochen; vollständig indizierte frühere Quellen bleiben erhalten.

## Oberfläche

**Importieren** zeigt Konten/Profile und ihre Ordner als auf- und zuklappbaren
Baum. Einzelne Ordnerpfeile und „Alle Ordner aufklappen/zuklappen“ verändern
nur die Darstellung. Die Kontrollkästchen wählen ganze Konten einschließlich
aller Unterordner; „Alle auswählen“ und „Auswahl aufheben“ ändern diese Auswahl.
Rechts stehen Kopierziel, Auswahl, Kopierfortschritt und Ergebnis. Die
Ordner-Vorschau liest ausschließlich Namen/Struktur; sie importiert noch keine
Nachrichten. Bei Outlook werden dafür weder Items noch Downloadflags gelesen.

**E-Mails lesen** enthält ausschließlich das lokale Archiv. Die Ordnerleiste
links lässt sich einklappen; Nachrichten erscheinen als kompakte Liste mit
Betreff, Absender und Datum. Standardmäßig liegt der Lesebereich unter der
Liste, optional rechts daneben. Eine gewählte Nachricht lässt sich im
Lesebereich erweitern und wiederherstellen. Ordner und Nachrichten sind auch
mit Pfeiltasten erreichbar. Die gewählte Unterseite wird lokal gemerkt; ein
laufender Kopierauftrag bleibt beim Wechsel der Unterseite aktiv.

Beim Öffnen der E-Mail-Seite wird die Hauptnavigation zur schmalen Symbolleiste.
Beim Überfahren mit der Maus (oder Tastaturfokus auf einem Navigationsbutton)
blendet sie die Beschriftungen über dem Inhalt ein, ohne die Lesespalten zu
verschieben. Nach Verlassen klappt sie wieder ein. Andere Hauptseiten behalten
ihre bisherige Darstellung.

Rechtsklick oder **Umschalt+F10** auf einem Postfach/Ordner öffnet ein Kontextmenü:
Öffnen/Suche bei Nachrichtenordnern, Auf-/Zuklappen, Unterordner auf-/zuklappen,
Eigenschaften und **Postfach/Ordner aus Archiv entfernen**. Eigenschaften zeigt
Quelle, Pfad und Zahl der Nachrichten mit Unterordnern. Das Entfernen zeigt vorab
die Anzahl betroffener Ordner und Nachrichten und benötigt eine Bestätigung.
Während einer Kopie ist es gesperrt; eine veränderte Vorschau muss neu bestätigt
werden. Escape schließt Menü und Dialog, Menüeinträge sind per Pfeiltasten erreichbar.

Die Entfernung ist eine reversible Änderung der **Archivansicht**, keine Löschung
der Originale, Rohkopien oder Indexeinträge. Sie gilt dauerhaft für die gewählte
Quelle und den genauen Ordnerzweig, einschließlich künftig kopierter Unterordner.
Gleichnamige Konten und benachbarte Ordner bleiben getrennt, auch bei älteren
Archivdaten ohne Quellenkennung. Entfernte Nachrichten erscheinen nicht in Listen
oder Suchergebnissen. **Entfernte Postfächer/Ordner wiederherstellen** zeigt alle
entfernten Zweige wieder an; das funktioniert offline ohne erneuten Import und
ohne Outlook. Es wird dadurch kein Speicherplatz freigegeben.

Die Ordnerreihenfolge kann durch Ziehen zwischen gleichgeordneten Ordnern,
**Nach oben/Nach unten** im Kontextmenü oder **Alt+↑/↓** geändert werden. Ein
markierter Rand zeigt die Einfügeposition; am oberen/unteren Rand scrollt der
Ordnerbaum beim Ziehen. Ein Ordner behält dabei alle Unterordner und Nachrichten.
Andere Konten bzw. Hierarchieebenen sind keine gültigen Ablageziele. Die Reihenfolge
ändert ausschließlich die Anzeige im App, nicht die Ordner in Outlook/Exchange.

Die persönliche Reihenfolge wird im lokalen Archiv gespeichert und gilt in der
Importvorschau und im Lesebereich. Reimporte überschreiben sie nicht. Neue Ordner
werden hinter den persönlich geordneten Ordnern ergänzt. **Importierte Reihenfolge
wiederherstellen** setzt die persönliche Reihenfolge der gewählten Ebene zurück.

Outlook-Scan und -Kopie bewahren die Reihenfolge der bereitgestellten Ordnerliste
und lesen, wenn verfügbar, `PR_SORT_POSITION` über `PropertyAccessor.GetProperty`.
Der binäre Schlüssel wird ohne Änderung der Outlook-Eigenschaften übernommen.
Gleichrangige Schlüssel werden nach Ordnername sortiert. Ohne diese Metadaten wird
die bereitgestellte Listenreihenfolge verwendet, bei alten Archivdaten ohne jede
Ordnungsinformation alphabetisch. Scan/„Quellen prüfen“ aktualisiert auch die
Ordnungsmetadaten bestehender Kopien, ohne Nachrichten neu kopieren zu müssen.
Eine pixelgenau gleiche Reihenfolge für jede Outlook-Version/Ansicht wird dadurch
nicht garantiert; persönliche App-Einstellungen haben stets Vorrang.

Referenzen zur Reihenfolge: [Microsoft MFCMAPI, PR_SORT_POSITION](https://github.com/microsoft/mfcmapi/blob/main/core/mapi/extraPropTags.h),
[Outlook PropertyAccessor](https://learn.microsoft.com/en-us/office/vba/api/outlook.folder.propertyaccessor).

Die Suche arbeitet wie die Kontaktsuche als Teiltextsuche in den kombinierten
Feldern Betreff, Absender, Empfänger und Cc, zusätzlich in Anhangnamen, unabhängig
von Groß-/Kleinschreibung (auch Umlaute). Sie durchsucht den gesamten gewählten
Bereich vor der Seiteneinteilung, nicht nur die 100 sichtbaren Nachrichten.
Nachrichtenkörper werden dabei nicht durchsucht. „Suchen in“ wechselt zwischen
dem aktuellen Ordner und dem gesamten Archiv; ein Ordnerklick wählt wieder den
Ordner als Suchbereich. Unter „Details“ steht der ursprüngliche Ordnerpfad.

Die klickbaren Spaltenköpfe **Betreff**, **Von** und **Datum** wechseln mit jedem
Klick die Sortierrichtung; ein Pfeil zeigt die aktuelle Richtung. Betreff/Von
starten mit A–Z, Datum mit Neueste zuerst. Enter/Leertaste funktioniert ebenfalls.
Die Auswahl „Sortieren“ bleibt synchron und bietet auch Betreff/Absender Z–A.
Sortieren gilt für alle Treffer vor der Seiteneinteilung, setzt die Liste auf
Seite 1 und erhält die geöffnete Nachricht im Lesebereich. Datumsreihenfolge
vergleicht Zeitpunkte einschließlich UTC-Offsets; fehlende Datumsangaben stehen
bei Datumsortierung am Ende. „Filter“ öffnet Zeitraum (Heute, letzte 7/30 Tage,
eigener Zeitraum), Von/Bis und „Nur mit Anhang“. Von/Bis bezieht sich auf lokale
Kalendertage und schließt den gesamten letzten Tag ein, auch bei Zeitumstellung.
Leere Grenzen sind offen; ein ungültiger Zeitraum zeigt eine Korrekturhilfe.
Alle Filter werden kombiniert. Änderungen setzen die Nachrichtenseite und Auswahl
zurück; „Zurücksetzen“ leert Suchtext und Filter und stellt Neueste zuerst wieder her.
Der gewählte Ordner bleibt dabei erhalten. Diese Funktionen lesen ausschließlich
den lokalen Index und verändern keine Nachrichten in Thunderbird, Outlook oder Exchange.

Bestehende Archivkopien bleiben nutzbar. Der Archivindex erhält eine
Quellenkennung, damit gleichnamige Ordner unterschiedlicher Konten getrennt
bleiben. Ältere Einträge werden weiterhin anhand ihrer gespeicherten Hierarchie
angezeigt, auch wenn das ursprüngliche E-Mail-Programm nicht mehr verfügbar ist.

## Lesen und Datensicherheit

Rechtsklick oder **Umschalt+F10** auf einer Nachricht öffnet ein Menü mit:

- **In anderen Archivordner verschieben**: Zielordner im lokalen Baum wählen.
- **Kategorisieren**: Kategoriename (auch vorhandene Namen) und Farbe wählen;
  „Keine Kategorie“ entfernt die Zuordnung. Die Kategorie erscheint an der
  Nachricht und kann über den Listenfilter gesucht werden.
- **Aus Backup löschen**: nach Bestätigung in den **Archiv-Papierkorb** verschieben.
  Unter „Ansicht → Archiv-Papierkorb“ können Nachrichten per Rechtsklick
  wiederhergestellt werden. Es gibt keine permanente Rohdatei-Löschung.
- **In separatem Fenster öffnen**: eigenes Tauri-Lesefenster, auch per Doppelklick.
  Dasselbe bereits geöffnete Fenster wird fokussiert. Text, Metadaten, PDF-/Bild-
  Anhänge und „Speichern unter“ verwenden denselben Leser wie die Hauptansicht.

Verschieben, Kategorie und Papierkorb werden getrennt von den importierten
Datensätzen gespeichert und bei Reimporten beibehalten. Original-MBOX/MSG/EML
und Nachrichten-IDs bleiben unverändert. Ordnerzählung und Suchergebnisse verwenden
den lokalen Zielordner und Papierkorbstatus. Änderungen aktualisieren bereits
geöffnete Lesefenster. Bei laufender Kopie sind die Schreibaktionen gesperrt.
Fehlschläge zeigen eine Handlungsanweisung; technische Details einschließlich
Nachrichten-ID, Betreff und Datum gehen in die private EDV-Diagnose.

Das Lesefenster startet den Archivleser direkt und initialisiert keine App-
Synchronisationsschleifen. Sein Capability-Profil erlaubt Fenstersteuerung und
Anhang-Speicherdialoge. Es lädt nur lokale App-Ressourcen und zeigt E-Mail-HTML
weiterhin ausschließlich als inerten Text an.

Ordner, Suche nach Betreff/Absender/Empfänger, Seiten mit 100 Nachrichten, Textansicht und Anhangsvorschau. Originale Anhänge bleiben in MBOX/Maildir/MSG erhalten. Der Nachrichtentext bleibt schreibgeschützt. Antworten/Senden und Änderungen an den Original-E-Mails sind nicht möglich; lokale Archivaktionen sind unten beschrieben. Nachrichteninhalt wird nicht als HTML in den aktiven DOM eingesetzt; HTML-only-Nachrichten werden über ein inertes Template in Text umgewandelt. Keine Trackingpixel oder externen Inhalte werden geladen. Das Lesen greift nur auf Pfade innerhalb des lokalen Archivordners zu.

PDF-Anhänge und Bilder (PNG, JPEG, GIF, WebP und BMP) können über **Anzeigen**
direkt in der App geöffnet werden. PDFs verwenden den lokal gebündelten
PDF.js-Viewer mit Seitennavigation, Zoom und Kennworteingabe für geschützte PDFs.
Es wird ausschließlich auf Canvas gerendert, ohne interaktive PDF-Aktionen,
Links, Skripte oder Formulare. Schriftdateien, CMaps und Decoder werden mit
`npm run prepare:pdf-viewer` lokal bereitgestellt; kein CDN ist nötig.

Thunderbird-Anhänge werden aus MIME/MBOX/Maildir extrahiert. Outlook-Anhänge
werden direkt aus den binären Attachment-Streams der archivierten MSG-Datei
gelesen, mit Unicode-Dateinamen und ohne laufendes Outlook. Bestehende
Archivkopien benötigen dafür keine erneute Importierung. Gleichnamige Anhänge
bleiben durch ihren Index getrennt.

**Speichern unter** erstellt auf Wunsch eine separate Datei. Archivdateien und
bestehende Zieldateien werden nicht überschrieben; bei gleichem Dateinamen
einen freien Namen wählen. Andere Dateitypen können gespeichert werden, haben
aber keine eingebettete Vorschau. Eingebettete Outlook-Nachrichten/OLE-Objekte
ohne binären Dateistream bleiben in MSG enthalten und sind noch nicht separat
öffnungsfähig. Vorschauen sind auf 32 MiB begrenzt, Extraktion auf 64 MiB; MIME
benötigt eine Nachricht innerhalb der bestehenden 64-MiB-Parsinggrenze. Die
vollständige Rohkopie bleibt auch oberhalb dieser Anzeigegrenzen erhalten.

Nachrichten über 64 MiB bleiben vollständig in der Rohkopie erhalten; MIME-Parsing ist auf 64 MiB und die Textansicht auf 512 KiB begrenzt und entsprechend gekennzeichnet. MBOX-Zeilen werden mit begrenztem Speicher gescannt. Änderungen lokaler Gelesen-/Tag-Header erzeugen keine doppelten Nachrichten. Fehler während einer Thunderbird-Quelldateikopie oder -indizierung lassen den vorherigen Index dieser Quelle bestehen. Teilfehler und nur als Header vorhandene Outlook-Nachrichten werden sichtbar als unvollständige Kopie mit nächstem Schritt gemeldet.

## Prüfung

Native Fixture-Tests: MBOX inklusive identischer Nachrichten, unveränderte Originale, leere Unterordner, wiederholte Indizierung, MIME/Charsets/Anhänge, mehrere Profile und externe Kontoverzeichnisse. Zusätzlich werden MIME- und MSG-Anhänge, doppelte Dateinamen, Unicode, Bildsignaturen und das Speichern ohne Überschreiben geprüft. Outlook-Skript wird syntaktisch und auf fehlende Client-Mutationsbefehle geprüft. Browser-Tests verwenden ausschließlich fiktive Nachrichten und testen PDF-Seitenwechsel/Zoom, Bildanzeige, Speichern, Schließen und ausbleibende PDF-Skript/Tracker-Ausführung; eine echte Vollkopie benötigt einen separaten Test mit Thunderbird/Outlook auf dem Benutzer-PC.

Referenzen: [Thunderbird Folder Storage](https://source-docs.thunderbird.net/en/latest/backend/folder_storage.html), [Outlook SaveAs](https://learn.microsoft.com/en-us/office/vba/api/outlook.mailitem.saveas), [Outlook DownloadState](https://learn.microsoft.com/en-us/office/vba/api/outlook.mailitem.downloadstate), [Vergleich Neues Outlook/Classic](https://support.microsoft.com/en-us/outlook/getstarted/feature-comparison-between-new-outlook-and-classic-outlook).
