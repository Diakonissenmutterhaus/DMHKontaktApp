# KI lokal und zentral freigeben

KI ist standardmäßig verborgen, auch in Admin Test und Entwicklung. Die EDV
kann unter **EDV Tools → Erweitert → KI** eine zusätzliche lokale Freigabe
setzen. Sie bleibt auf diesem PC gespeichert. Die KI-Verwaltung innerhalb der
EDV ist auch bei verborgenem Benutzermenü erreichbar, um Inhalte vorzubereiten.
Das Ausblenden löscht weder Dokumente noch vorhandene Bestätigungen.

## Einrichtung der zentralen Steuerung

Die neue App-Version mit dem Rollout-Client muss einmalig auf die PCs gelangen.
Die offizielle Version 0.1.37 enthält diesen Client; Beta.81 und ältere
Versionen besitzen ihn nicht. Anschließend sind
für neue Freigabezeitpunkte keine App-Releases mehr erforderlich.

Der Workflow `.github/workflows/ki-rollout.yml` muss zuerst in der
Standardbranch des Repositorys vorhanden sein, damit GitHub seinen manuellen
Start anbietet. Er wird gemeinsam mit Version 0.1.37 auf main veröffentlicht.
Die zentrale Konfiguration beginnt mit `disabled`; das Veröffentlichen der
App allein aktiviert KI daher nicht für alle Benutzer.

Unter GitHub Actions **KI zentral freigeben → Run workflow** wählen:

- `disabled`: keine zentrale Freigabe; lokale EDV-Freigaben bleiben wirksam.
- `immediate`: KI auf allen erreichbaren neuen Clients freigeben.
- `scheduled`: freigeben ab `activate_at`, beispielsweise
  `2026-12-01T08:00:00+01:00` (8 Uhr in Deutschland im Winter).

Zeitangaben verlangen Sekunden und eine explizite Zeitzone. Im Sommer gilt in
Deutschland +02:00. Der Workflow normalisiert den Zeitpunkt auf UTC und schreibt
nur `ki.json` auf die separate Branch `feature-flags`. Er schreibt nicht auf
main und baut keinen Installer. GitHub-Schreibrechte sind Voraussetzung;
ein EDV-Passwort allein gewährt keine GitHub-Berechtigung. Der App wird kein
administratives GitHub-Token mitgegeben.

## Verhalten der PCs

Der native Client liest ausschließlich die feste HTTPS-Adresse auf
raw.githubusercontent.com. Er prüft Schema, Datumsformat und Größe (maximal
8 KiB), folgt keinen Weiterleitungen und führt keine empfangenen Inhalte aus.
Es werden keine Benutzerdaten hochgeladen. Die Abfrage erfolgt beim Start,
nach Rückkehr zum geöffneten App-Fenster, bei wiederhergestellter Verbindung
und ungefähr alle 60 Sekunden. Netzwerk/CDN-Zwischenspeicher können die
Auslieferung verzögern: eine Freigabe ist kein garantierter Push in Echtzeit.

Die letzte gültige Konfiguration wird lokal gespeichert. Ein bereits geladener
Termin aktiviert KI auch offline, wenn die lokale PC-Uhr den Zeitpunkt erreicht.
Ein ausgeschalteter oder bislang nicht erreichbarer PC empfängt die Freigabe
erst nach erneutem Öffnen/Verbinden. Netzwerkfehler, ungültige Antworten und
ältere Konfigurationen überschreiben die letzte gültige Freigabe nicht.
Vor dem ersten gültigen Abruf bleibt KI ohne lokale Freigabe verborgen.

Die wirksame Freigabe ist **lokal ODER zentral**. Ein lokales Ausschalten
überstimmt daher keine zentrale Freigabe. Die zentrale Steuerung betrifft nur
die Sichtbarkeit; EDV-Schreibrechte, Veröffentlichung von Richtlinien und
Zugriff auf persönliche Nachweise behalten ihre eigenen Prüfungen.
Eine bereits geöffnete KI-Seite bleibt bei einer späteren zentralen Sperre
bis zum Verlassen erhalten, um ungespeicherte Formulare nicht zu verlieren.

## Lokale Prüfung ohne Veröffentlichung

`scripts/test-ki-rollout-workflow.ps1` führt das originale Workflow-Skript
gegen eine simulierte GitHub-API aus: neue/bestehende Branch, alle drei Modi,
Zeitzonen und ungültige Eingaben. Dabei findet kein Netzwerkzugriff statt.
