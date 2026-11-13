# Windows-Updates ohne Administratorabfrage

## Installation und Zuständigkeit

| Installation | Updateweg |
| --- | --- |
| NSIS-EXE, im Benutzerkontext unter LocalAppData installiert | In der App: Download mit Fortschritt, signierte Prüfung, stille Installation und automatischer Neustart |
| MSI oder Installation unter Program Files / für alle Benutzer | Biteno Endpoint Agent / zentrale Softwareverteilung mit SYSTEM-Rechten |
| Unbekannte, nicht beschreibbare oder widersprüchliche Installation | Keine Installation durch die App; EDV prüft die Verteilung |

Der NSIS-Installer ist ausdrücklich auf `currentUser` eingestellt. Der Tauri-Updater verwendet `quiet` (NSIS: `/S /R`). UAC und Windows-Berechtigungen werden nicht verändert.

Der native Befehl prüft vor dem Download und erneut vor der Installation:

- Die laufende EXE stammt aus einem NSIS-Paket.
- Es gibt keine gleichnamige Installation in HKLM (32- und 64-Bit-Sicht). Insbesondere darf NSIS keine alte MSI-Installation entfernen.
- Der tatsächliche, aufgelöste Installationspfad liegt unter LocalAppData dieses Benutzers und stimmt mit dessen HKCU-Installationsregistrierung überein.
- Das Installationsverzeichnis ist beschreibbar.

Bei unbekanntem Zustand wird kein Installer gestartet. Die Weboberfläche kann die allgemeinen Installationsbefehle des Updater-Plugins nicht mehr direkt verwenden. Signaturprüfung und Download bleiben beim Tauri-Updater. Gleichzeitige Installationen sind im Frontend und im nativen Prozess gesperrt.

## Einmalige Umstellung bestehender PCs

Bereits ausgelieferte Versionen enthalten diese Prüfung noch nicht. Ein neuer Release ändert deren Installationsrechte und bisherigen Updater nicht rückwirkend. Den ersten korrigierten Build daher über die Biteno-Verteilung ausrollen.

Für künftige Selbstupdates die NSIS-EXE **im Kontext des angemeldeten Benutzers** ausführen. Nicht als SYSTEM installieren: Das würde in das Profil des Dienstkontos schreiben. Beispiel für eine von der EDV freigegebene, lokal bereitgestellte EXE:

```powershell
Start-Process -FilePath 'C:\Deployment\DMH-Backup-setup.exe' -ArgumentList '/S' -Wait -WindowStyle Hidden
```

Existiert eine MSI-Installation, muss deren Entfernung/Umstellung zuerst zentral mit den vorhandenen Agent-Rechten erfolgen. Benutzerdaten unter AppData bleiben erhalten; vor der Umstellung den Datenbestand sichern und auf einem Pilot-PC prüfen. Nicht parallel MSI und NSIS desselben Produkts weiter verteilen.

Alternativ MSI als zentral verwaltetes Produkt beibehalten. Dann verteilt die Biteno-Konsole jede neue MSI unter SYSTEM, ohne Benutzerdialog:

```powershell
$process = Start-Process msiexec.exe -ArgumentList '/i "C:\Deployment\DMH-Backup.msi" /qn /norestart' -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -notin @(0, 3010)) { throw "MSI-Update fehlgeschlagen: $($process.ExitCode)" }
```

Diese Befehle sind für die Softwareverteilung, nicht für Standardbenutzer. Der App-Button kann den Biteno-Agent nicht selbst beauftragen: Dafür ist keine Agent-Schnittstelle konfiguriert. Die App meldet bei verwalteten Installationen, dass Updates durch die EDV verteilt werden.

## Prüfung vor Verteilung

- Standardbenutzer, per-user NSIS: Update mit gültiger Signatur; kein UAC/Installerfenster; App startet mit neuer Version und vorhandenen Daten.
- Machine-MSI und parallele MSI/NSIS: App startet keinen Installer und bleibt geöffnet.
- Netzwerk-/Signaturfehler: kein Neustart, keine Erfolgsmeldung; erneuter Versuch möglich.
- AD/AppLocker/WDAC-Richtlinien können Benutzerinstallationen oder deren Start verhindern. Solche PCs zentral verwalten.

Der Fortschritt zeigt den tatsächlichen Downloadanteil; während Installation/Neustart bleibt er unbestimmt. Der alte Prozess meldet nicht vorzeitig „abgeschlossen“. Nach dem Installerstart beendet Tauri den alten Prozess; während des eigentlichen Dateiaustauschs kann dessen Ladefenster nicht weiter sichtbar bleiben.

Referenzen: [Tauri Updater](https://v2.tauri.app/plugin/updater/), [Windows-Installer](https://v2.tauri.app/distribute/windows-installer/).
