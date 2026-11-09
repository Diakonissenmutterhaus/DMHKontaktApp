# Outlook Classic auf Exchange umstellen

Auf der Seite **M365 Anmeldung** erscheint direkt unter dem verbundenen Konto
im Panel **Automatische Synchronisierung** rechts die Aktion **Zu Exchange wechseln**;
links bleibt die manuelle Synchronisierung erreichbar.
Sie ist auch im Fenster **Kontakte/Kalender synchronisieren** erreichbar. Sie richtet Outlook
Classic auf dem jeweiligen Windows-PC ein. Die Anmeldung und Synchronisierung
der DMH-App allein ändern keine Outlook-Profile.

Die Kontokarte zeigt zusaetzlich das aktuelle Outlook-Profil, den Kontotyp und
den gemeldeten Server fuer genau die verbundene E-Mail-Adresse. Bei geschlossenem
Outlook werden Kontotypen und verfügbare Server aus dem gespeicherten
Standardprofil gelesen. Exchange wird aus den Outlook-Kontoeigenschaften
erkannt, niemals aus der Graph-Anmeldung oder einem Profilnamen abgeleitet.
Ist das laufende COM-Objekt vorübergehend nicht verfügbar, bleibt die gespeicherte
Konfiguration sichtbar, ohne sie als aktive Sitzung auszugeben.
Die Anzeige wird regelmaessig und beim Fensterwechsel neu gelesen; Outlook
wird dabei nicht gestartet und es werden keine Profile veraendert.

Unter **Outlook** stehen **Outlook öffnen** und **Profile verwalten** bereit.
Die Anzeige unterscheidet das gespeicherte **Standardprofil** fuer den naechsten
Start vom aktuell geoeffneten Profil. **Profile verwalten** zeigt eine kompakte
Profilliste; **Eigenschaften** enthält Konten, Server und Datendateien.
Der Standard wird separat gewählt und mit **Übernehmen** gespeichert.
**Öffnen** startet das ausgewaehlte Profil einmalig ueber
`/profile`, ohne das Standardprofil zu aendern. Eine laufende Outlook-Instanz
wird dabei nicht beendet oder auf ein anderes Profil umgeschaltet.

Nicht geoeffnete Profile werden ausschliesslich ueber freigegebene
Konfigurationsfelder gelesen. Es wird weder eine Anmeldung fuer andere Profile
gestartet noch eine vollstaendige Zugriffsberechtigung auf deren Postfaecher
behauptet. Im aktiven Profil werden die Konten und Stores des laufenden Outlook
gelesen, einschliesslich gemeldeter Dateipfade und erreichbarer Standard-Posteingaenge.
Nachrichteninhalte und Kennwoerter werden nicht gelesen.

**Outlook öffnen** liest das Standardprofil beim Klick erneut und startet genau
dieses Profil. Ist Outlook bereits geoeffnet, bleibt die laufende Instanz erhalten;
die App erklaert, dass fuer einen Profilwechsel zuerst gespeichert und geschlossen
werden muss. Beim ausdrücklich gespeicherten Standard beziehungsweise Abschluss
der Exchange-Einrichtung wird „Immer dieses Profil verwenden“ aktiviert.

## Ablauf

Der Abschluss erfordert drei übereinstimmende Nachweise: das Exchange-Profil
steht in der nativen MAPI-Profilliste, MAPI meldet es als Standard, und die
Startauswahl zeigt denselben Standard mit deaktivierter Profilauswahl.
Registry-Reste oder Einträge unter „Deleted Profiles“ gelten niemals als
verwendbare Profile. Fehlende Profile werden beim ausdrücklichen Neustart der
Einrichtung unter einem freien Namen neu eingerichtet; vorhandene Daten und
gelöschte Profilreste werden dabei nicht entfernt oder reaktiviert.

Die Einrichtung startet Outlook mit verborgenem Hauptfenster und speichert
Prozess-ID sowie Startzeit. Ein vorhandener Outlook-Prozess wird nicht übernommen.
Microsoft-Anmeldung und MFA bleiben bei Bedarf sichtbar; die App bedient oder
versteckt diese Dialoge nicht. Während des normalen Ablaufs erscheint nur
„Wird eingerichtet. Bitte warten und die Anwendung nicht schließen.“
Diese Meldung erscheint unmittelbar nach dem Klick in einem zentrierten,
blockierenden Dialog. Er bleibt während Vorbereitung, Prüfung und Abschluss
offen; die App-Navigation ist solange gesperrt. Erfolg, Fehler oder ein
Prüfzeitlimit geben die Oberfläche wieder frei.

Nach bestätigter Online-Verbindung beendet die App die eigene Outlook-Instanz
über `Application.Quit` und wartet auf deren vollständiges Ende. Prozess-ID,
Startzeit und Profil müssen weiterhin übereinstimmen; offene Inspector-Fenster
oder Inline-Antworten verhindern den automatischen Abschluss. Fremde oder neu
gestartete Instanzen werden nicht geschlossen. Es gibt keinen erzwungenen
Prozessabbruch. In diesen Ausnahmefällen ist ein manuelles Schließen erforderlich.
Erst nach dem Prozessende werden Standard und gegebenenfalls IMAP-Name gespeichert,
„Immer dieses Profil verwenden“ aktiviert und der Standard in einem getrennten
Helper-Prozess erneut gelesen. Vorher erscheint keine Erfolgsmeldung. Ein bereits
eingerichteter anderer Exchange-Standard für dieselbe Kontoadresse wird erkannt,
ohne erneut ein Profil anzulegen. Die Kontokarte wird nach Abschluss sofort
aktualisiert.

1. Der Benutzer startet die Einrichtung ausdrücklich per Button. Beim Öffnen
   des Fensters werden keine Outlook-Profile verändert.
2. Die native App bestätigt die bestehende Microsoft-365-Verbindung über
   Microsoft Graph und verwendet die dort bereits hinterlegte Kontoadresse.
   Eine frei eingegebene Adresse aus der Oberfläche wird nicht übernommen.
3. Läuft Outlook noch, muss der Benutzer seine Arbeit speichern und Outlook
   schließen. Die App beendet Outlook nicht zwangsweise.
4. Der zur Adresse passende IMAP-Profilname wird ermittelt. Mehrere passende
   Profile erfordern eine Prüfung durch die EDV. Nicht lesbare Profile werden
   nicht übersprungen oder umbenannt.
5. Entspricht die primaere SMTP-Adresse des Windows-Domaenenkontos exakt dem
   verbundenen Microsoft-Konto, konfiguriert Outlook ein neues, leeres Profil
   selbst ueber **ZeroConfigExchange**. Die benutzerspezifische Startpraeferenz
   wird nur waehrend des Outlook-Starts gesetzt und danach wiederhergestellt;
   Unternehmensrichtlinien werden nicht veraendert. Ohne passende Windows-Identitaet
   bleibt der bisherige MAPI-Pfad mit hinterlegter SMTP-Adresse erhalten.
   Belegte Namen werden nicht überschrieben: gegebenenfalls entstehen
   **Profile Exchange 2** beziehungsweise **Profile IMAP 2**.
6. Outlook wird mit `/profile` für genau dieses neue Profil gestartet. Eine
   vorhandene Office-/Windows-Anmeldung kann genutzt werden; Microsoft kann
   dennoch Anmeldung, Kontobestätigung oder MFA verlangen.
   Ein unvollstaendiges Profil aus dem bisherigen MAPI-Ablauf wird bei einem
   erneuten Versuch mit geschlossenem Outlook erhalten und durch ein neues,
   eindeutig benanntes Windows-SSO-Profil ersetzt. Ein abgeschlossener Vorgang
   wird nicht auf diese Weise neu eingerichtet.
7. Die App prüft die laufende Outlook-Instanz: Profilname, SMTP-Adresse,
   Exchange-Kontotyp, primärer Exchange-Store und ein verbundener
   `Account.ExchangeConnectionMode` müssen übereinstimmen. Ein Offline-Cache,
   ein freigegebenes Postfach oder die Graph-Anmeldung allein genügen nicht.
8. Erst danach wird das neue Profil Standard und das passende alte Profil
   nach Möglichkeit **Profile IMAP** genannt. Unterstützt Outlook die
   Umbenennung nicht, bleibt dessen ursprünglicher Name erhalten und die
   Oberfläche zeigt den Hinweis an. Bestehende Profile und Datendateien
   werden nicht gelöscht.

Beim Abschluss verwendet der Helper einen verlustfrei kodierten ANSI-Profilnamen,
da einzelne Outlook-Versionen `MAPI_UNICODE` bei `SetDefaultProfile` mit
`MAPI_E_BAD_CHARWIDTH` ablehnen. Die registrierte Standardprofilauswahl wird nach
dem Freigeben von MAPI erneut bestaetigt, damit ein veralteter Profilkatalog die
Auswahl nicht zuruecksetzt. Unterbrochene Vorgaenge in der Phase `activating`
werden als abgeschlossen erkannt, wenn das zuvor online bestaetigte Zielprofil
bereits dauerhaft Standard ist. Dabei werden keine Profile neu angelegt.

Die kompakte Ansicht zeigt waehrenddessen **Profil wird abgeschlossen …** und
danach nur die Erfolgsbestaetigung. Beim erneuten Oeffnen wird der gespeicherte
Abschluss gelesen, ohne erneut eine Einrichtung zu starten.

Die automatische Verbindungsprüfung hält nach vier Minuten an. Mit
**Exchange-Verbindung prüfen** beziehungsweise **Einrichtung fortsetzen** kann
der Benutzer fortfahren. Ein erneuter Versuch nutzt den gespeicherten Vorgang,
statt ein weiteres Profil anzulegen. Wird das richtige neue Profil bereits
zur Anmeldung verwendet, bleibt es geöffnet.

## Voraussetzungen und Grenzen

- Outlook Classic unter Windows, x86 oder x64; das neue Outlook verwendet
  diese MAPI-Profile nicht.
- Eine bereitgestellte Exchange-Mailbox und funktionierende automatische
  Outlook-Verbindungsermittlung. Die Funktion ändert keine DNS- oder
  Autodiscover-Einstellungen.
- Der Windows-Benutzer startet DMH Backup und Outlook in derselben regulären
  Sitzung. Keine Kennwortübernahme und keine Übertragung von Graph-Tokens
  an Outlook.
- Die Profilerstellung migriert keine alten E-Mails. Die serverseitige
  IMAP-Migration und die Sicherung lokaler Nachrichten bleiben eigene Schritte.

Der lokale Fortschritt liegt unter `m365_outlook_exchange_setup_v1_*`, getrennt
nach Microsoft-Konto. Er wird nicht in portable Backups exportiert oder daraus
wiederhergestellt und ist über den allgemeinen Settings-Schreibbefehl nicht
änderbar. Eine unterbrochene Aktivierung kann fortgesetzt werden. Fremde oder
vorhandene Profile werden niemals als Bereinigung gelöscht; nur ein im selben
Helper-Aufruf neu angelegtes, nicht konfigurierbares Profil darf zurückgerollt
werden.

Eine lokale Betriebssystem-Dateisperre verhindert gleichzeitige
Profileinrichtungen durch Produktions- und Admin-Test-App desselben
Windows-Benutzers. Bei einem Prozessabbruch wird diese Sperre freigegeben.

## Prüfung und Paketierung

### Kompakte Profilverwaltung

Die Kontokarte zeigt das Standardprofil und einen kurzen Verbindungsstatus.
„Outlook öffnen“ verwendet den gespeicherten Standard. Über „Profile verwalten“
werden die Profile samt Konten, Postfächern und Datendateien eingeblendet.
Die Verwaltung folgt dem klassischen Systemdialog: eine Profilliste mit
„Hinzufügen…“, „Entfernen“, „Eigenschaften“ und „Öffnen“ darunter.
„Öffnen“ startet die Listenauswahl, ohne den Standard zu ändern.
„Eigenschaften“ öffnet einen separaten modalen Systemdialog mit vollständigen
Konten-/Benutzerdetails, Servern, Postfächern sowie PST-/OST-Pfaden. Dort kann
das Profil geöffnet oder ausdrücklich als Standard gespeichert werden.
Der Dialog schließt über „Schließen“ oder Escape und gibt den Fokus an den
Aufrufknopf zurück. Der separate
Bereich „Outlook-Start“ zeigt die Standardauswahl; eine Änderung wird erst
mit „Übernehmen“ gespeichert.

„Hinzufügen…“ legt nach Eingabe eines eindeutigen Namens ein leeres Outlook-Profil an.
Das Konto wird anschließend beim Öffnen dieses Profils in Outlook eingerichtet.
„Entfernen“ verlangt eine separate Bestätigung. Beim Entfernen des Standards
muss ein vorhandenes Ersatzprofil ausgewählt werden, solange andere Profile
verbleiben. Die Entfernung ist bei laufendem Outlook gesperrt; vor dem nativen
MAPI-Aufruf wird dies erneut geprüft. Die App löscht keine PST-Dateien und keine
Serverpostfächer. Kontoeinstellungen und Offline-Cache können verloren gehen;
nicht synchronisierte Daten müssen vorher gesichert werden. Automatisierte
Tests prüfen diese Regeln mit Testdaten und entfernen keine echten Profile.

- `npm test -- src/components/OutlookExchangeProfileSetup.test.tsx`
- `npx tsc --noEmit`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib outlook_exchange::tests`
- `cargo test --manifest-path outlook-profile-reader/Cargo.toml`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-outlook-windows-sso.ps1`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-outlook-profile-catalog.ps1`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-outlook-background-setup.ps1`
- `npm run prepare:outlook-helper` baut die x86-/x64-Hilfsprogramme.

Die vorhandenen Tauri-Build-Hooks paketieren beide Hilfsprogramme auch im
Admin-Test-Kanal. Ein bestehender veröffentlichter Installer erhält die Funktion
erst durch einen neuen Build und eine neue Veröffentlichung.

Automatisierte Tests verändern keine realen Outlook-Profile. Die tatsächliche
Autodiscover-/SSO-Einrichtung muss zusätzlich mit einem Pilotbenutzer auf einem
Test-PC geprüft werden.

Microsoft-Referenzen:
[Automatische Windows-Kontoeinrichtung (ZeroConfigExchange)](https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/profiles-and-accounts/zeroconfigexchange),
[Profil erstellen](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/how-to-programmatically-create-a-profile-in-outlook),
[Profil umbenennen](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/iprofadmin-renameprofile),
[Standardprofil setzen](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/iprofadmin-setdefaultprofile),
[Exchange-Verbindungsmodi](https://learn.microsoft.com/en-us/office/vba/api/outlook.olexchangeconnectionmode).
