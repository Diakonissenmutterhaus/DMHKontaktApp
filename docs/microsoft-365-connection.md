# Microsoft-365-Verbindung einrichten

Die App verbindet ein dienstliches Microsoft-365-Konto unter:

`M365 Anmeldung → Mit Microsoft 365 verbinden`

Der Standardweg versucht zuerst, das bereits mit Windows verbundene
Geschäftskonto über Microsoft MSAL/WAM ohne Kennworteingabe zu verwenden.
Wenn die Microsoft-Richtlinien eine Bestätigung verlangen, das Konto nicht
verfügbar ist oder Windows bei mehreren Konten keine Standardidentität bestimmen kann, öffnet
die App die offizielle Microsoft-Anmeldung zur Auswahl/Bestätigung. Wenn WAM
nicht verfügbar ist, bleibt der Browser-Login mit PKCE als Alternative. Mit
**Anderes Konto verwenden** lässt sich diese Auswahl direkt öffnen.
Ein Gerätecode bleibt als Alternative nach fehlgeschlagener Anmeldung erhalten.

Die App setzt kein Kennwort zurück, meldet keine anderen Microsoft-Apps ab und
umgeht keine MFA-, Einwilligungs- oder Conditional-Access-Anforderung. Ein
Windows-Konto allein garantiert deshalb nicht auf jedem Notebook eine
vollständig stille Anmeldung. Authentifizierung startet erst nach einem Klick;
die laufende Synchronisierung öffnet keine Anmeldefenster.

## 1. Anwendung in Microsoft Entra ID registrieren

1. Microsoft Entra Admin Center öffnen.
2. Eine neue App-Registrierung für `DMH Backup` anlegen.
3. Als Kontotyp ausschließlich Konten dieses Organisationsverzeichnisses wählen
   (Single Tenant).
4. Unter **Authentifizierung → Plattform hinzufügen → Mobile und
   Desktopanwendungen** beide Redirect-URIs eintragen:
   - `http://localhost` für den bisherigen Browser-Login mit PKCE.
   - `ms-appx-web://Microsoft.AAD.BrokerPlugin/<Anwendungs-ID>` für WAM.
5. Unter **Authentifizierung → Erweiterte Einstellungen** die Option
   **Öffentliche Clientflows zulassen** aktivieren.
6. Unter **API-Berechtigungen** die von der App benötigten delegierten
   Microsoft-Graph-Berechtigungen eintragen: `User.Read`,
   `Contacts.ReadWrite`, `Contacts.ReadWrite.Shared`, `Calendars.ReadWrite`,
   `Calendars.ReadWrite.Shared`, `Calendars.Read.Shared`,
   `MailboxSettings.ReadWrite`, `Files.ReadWrite.All` und `Sites.Read.All`.
7. Den erforderlichen Administratoreinwilligungen des DMH-Tenants zustimmen.
8. Mandanten-ID und Anwendungs-ID notieren.

Für den Desktop-Flow mit PKCE ist kein Client-Secret erforderlich. Ein
Client-Secret darf niemals in den Desktop-Build aufgenommen werden. Die
Redirect-URI wird nur auf dem jeweiligen PC und nur während der Anmeldung
erreichbar gemacht.

## 2. GitHub-Variablen hinterlegen

Unter `Repository → Settings → Secrets and variables → Actions → Variables`:

| Variable | Inhalt |
|---|---|
| `M365_CLIENT_ID` | Anwendungs-ID der Entra-App |
| `M365_TENANT_ID` | Mandanten-ID des DMH-Tenants |

Beide Werte sind Identifikatoren, keine Kennwörter. Die Release-Workflows geben
sie beim Kompilieren an den Rust-Build weiter.

## 3. Lokal testen

Zum Bauen werden Rust, Node.js und das **.NET SDK 10** benötigt. Das
WAM-Hilfsprogramm wird samt .NET-Laufzeit und nativer MSAL-Bibliothek unter
`src-tauri/resources/m365-wam/` gebaut und mit dem Installer verteilt. Endnutzer
müssen .NET nicht installieren. Tauri baut das Hilfsprogramm automatisch vor
Entwicklungsstart und Release. Die Workflows installieren das SDK ebenfalls.

Die Variablen müssen gesetzt sein, bevor Rust kompiliert wird:

```powershell
$env:M365_CLIENT_ID = "<Anwendungs-ID>"
$env:M365_TENANT_ID = "<Mandanten-ID>"
npm run tauri:dev
```

`npm run tauri:dev` lädt fehlende öffentliche IDs aus den GitHub-Variablen.
Wenn die Werte geändert werden, die laufende Entwicklungs-App vollständig
beenden und neu bauen. Der Live-Entwicklungsstart verwendet dieselben lokalen
Daten und Synchronisierungseinstellungen wie die installierte App.

WAM benötigt eine aktive Windows-Benutzersitzung. Die App regulär als der
angemeldete Benutzer starten, nicht als Dienst oder als anderer Administrator.

## Sicherheit und Datenspeicherung

- Die App sieht oder speichert das Microsoft-Kennwort nicht.
- Das Kennwort wird ausschließlich auf der offiziellen Microsoft-Seite
  eingegeben.
- Der Browser-Login verwendet Authorization Code Flow mit PKCE und einen
  zufälligen Sicherheitswert; sein erneuerbarer Token bleibt DPAPI-geschützt.
- Beim WAM-Login verwaltet Windows die Erneuerungsdaten. Die App speichert nur
  den an Client und Mandant gebundenen Broker-Kontoverweis DPAPI-geschützt.
  Erneuerungen bleiben exakt an dieses Konto gebunden und wechseln nicht
  automatisch zu einem anderen Konto.
- Zugriffstokens bleiben im nativen Prozess und im privaten Pipe-Kanal zum
  Hilfsprogramm. Sie werden weder an die WebView noch an Protokolle oder
  Dateien übergeben. Das Hilfsprogramm speichert keinen eigenen Token-Cache.
- `Konto trennen` entfernt ausschließlich die lokale Verbindung dieser App;
  das Windows-Konto und andere Microsoft-Apps bleiben angemeldet.
- Bestehende Browser-Verbindungen bleiben lesbar und erneuerbar. Erfolgreiches
  Verbinden aktiviert wie bisher die automatische Synchronisierung gemäß den
  bestehenden Berechtigungen und konfigurierten Richtungen.

## Fehlersuche

- **Einrichtung durch die EDV erforderlich:** `M365_CLIENT_ID` war beim Build
  nicht gesetzt oder ungültig.
- **Microsoft-Anwendung ist nicht korrekt eingerichtet:** App-Registrierung,
  Mandant, öffentliche Clientflows und die Desktop-Redirect-URI
  prüfen. Bei `AADSTS50011` fehlt oder stimmt die zum jeweiligen Login passende
  Redirect-URI nicht; für WAM ist die BrokerPlugin-URI erforderlich.
- **Kein erneuerbarer Token:** `offline_access` oder öffentliche Clientflows
  wurden vom Tenant blockiert.
- **Anmeldung abgelaufen:** Konto in der App trennen und erneut verbinden;
  zusätzlich Entra-Anmeldeprotokolle und Conditional-Access-Regeln prüfen.
- **Windows-Anmeldung momentan nicht erreichbar:** Internetverbindung und
  WAM-Verfügbarkeit prüfen, erneut versuchen; bei dauerhaftem Problem erneut
  verbinden. Vorübergehende Ausfälle löschen die bestehende Verbindung nicht.
- Technische WAM-Codes bleiben in der EDV-Historie; Benutzer erhalten bei
  fehlgeschlagenem Verbinden einen kurzen Hinweis zum erneuten Versuch oder
  zur Auswahl eines anderen Kontos.

## Prüfungen

- `npm run prepare:wam-helper`: selbstständigen Windows-Helper bauen und
  Kontoauswahl/Diagnose-Redaktion prüfen.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: Kompatibilität alter
  Verbindungen, Kontobindung und Fehlerbehandlung prüfen.
- `npm test`: Windows-first-Button, explizite Browserauswahl, erneuter Versuch
  und Verbindungsprüfung testen.
- Der native Test `live_windows_login_and_renewal_use_private_pipes` ist
  standardmäßig deaktiviert. Er benötigt die öffentlichen Umgebungsvariablen
  `M365_WAM_TEST_CLIENT_ID` und `M365_WAM_TEST_TENANT_ID` und wird ausdrücklich
  mit `--ignored` ausgeführt. Er prüft stille Anmeldung, Graph-Identität und
  erneute Anmeldung an dasselbe Konto, ohne die App-Datenbank oder Exchange
  zu verändern oder Tokens auszugeben.
  Optional bestimmt `M365_WAM_TEST_LOGIN_HINT` das bereits bekannte
  Geschäftskonto auf PCs mit mehreren verbundenen Konten; dieser Hinweis
  enthält keinen Token und kein Kennwort.

Microsoft-Dokumentation:
[MSAL.NET und WAM](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/wam),
[stille Anmeldung vor interaktivem Login](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-acquire-token-wam).
