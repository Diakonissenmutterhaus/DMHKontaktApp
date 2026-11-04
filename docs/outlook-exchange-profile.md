# Outlook Classic auf Exchange umstellen

Im Fenster **Kontakte/Kalender synchronisieren** erscheint bei verbundenem
Microsoft-365-Konto die Aktion **Zu Exchange wechseln**. Sie richtet Outlook
Classic auf dem jeweiligen Windows-PC ein. Die Anmeldung und Synchronisierung
der DMH-App allein ändern keine Outlook-Profile.

## Ablauf

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
5. Ein neues Profil **Profile Exchange** erhält einen Exchange-MAPI-Dienst
   und die SMTP-Adresse. Outlook ermittelt die Verbindung beim Öffnen.
   Belegte Namen werden nicht überschrieben: gegebenenfalls entstehen
   **Profile Exchange 2** beziehungsweise **Profile IMAP 2**.
6. Outlook wird mit `/profile` für genau dieses neue Profil gestartet. Eine
   vorhandene Office-/Windows-Anmeldung kann genutzt werden; Microsoft kann
   dennoch Anmeldung, Kontobestätigung oder MFA verlangen.
7. Die App prüft die laufende Outlook-Instanz: Profilname, SMTP-Adresse,
   Exchange-Kontotyp, primärer Exchange-Store und ein verbundener
   `Account.ExchangeConnectionMode` müssen übereinstimmen. Ein Offline-Cache,
   ein freigegebenes Postfach oder die Graph-Anmeldung allein genügen nicht.
8. Erst danach wird das neue Profil Standard und das passende alte Profil
   nach Möglichkeit **Profile IMAP** genannt. Unterstützt Outlook die
   Umbenennung nicht, bleibt dessen ursprünglicher Name erhalten und die
   Oberfläche zeigt den Hinweis an. Bestehende Profile und Datendateien
   werden nicht gelöscht.

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

- `npm test -- src/components/OutlookExchangeProfileSetup.test.tsx`
- `npx tsc --noEmit`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib outlook_exchange::tests`
- `cargo test --manifest-path outlook-profile-reader/Cargo.toml`
- `npm run prepare:outlook-helper` baut die x86-/x64-Hilfsprogramme.

Die vorhandenen Tauri-Build-Hooks paketieren beide Hilfsprogramme auch im
Admin-Test-Kanal. Ein bestehender veröffentlichter Installer erhält die Funktion
erst durch einen neuen Build und eine neue Veröffentlichung.

Automatisierte Tests verändern keine realen Outlook-Profile. Die tatsächliche
Autodiscover-/SSO-Einrichtung muss zusätzlich mit einem Pilotbenutzer auf einem
Test-PC geprüft werden.

Microsoft-Referenzen:
[Profil erstellen](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/how-to-programmatically-create-a-profile-in-outlook),
[Profil umbenennen](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/iprofadmin-renameprofile),
[Standardprofil setzen](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/iprofadmin-setdefaultprofile),
[Exchange-Verbindungsmodi](https://learn.microsoft.com/en-us/office/vba/api/outlook.olexchangeconnectionmode).
