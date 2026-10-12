# Textos de erro definidos no backend nativo

394 textos candidatos encontrados em chamadas de erro/aviso do código Rust, antes dos módulos de teste. **Um texto estar aqui não significa que aparece ao usuário.** O frontend pode capturá-lo silenciosamente, exibi-lo na EDV ou concatená-lo em `String(error)`. É necessário verificar a propagação antes de aplicar a classificação. Esta lista é auxiliar, não uma contagem de notificações visíveis. Erros externos e mensagens do sistema continuam dinâmicos.

| ID | Fonte | Texto definido no código | Decisão |
| --- | --- | --- | --- |
| B001 | src-tauri/src/calendar_import.rs:L152 | Kalenderdatei konnte nicht geöffnet werden: {error} | Pendente |
| B002 | src-tauri/src/calendar_import.rs:L154 | Die ausgewählte Kalenderdatei existiert nicht mehr. | Pendente |
| B003 | src-tauri/src/calendar_import.rs:L162 | Für den sicheren Großimport werden ICS- oder EML-Dateien unterstützt. | Pendente |
| B004 | src-tauri/src/calendar_import.rs:L239 | Ein Kalenderimport läuft bereits. | Pendente |
| B005 | src-tauri/src/calendar_import.rs:L306 | Importauftrag konnte nicht angelegt werden. | Pendente |
| B006 | src-tauri/src/calendar_import.rs:L337 | Der Importauftrag wurde nicht gefunden. | Pendente |
| B007 | src-tauri/src/calendar_import.rs:L352 | Der laufende Import muss zuerst pausiert werden. | Pendente |
| B008 | src-tauri/src/calendar_import.rs:L393 | Kalenderimport wurde unerwartet beendet: {error} | Pendente |
| B009 | src-tauri/src/calendar_import.rs:L441 | Nach Beginn des Imports können Ersatzkategorie und Farbe nicht mehr geändert werden. | Pendente |
| B010 | src-tauri/src/calendar_import.rs:L724 | Serientermin ist beschädigt: {error} | Pendente |
| B011 | src-tauri/src/documents.rs:L302 | Das Dokument konnte nicht geöffnet werden: {error} | Pendente |
| B012 | src-tauri/src/documents.rs:L339 | Unbekannter Dokumentquellen-Bereich. | Pendente |
| B013 | src-tauri/src/documents.rs:L451 | Der Stammordner des Zielorts konnte nicht ermittelt werden. | Pendente |
| B014 | src-tauri/src/documents.rs:L484 | Der neue Ordner konnte nicht ausgewertet werden. | Pendente |
| B015 | src-tauri/src/documents.rs:L613 | Die lokale Datei enthält noch nicht hochgeladene Änderungen. Sie wurde nicht überschrieben. Laden Sie zuerst die lokale Änderung hoch oder speichern Sie sie unter einem anderen Namen. | Pendente |
| B016 | src-tauri/src/documents.rs:L684 | Bitte geben Sie einen gültigen Ordnernamen ein. | Pendente |
| B017 | src-tauri/src/documents.rs:L707 | Bitte geben Sie einen gültigen Namen ein. | Pendente |
| B018 | src-tauri/src/documents.rs:L722 | Das umbenannte Element konnte nicht ausgewertet werden. | Pendente |
| B019 | src-tauri/src/documents.rs:L830 | Microsoft 365 hat keine Adresse zur Überwachung des Kopiervorgangs geliefert. | Pendente |
| B020 | src-tauri/src/documents.rs:L855 | Der Kopierstatus konnte nicht gelesen werden: {error} | Pendente |
| B021 | src-tauri/src/documents.rs:L865 | Der Kopiervorgang dauert ungewöhnlich lange. Das Original wurde sicherheitshalber nicht gelöscht. | Pendente |
| B022 | src-tauri/src/documents.rs:L929 | Kopieren fehlgeschlagen; das Original bleibt erhalten: {error} | Pendente |
| B023 | src-tauri/src/documents.rs:L947 | Das Element wurde verschoben, aber der Offline-Status konnte nicht bereinigt werden: {error} | Pendente |
| B024 | src-tauri/src/documents.rs:L950 | Die Kopie wurde erstellt, aber das Original konnte nicht in den Papierkorb verschoben werden: {error} | Pendente |
| B025 | src-tauri/src/documents.rs:L1019 | Bitte geben Sie einen gültigen Dateinamen ein. | Pendente |
| B026 | src-tauri/src/documents.rs:L1046 | Die neue Datei konnte nicht ausgewertet werden. | Pendente |
| B027 | src-tauri/src/documents.rs:L1076 | Microsoft 365 hat keinen Freigabelink zurückgegeben. | Pendente |
| B028 | src-tauri/src/documents.rs:L1171 | Upload fehlgeschlagen ({status}): {detail} | Pendente |
| B029 | src-tauri/src/documents.rs:L1240 | Microsoft 365 hat keine Upload-Adresse zurückgegeben. | Pendente |
| B030 | src-tauri/src/documents.rs:L1256 | Der Upload wurde unerwartet beendet. | Pendente |
| B031 | src-tauri/src/documents.rs:L1275 | Upload fehlgeschlagen ({status}): {} | Pendente |
| B032 | src-tauri/src/documents.rs:L1336 | Download fehlgeschlagen: {} | Pendente |
| B033 | src-tauri/src/documents.rs:L1387 | Die aktualisierte Datei konnte nicht ausgewertet werden. | Pendente |
| B034 | src-tauri/src/documents.rs:L1548 | Bitte wählen Sie eine Datei aus. | Pendente |
| B035 | src-tauri/src/documents.rs:L1557 | Der Dateiname konnte nicht gelesen werden. | Pendente |
| B036 | src-tauri/src/documents.rs:L1587 | Die hochgeladene Datei konnte nicht ausgewertet werden. | Pendente |
| B037 | src-tauri/src/documents.rs:L1619 | Die ausgewählte Datei oder der Ordner wurde nicht gefunden. | Pendente |
| B038 | src-tauri/src/documents.rs:L1640 | Der Ordnername konnte nicht gelesen werden. | Pendente |
| B039 | src-tauri/src/documents.rs:L1700 | Die lokale Datei wurde nicht gefunden. | Pendente |
| B040 | src-tauri/src/documents.rs:L1705 | Die Online-Datei wurde gelöscht. | Pendente |
| B041 | src-tauri/src/documents.rs:L1708 | Konflikt: Die Online-Datei wurde seit dem Offline-Download geändert. Laden Sie zuerst die aktuelle Version herunter oder öffnen Sie beide Versionen zum Vergleichen. | Pendente |
| B042 | src-tauri/src/documents.rs:L1940 | Der Konflikt wurde bereits gelöst oder nicht gefunden. | Pendente |
| B043 | src-tauri/src/documents.rs:L1943 | Die lokale Konfliktdatei wurde nicht gefunden. | Pendente |
| B044 | src-tauri/src/documents.rs:L2065 | Unbekannte Konfliktentscheidung. | Pendente |
| B045 | src-tauri/src/file_icons.rs:L61 | Windows konnte kein Explorer-Symbol für {extension} liefern. | Pendente |
| B046 | src-tauri/src/file_icons.rs:L71 | Windows konnte keine Zeichenfläche für das Dateisymbol erstellen. | Pendente |
| B047 | src-tauri/src/file_icons.rs:L162 | Systemsymbole sind auf dieser Plattform noch nicht verfügbar. | Pendente |
| B048 | src-tauri/src/lib.rs:L892 | Datenbank konnte nicht gesperrt werden. | Pendente |
| B049 | src-tauri/src/lib.rs:L912 | App-Datenverzeichnis konnte nicht erstellt werden: {err} | Pendente |
| B050 | src-tauri/src/lib.rs:L922 | Datenbankpfad konnte nicht gesetzt werden. | Pendente |
| B051 | src-tauri/src/lib.rs:L1494 | Gespeicherter Kalendertermin ist beschädigt: {error} | Pendente |
| B052 | src-tauri/src/lib.rs:L1556 | Ein Kalendertermin ohne technische ID kann nicht gespeichert werden. | Pendente |
| B053 | src-tauri/src/lib.rs:L2060 | Ausstehender Kalendertermin ist beschädigt: {error} | Pendente |
| B054 | src-tauri/src/lib.rs:L2229 | Der Termin konnte nicht mit einer leeren ID verknüpft werden. | Pendente |
| B055 | src-tauri/src/lib.rs:L2243 | Der lokale Termin wurde nicht gefunden; die Verknüpfung wurde nicht übernommen. | Pendente |
| B056 | src-tauri/src/lib.rs:L2259 | Der Exchange-Termin ist bereits lokal vorhanden. Beide Termine wurden beibehalten; eine automatische Zusammenführung ist nicht sicher. | Pendente |
| B057 | src-tauri/src/lib.rs:L2302 | Der lokale Termin konnte nicht sicher mit Exchange verknüpft werden. | Pendente |
| B058 | src-tauri/src/lib.rs:L2527 | Diese Funktion ist ausschließlich in der administrativen App-Version verfügbar. | Pendente |
| B059 | src-tauri/src/lib.rs:L2545 | Dokumente-Ordner konnte nicht ermittelt werden: {error} | Pendente |
| B060 | src-tauri/src/lib.rs:L2548 | Automatischer Backup-Ordner konnte nicht erstellt werden: {error} | Pendente |
| B061 | src-tauri/src/lib.rs:L2557 | AppData-Ordner konnte nicht ermittelt werden: {error} | Pendente |
| B062 | src-tauri/src/lib.rs:L2560 | AppData-Backup-Ordner konnte nicht erstellt werden: {error} | Pendente |
| B063 | src-tauri/src/lib.rs:L2590 | Backup-Snapshots konnten nicht gelesen werden: {error} | Pendente |
| B064 | src-tauri/src/lib.rs:L2593 | Backup-Snapshot konnte nicht gelesen werden: {error} | Pendente |
| B065 | src-tauri/src/lib.rs:L2840 | Backup-Datei konnte nicht ersetzt werden. | Pendente |
| B066 | src-tauri/src/lib.rs:L2871 | Die Sicherung ist für die Windows-Verschlüsselung zu groß. | Pendente |
| B067 | src-tauri/src/lib.rs:L2892 | Windows konnte die Sicherung nicht verschlüsseln: {error} | Pendente |
| B068 | src-tauri/src/lib.rs:L2894 | Windows hat keine verschlüsselte Sicherung geliefert. | Pendente |
| B069 | src-tauri/src/lib.rs:L2913 | Die verschlüsselte Sicherung ist ungültig. | Pendente |
| B070 | src-tauri/src/lib.rs:L2935 | Die Sicherung gehört zu einem anderen Windows-Benutzer oder Computer. | Pendente |
| B071 | src-tauri/src/lib.rs:L2938 | Die verschlüsselte Sicherung ist beschädigt. | Pendente |
| B072 | src-tauri/src/lib.rs:L2953 | Verschlüsselte automatische Sicherungen werden derzeit nur unter Windows unterstützt. | Pendente |
| B073 | src-tauri/src/lib.rs:L2983 | Die verschlüsselte Sicherung hat ein unbekanntes Format. | Pendente |
| B074 | src-tauri/src/lib.rs:L2989 | Die verschlüsselte Sicherung ist beschädigt: {error} | Pendente |
| B075 | src-tauri/src/lib.rs:L3000 | Die Sicherung {} ist keine gültige Datei. | Pendente |
| B076 | src-tauri/src/lib.rs:L3003 | Die Sicherung {} ist beschädigt: {error} | Pendente |
| B077 | src-tauri/src/lib.rs:L3107 | Automatischer Backup konnte nicht gelesen werden: {error} | Pendente |
| B078 | src-tauri/src/lib.rs:L3323 | Interner Wiederherstellungsordner konnte nicht ermittelt werden: {error} | Pendente |
| B079 | src-tauri/src/lib.rs:L3327 | Interner Wiederherstellungsordner konnte nicht erstellt werden: {error} | Pendente |
| B080 | src-tauri/src/lib.rs:L3335 | Wiederherstellungspunkte konnten nicht gelesen werden: {error} | Pendente |
| B081 | src-tauri/src/lib.rs:L3849 | Das Abschlussarchiv ist beschädigt: {error} | Pendente |
| B082 | src-tauri/src/lib.rs:L3852 | Es ist noch kein Abschlussarchiv vorhanden. | Pendente |
| B083 | src-tauri/src/lib.rs:L3878 | Noch kein Hintergrund-Backup vorhanden. | Pendente |
| B084 | src-tauri/src/lib.rs:L3885 | Unbekannte Backup-Quelle. | Pendente |
| B085 | src-tauri/src/lib.rs:L4270 | Backup-Vorschau konnte nicht ausgeführt werden: {error} | Pendente |
| B086 | src-tauri/src/lib.rs:L4570 | Wiederherstellung konnte nicht ausgeführt werden: {error} | Pendente |
| B087 | src-tauri/src/lib.rs:L4577 | Lokaler Sicherungsverlauf konnte nicht aktualisiert werden: {error} | Pendente |
| B088 | src-tauri/src/lib.rs:L5326 | Der ausgewählte Papierkorb-Bereich ist ungültig. | Pendente |
| B089 | src-tauri/src/lib.rs:L5340 | Kalenderdaten im automatischen Backup sind beschädigt: {error} | Pendente |
| B090 | src-tauri/src/lib.rs:L5447 | Der ausgewählte Löschzeitraum ist ungültig. | Pendente |
| B091 | src-tauri/src/lib.rs:L5909 | Automatische Sicherung konnte nicht ausgeführt werden: {error} | Pendente |
| B092 | src-tauri/src/lib.rs:L5955 | Es ist noch kein Wiederherstellungspunkt vorhanden. | Pendente |
| B093 | src-tauri/src/lib.rs:L6007 | Für diese Wiederherstellung ist der Freigabecode der EDV erforderlich (Format EDV-...). | Pendente |
| B094 | src-tauri/src/lib.rs:L6020 | Es ist noch keine automatische Sicherung vorhanden. | Pendente |
| B095 | src-tauri/src/lib.rs:L6022 | Die automatische Sicherung ist beschädigt oder stammt aus einer unbekannten Version: {error} | Pendente |
| B096 | src-tauri/src/lib.rs:L6255 | Datei konnte nicht geschrieben werden: {err} | Pendente |
| B097 | src-tauri/src/lib.rs:L6260 | Sicheres Löschen konnte nicht aktiviert werden: {error} | Pendente |
| B098 | src-tauri/src/lib.rs:L6290 | Lokale Datenbank konnte nicht geleert werden: {error} | Pendente |
| B099 | src-tauri/src/lib.rs:L6295 | Lokale Kalenderdaten konnten nicht geleert werden: {error} | Pendente |
| B100 | src-tauri/src/lib.rs:L6300 | Lokale Datenbank konnte nicht zurückgesetzt werden: {error} | Pendente |
| B101 | src-tauri/src/lib.rs:L6309 | Die gespeicherten E-Mail-Kennwörter konnten nicht sicher entfernt werden. Es wurden noch keine App-Daten gelöscht. {error} | Pendente |
| B102 | src-tauri/src/lib.rs:L6330 | Outlook-Zwischenspeicher konnte nicht geleert werden. | Pendente |
| B103 | src-tauri/src/lib.rs:L6436 | Kontakt wurde nicht gefunden oder ist gelöscht. | Pendente |
| B104 | src-tauri/src/lib.rs:L6447 | Gruppe wurde nicht gefunden oder ist gelöscht. | Pendente |
| B105 | src-tauri/src/lib.rs:L6522 | Outlook Classic konnte nicht geöffnet werden: {err} | Pendente |
| B106 | src-tauri/src/lib.rs:L6526 | Outlook Classic konnte nicht geöffnet werden. | Pendente |
| B107 | src-tauri/src/lib.rs:L6563 | Das neue Outlook konnte nicht geöffnet werden: {err} | Pendente |
| B108 | src-tauri/src/lib.rs:L6574 | Keine gültigen E-Mail-Adressen gefunden. | Pendente |
| B109 | src-tauri/src/lib.rs:L6855 | Outlook Classic konnte nicht gestartet werden: {err} | Pendente |
| B110 | src-tauri/src/lib.rs:L6860 | Outlook Classic konnte nicht gelesen werden. Prüfen Sie, ob Outlook Classic installiert und eingerichtet ist. {stderr} | Pendente |
| B111 | src-tauri/src/lib.rs:L6866 | Outlook-Kontakte konnten nicht ausgewertet werden: {err} | Pendente |
| B112 | src-tauri/src/lib.rs:L6875 | Die Outlook-Autovervollständigung wird aus dem zuletzt gespeicherten lokalen Cache gelesen. Sehr neue Empfänger erscheinen möglicherweise erst, nachdem Outlook Classic vollständig beendet wurde. | Pendente |
| B113 | src-tauri/src/lib.rs:L8144 | Outlook-Kontaktprüfung wurde unerwartet beendet: {error} | Pendente |
| B114 | src-tauri/src/lib.rs:L8153 | Bitte wählen Sie mindestens eine Outlook-Quelle aus. | Pendente |
| B115 | src-tauri/src/lib.rs:L8328 | Outlook-Kontaktimport wurde unerwartet beendet: {error} | Pendente |
| B116 | src-tauri/src/lib.rs:L8665 | Outlook Classic konnte nicht aktualisiert werden: {err} | Pendente |
| B117 | src-tauri/src/lib.rs:L8673 | Outlook Classic konnte den Kontakt nicht löschen. {stderr} | Pendente |
| B118 | src-tauri/src/lib.rs:L9090 | Outlook Classic konnte nicht aktualisiert werden. {stderr} | Pendente |
| B119 | src-tauri/src/lib.rs:L9096 | Outlook-Aktualisierung konnte nicht ausgewertet werden: {err}. Ausgabe: {stdout} | Pendente |
| B120 | src-tauri/src/lib.rs:L9105 | Outlook-Link konnte nicht zugeordnet werden: {err} | Pendente |
| B121 | src-tauri/src/lib.rs:L9551 | Outlook Classic konnte nicht gelesen werden: {err} | Pendente |
| B122 | src-tauri/src/lib.rs:L9556 | Outlook-Kontaktordner konnten nicht gelesen werden. {stderr} | Pendente |
| B123 | src-tauri/src/lib.rs:L9571 | Outlook-Kontaktordner konnten nicht ausgewertet werden: {err}. Ausgabe: {stdout} | Pendente |
| B124 | src-tauri/src/lib.rs:L9724 | Outlook Classic konnte nicht geprüft werden: {error} | Pendente |
| B125 | src-tauri/src/lib.rs:L9727 | Outlook Classic ist nicht erreichbar oder noch nicht eingerichtet. | Pendente |
| B126 | src-tauri/src/lib.rs:L9733 | Outlook-Kalenderquellen konnten nicht ausgewertet werden: {error} | Pendente |
| B127 | src-tauri/src/lib.rs:L9982 | Outlook-Kalender konnten nicht gelesen werden. Prüfen Sie, ob Outlook Classic installiert und eingerichtet ist. {stderr} | Pendente |
| B128 | src-tauri/src/lib.rs:L9988 | Outlook-Termine konnten nicht ausgewertet werden: {err} | Pendente |
| B129 | src-tauri/src/lib.rs:L10269 | Thunderbird-Kalenderdaten konnten nicht übernommen werden: {error} | Pendente |
| B130 | src-tauri/src/lib.rs:L10421 | Outlook-Import konnte nicht gestartet werden: {err} | Pendente |
| B131 | src-tauri/src/lib.rs:L10426 | PST/OST konnte nicht gelesen werden. Outlook Classic muss installiert sein. {stderr} | Pendente |
| B132 | src-tauri/src/lib.rs:L10432 | Outlook-Daten konnten nicht ausgewertet werden: {err}. Ausgabe: {stdout} | Pendente |
| B133 | src-tauri/src/lib.rs:L10435 | Outlook-Datendatei wurde geöffnet, aber es wurden keine Kontakte oder Kalendertermine gefunden. Prüfen Sie, ob die PST/OST Kontakte oder Kalender enthält und ob Outlook Classic Zugriff auf diese Datei hat. | Pendente |
| B134 | src-tauri/src/m365/calendar_transfer.rs:L37 | Eine Kalender-Verschiebung ist noch nicht abgeschlossen. Die automatische Ausgangssynchronisierung setzt sie fort, bevor Kalender erneut eingelesen werden. | Pendente |
| B135 | src-tauri/src/m365/calendar_transfer.rs:L54 | Die bisherige Verschiebung muss zuerst mit dem bisherigen Zielkalender abgeschlossen werden. Der ursprüngliche Termin konnte nicht bestätigt werden; die Zielkopie wurde beibehalten. | Pendente |
| B136 | src-tauri/src/m365/calendar_transfer.rs:L60 | Die noch offene Kalender-Verschiebung hat keinen Zielpfad. | Pendente |
| B137 | src-tauri/src/m365/calendar_transfer.rs:L79 | Besprechungen mit Teilnehmern bleiben im bisherigen Kalender. Neue Einladungen und Absagen sind für eine Verschiebung nicht freigegeben. | Pendente |
| B138 | src-tauri/src/m365/calendar_transfer.rs:L82 | Eine empfangene Besprechung kann hier nicht mit einem anderen Organisator neu erstellt werden. | Pendente |
| B139 | src-tauri/src/m365/calendar_transfer.rs:L87 | Eine bestehende Online-Besprechung bitte in Outlook verschieben, damit der ursprüngliche Teams-Link erhalten bleibt. | Pendente |
| B140 | src-tauri/src/m365/calendar_transfer.rs:L90 | Termine mit Anhängen bitte in Outlook verschieben, damit alle Anhänge erhalten bleiben. | Pendente |
| B141 | src-tauri/src/m365/calendar_transfer.rs:L99 | Terminserien und Serienausnahmen bitte in Outlook verschieben, damit alle Wiederholungen und Ausnahmen erhalten bleiben. | Pendente |
| B142 | src-tauri/src/m365/calendar_transfer.rs:L152 | Kein Zielkalender gewählt. | Pendente |
| B143 | src-tauri/src/m365/calendar_transfer.rs:L206 | Exchange enthält mehrere Kopien dieser Verschiebung. Der ursprüngliche Termin wurde beibehalten. | Pendente |
| B144 | src-tauri/src/m365/calendar_transfer.rs:L221 | Exchange hat keine Termin-ID für den Zielkalender zurückgegeben. Der ursprüngliche Termin wurde beibehalten. | Pendente |
| B145 | src-tauri/src/m365/calendar_transfer.rs:L270 | Der ursprüngliche Termin wurde zwischenzeitlich in Exchange geändert. Beide Kopien wurden beibehalten; die Verschiebung wurde nicht durch Löschen abgeschlossen. | Pendente |
| B146 | src-tauri/src/m365/category_management.rs:L24 | Eine Kategorienänderung ist noch offen. Öffnen Sie „Kategorien verwalten“ und setzen Sie sie fort; die Kalendersynchronisierung wartet bis zum Abschluss. | Pendente |
| B147 | src-tauri/src/m365/category_management.rs:L86 | Der sichere M365-Testmodus sperrt Änderungen. | Pendente |
| B148 | src-tauri/src/m365/category_management.rs:L92 | Ungültiger Kategoriename. | Pendente |
| B149 | src-tauri/src/m365/category_management.rs:L260 | Exchange hat einen Termin ohne Kennung geliefert. | Pendente |
| B150 | src-tauri/src/m365/category_management.rs:L278 | Exchange hat die geänderten Terminkategorien noch nicht bestätigt. Bitte fortsetzen. | Pendente |
| B151 | src-tauri/src/m365/category_management.rs:L326 | Bitte wählen Sie eine Kategorie aus. | Pendente |
| B152 | src-tauri/src/m365/category_management.rs:L335 | Bitte geben Sie einen gültigen neuen Kategorienamen an (höchstens 255 Zeichen). | Pendente |
| B153 | src-tauri/src/m365/category_management.rs:L340 | Bitte wählen Sie einen anderen Kategorienamen. | Pendente |
| B154 | src-tauri/src/m365/category_management.rs:L347 | Bitte zuerst die offene Kategorienänderung fortsetzen. | Pendente |
| B155 | src-tauri/src/m365/category_management.rs:L368 | Eine Kategorie mit diesem Namen existiert bereits. | Pendente |
| B156 | src-tauri/src/m365/category_management.rs:L385 | Exchange hat die neue Kategorie noch nicht bestätigt. | Pendente |
| B157 | src-tauri/src/m365/category_management.rs:L392 | Der Kalender „{}“ enthält die Kategorie, ist aber schreibgeschützt. Die Änderung ist noch offen. | Pendente |
| B158 | src-tauri/src/m365/category_management.rs:L415 | Exchange hat die Löschung noch nicht bestätigt. Bitte fortsetzen. | Pendente |
| B159 | src-tauri/src/m365/event_sync.rs:L250 | Eine bestehende Teams-Besprechung kann in Exchange nicht in einen Offline-Termin umgewandelt werden. Der Teams-Link bleibt erhalten. | Pendente |
| B160 | src-tauri/src/m365/event_sync.rs:L301 | Der Inhalt der Teams-Besprechung fehlt; die Beschreibung wurde nicht überschrieben. | Pendente |
| B161 | src-tauri/src/m365/event_sync.rs:L304 | Der geschützte Teams-Besprechungsblock konnte nicht erkannt werden. Bitte die Beschreibung dieses Termins in Outlook bearbeiten; der bestehende Link wurde nicht verändert. | Pendente |
| B162 | src-tauri/src/m365/event_sync.rs:L310 | Der Teams-Besprechungsblock ist unvollständig; die Beschreibung wurde nicht überschrieben. | Pendente |
| B163 | src-tauri/src/m365/event_sync.rs:L452 | Ungültiger Exchange-Terminpfad. | Pendente |
| B164 | src-tauri/src/m365.rs:L550 | Microsoft hat eine ungültige Rückmeldung geliefert. | Pendente |
| B165 | src-tauri/src/m365.rs:L554 | Die Microsoft-Anmeldung wurde abgebrochen. | Pendente |
| B166 | src-tauri/src/m365.rs:L556 | Microsoft konnte die Anmeldung nicht abschließen. | Pendente |
| B167 | src-tauri/src/m365.rs:L563 | Microsoft hat keinen Anmeldecode zurückgegeben. | Pendente |
| B168 | src-tauri/src/m365.rs:L568 | Microsoft hat die Anmeldung nicht eindeutig bestätigt. | Pendente |
| B169 | src-tauri/src/m365.rs:L575 | Microsoft-Rückmeldung konnte nicht gelesen werden. | Pendente |
| B170 | src-tauri/src/m365.rs:L584 | Microsoft hat eine leere Rückmeldung geliefert. | Pendente |
| B171 | src-tauri/src/m365.rs:L601 | Microsoft-Anmeldung konnte intern nicht gelesen werden. | Pendente |
| B172 | src-tauri/src/m365.rs:L611 | Microsoft-Anmeldung konnte intern nicht beendet werden. | Pendente |
| B173 | src-tauri/src/m365.rs:L630 | Die Microsoft-Anmeldung hat zu lange gedauert. Versuchen Sie es erneut. | Pendente |
| B174 | src-tauri/src/m365.rs:L644 | Die Microsoft-Anmeldung konnte aus Sicherheitsgründen nicht bestätigt werden. | Pendente |
| B175 | src-tauri/src/m365.rs:L653 | Die automatische Rückkehr von Microsoft konnte nicht empfangen werden. | Pendente |
| B176 | src-tauri/src/m365.rs:L742 | Das gespeicherte Microsoft-365-Kontoprofil ist ungültig. | Pendente |
| B177 | src-tauri/src/m365.rs:L753 | Der sichere M365-Test hat kein verbundenes Konto. | Pendente |
| B178 | src-tauri/src/m365.rs:L757 | Der sichere M365-Test wurde wegen eines anderen Microsoft-Kontos unterbrochen. | Pendente |
| B179 | src-tauri/src/m365.rs:L766 | Microsoft-365-Konto ist nicht verbunden. | Pendente |
| B180 | src-tauri/src/m365.rs:L780 | Microsoft-Anmeldung konnte nicht sicher gespeichert werden. | Pendente |
| B181 | src-tauri/src/m365.rs:L785 | Microsoft-Kontoprofil konnte nicht gespeichert werden. | Pendente |
| B182 | src-tauri/src/m365.rs:L799 | Die gespeicherte Microsoft-Anmeldung ist ungültig. | Pendente |
| B183 | src-tauri/src/m365.rs:L802 | Die gespeicherte Microsoft-Anmeldung konnte nicht gelesen werden. | Pendente |
| B184 | src-tauri/src/m365.rs:L815 | Microsoft Graph ist derzeit nicht erreichbar. Internetverbindung prüfen. | Pendente |
| B185 | src-tauri/src/m365.rs:L819 | Microsoft Graph hat die Verbindung nicht bestätigt (HTTP {}). | Pendente |
| B186 | src-tauri/src/m365.rs:L826 | Microsoft Graph hat ein ungültiges Kontoprofil geliefert. | Pendente |
| B187 | src-tauri/src/m365.rs:L839 | Die EDV muss zuerst die Microsoft-Anwendungs-ID für diesen Build hinterlegen. | Pendente |
| B188 | src-tauri/src/m365.rs:L853 | Microsoft-365-Kontoprofil fehlt. Verbinden Sie das Konto erneut. | Pendente |
| B189 | src-tauri/src/m365.rs:L865 | Microsoft-Anmeldung konnte intern nicht zwischengespeichert werden. | Pendente |
| B190 | src-tauri/src/m365.rs:L950 | Microsoft Graph hat eine ungültige Antwort geliefert. | Pendente |
| B191 | src-tauri/src/m365.rs:L975 | Microsoft Graph konnte die Daten nicht lesen (HTTP {}){}. | Pendente |
| B192 | src-tauri/src/m365.rs:L981 | Microsoft Graph ist nach mehreren Versuchen nicht erreichbar. Internetverbindung prüfen{}. | Pendente |
| B193 | src-tauri/src/m365.rs:L999 | Microsoft Graph lieferte ungewöhnlich viele Seiten. Die Synchronisierung wurde sicher abgebrochen. | Pendente |
| B194 | src-tauri/src/m365.rs:L1357 | Microsoft Graph lieferte ungewöhnlich viele Delta-Seiten. Die Synchronisierung wurde sicher unterbrochen. | Pendente |
| B195 | src-tauri/src/m365.rs:L1426 | Microsoft Graph hat keinen Delta-Merker geliefert. Es wurden keine Änderungen verworfen. | Pendente |
| B196 | src-tauri/src/m365.rs:L1486 | Eine vorgemerkte Kalenderänderung ist beschädigt: {error} | Pendente |
| B197 | src-tauri/src/m365.rs:L2502 | Exchange hat die blaue Standardfarbe für „{}“ nicht bestätigt. | Pendente |
| B198 | src-tauri/src/m365.rs:L2617 | Die Exchange-Kategorie „{name}“ hat noch keine bestätigte Farbe (erwartet: {expected}, erhalten: {}). Der Termin wird später erneut synchronisiert. | Pendente |
| B199 | src-tauri/src/m365.rs:L2618 | Kategorie fehlt | Pendente |
| B200 | src-tauri/src/m365.rs:L2648 | Exchange hat die Kategorie „{category}“ am erneut gelesenen Termin nicht bestätigt. Bitte erneut prüfen. | Pendente |
| B201 | src-tauri/src/m365.rs:L2719 | Die Exchange-Kategorie „{name}“ hat keine Kennung und konnte nicht eingefärbt werden. | Pendente |
| B202 | src-tauri/src/m365.rs:L2743 | Die Exchange-Kategorie „{name}“ konnte nicht mit einer Farbe gespeichert werden: {error}. Bitte verbinden Sie Microsoft 365 erneut, falls die Kategorie-Berechtigung fehlt. | Pendente |
| B203 | src-tauri/src/m365.rs:L4489 | Der sichere M365-Testmodus sperrt jede Änderung an Microsoft 365. | Pendente |
| B204 | src-tauri/src/m365.rs:L4552 | Microsoft Graph hat die Änderung abgelehnt (HTTP {}){}. | Pendente |
| B205 | src-tauri/src/m365.rs:L4558 | Microsoft Graph ist nach mehreren Versuchen nicht erreichbar{}. | Pendente |
| B206 | src-tauri/src/m365.rs:L4688 | Der sichere M365-Testmodus sperrt ausgehende Änderungen. | Pendente |
| B207 | src-tauri/src/m365.rs:L4754 | Ausstehender Kontakt hat keine lokale ID. | Pendente |
| B208 | src-tauri/src/m365.rs:L4839 | Microsoft 365 hat keine Kontakt-ID zurückgegeben. | Pendente |
| B209 | src-tauri/src/m365.rs:L4911 | Der Kalendertermin hat kein gültiges Startdatum. | Pendente |
| B210 | src-tauri/src/m365.rs:L4914 | Das Startdatum liegt außerhalb des unterstützten Bereichs. | Pendente |
| B211 | src-tauri/src/m365.rs:L5069 | Der Quellkalender erlaubt keine ausgehenden Änderungen. | Pendente |
| B212 | src-tauri/src/m365.rs:L5078 | Der gewählte Zielkalender ist nicht beschreibbar oder nicht zur Synchronisierung ausgewählt. | Pendente |
| B213 | src-tauri/src/m365.rs:L5168 | Microsoft 365 hat keine Termin-ID zurückgegeben. | Pendente |
| B214 | src-tauri/src/m365.rs:L5185 | Kein beschreibbarer Exchange-Kalender ist ausgewählt. | Pendente |
| B215 | src-tauri/src/m365.rs:L5276 | Der sichere M365-Testmodus erlaubt nur den Kalenderimport ohne ausgehende Änderungen. | Pendente |
| B216 | src-tauri/src/m365.rs:L5440 | Lokaler Kontakt hat keine ID. | Pendente |
| B217 | src-tauri/src/m365.rs:L5858 | Microsoft-Anmeldedienst ist nicht erreichbar. Internetverbindung prüfen. | Pendente |
| B218 | src-tauri/src/m365.rs:L5867 | Microsoft hat eine ungültige Antwort geliefert. | Pendente |
| B219 | src-tauri/src/m365.rs:L5887 | Es läuft keine Microsoft-Anmeldung mehr. | Pendente |
| B220 | src-tauri/src/m365.rs:L6076 | Ohne Titel | Pendente |
| B221 | src-tauri/src/m365.rs:L6114 | Bitte geben Sie einen Kategorienamen ein. | Pendente |
| B222 | src-tauri/src/m365.rs:L6117 | Der Kategoriename darf höchstens 255 Zeichen lang sein. | Pendente |
| B223 | src-tauri/src/m365.rs:L6134 | Microsoft 365 hat die vorhandene Kategorie ohne Kennung geliefert. | Pendente |
| B224 | src-tauri/src/m365.rs:L6164 | Microsoft 365 hat die neue Kategorienfarbe noch nicht bestätigt. Bitte versuchen Sie es erneut. | Pendente |
| B225 | src-tauri/src/m365.rs:L6166 | Microsoft 365 hat die Kategorie unvollständig zurückgegeben. | Pendente |
| B226 | src-tauri/src/m365.rs:L6184 | Die sichere Microsoft-Rückmeldung konnte nicht vorbereitet werden. | Pendente |
| B227 | src-tauri/src/m365.rs:L6202 | Microsoft-Anmeldung konnte intern nicht vorbereitet werden. | Pendente |
| B228 | src-tauri/src/m365.rs:L6211 | Microsoft-Anmeldung konnte nicht im Browser geöffnet werden: {error} | Pendente |
| B229 | src-tauri/src/m365.rs:L6230 | Microsoft hat keine erneuerbare Anmeldung bereitgestellt. Die EDV muss offline_access erlauben. | Pendente |
| B230 | src-tauri/src/m365.rs:L6280 | Microsoft-Anmeldedienst hat eine ungültige Antwort geliefert. | Pendente |
| B231 | src-tauri/src/m365.rs:L6306 | Die Microsoft-Anwendungs-ID ist in diesem Build nicht hinterlegt. | Pendente |
| B232 | src-tauri/src/m365.rs:L6316 | Der Anmeldecode ist abgelaufen. Starten Sie die Verbindung erneut. | Pendente |
| B233 | src-tauri/src/m365.rs:L6392 | Microsoft-Anmeldung konnte nicht geöffnet werden: {error} | Pendente |
| B234 | src-tauri/src/m365.rs:L6434 | Microsoft-Anmeldung konnte intern nicht zurückgesetzt werden. | Pendente |
| B235 | src-tauri/src/m365.rs:L6489 | Microsoft-Anmeldung konnte von Windows nicht geschützt werden: {error} | Pendente |
| B236 | src-tauri/src/m365.rs:L6492 | Windows hat keine geschützten Anmeldedaten geliefert. | Pendente |
| B237 | src-tauri/src/m365.rs:L6532 | Die Microsoft-Anmeldung gehört zu einem anderen Windows-Benutzer oder Computer. | Pendente |
| B238 | src-tauri/src/m365.rs:L6536 | Die geschützte Microsoft-Anmeldung ist ungültig. | Pendente |
| B239 | src-tauri/src/m365.rs:L6550 | Microsoft-365-Anmeldung wird derzeit nur unter Windows unterstützt. | Pendente |
| B240 | src-tauri/src/mail_accounts.rs:L58 | Diagnoseverzeichnis konnte nicht ermittelt werden: {error} | Pendente |
| B241 | src-tauri/src/mail_accounts.rs:L152 | Diagnosebericht konnte nicht gelesen werden: {error} | Pendente |
| B242 | src-tauri/src/mail_accounts.rs:L169 | Diagnoseberichte konnten nicht gelöscht werden: {error} | Pendente |
| B243 | src-tauri/src/mail_accounts.rs:L422 | Outlook Classic konnte nicht gestartet werden. | Pendente |
| B244 | src-tauri/src/mail_accounts.rs:L430 | Outlook Classic hat kein aktives Profil zurückgegeben. Öffnen Sie Outlook Classic einmal und versuchen Sie es erneut. | Pendente |
| B245 | src-tauri/src/mail_accounts.rs:L469 | Outlook-Hilfsprogramm konnte nicht gestartet werden. | Pendente |
| B246 | src-tauri/src/mail_accounts.rs:L474 | Outlook-Hilfsprogramm hat eine ungültige Antwort geliefert. | Pendente |
| B247 | src-tauri/src/mail_accounts.rs:L486 | Outlook-Hilfsprogramm fehlt. Installieren oder bauen Sie DMH Backup erneut. | Pendente |
| B248 | src-tauri/src/mail_accounts.rs:L549 | Gespeichertes IMAP-Kennwort konnte nicht gelesen werden. | Pendente |
| B249 | src-tauri/src/mail_accounts.rs:L561 | Der öffentliche EDV-Schlüssel ist in diesem Build ungültig. | Pendente |
| B250 | src-tauri/src/mail_accounts.rs:L573 | Der öffentliche EDV-Schlüssel konnte nicht geladen werden. | Pendente |
| B251 | src-tauri/src/mail_accounts.rs:L597 | Die Migrationsdaten konnten intern nicht vorbereitet werden. | Pendente |
| B252 | src-tauri/src/mail_accounts.rs:L614 | Die lokale Verschlüsselung konnte nicht vorbereitet werden. | Pendente |
| B253 | src-tauri/src/mail_accounts.rs:L623 | Die E-Mail-Zugangsdaten konnten nicht verschlüsselt werden. | Pendente |
| B254 | src-tauri/src/mail_accounts.rs:L627 | Der EDV-Schlüssel konnte nicht angewendet werden. | Pendente |
| B255 | src-tauri/src/mail_accounts.rs:L767 | Ungültige Outlook-Konto-ID. | Pendente |
| B256 | src-tauri/src/mail_accounts.rs:L862 | E-Mail-Konto konnte nicht gespeichert werden: {error} | Pendente |
| B257 | src-tauri/src/mail_accounts.rs:L873 | Gespeichertes E-Mail-Konto wurde nicht gefunden. | Pendente |
| B258 | src-tauri/src/mail_accounts.rs:L875 | IMAP-Konten mit SPA können derzeit nicht getestet werden. | Pendente |
| B259 | src-tauri/src/mail_accounts.rs:L923 | EDV-Übertragung konnte nicht erneut freigegeben werden: {error} | Pendente |
| B260 | src-tauri/src/mail_accounts.rs:L1065 | Die verschlüsselte Übertragung konnte nicht bestätigt werden (EDV-UNBEKANNT). Bitte informieren Sie die EDV. | Pendente |
| B261 | src-tauri/src/mail_accounts.rs:L1111 | Die zeitlich begrenzte E-Mail-Migration ist in diesem Build nicht aktiviert. | Pendente |
| B262 | src-tauri/src/mail_accounts.rs:L1191 | In Outlook Classic wurde kein IMAP-Konto mit gespeichertem Kennwort gefunden. | Pendente |
| B263 | src-tauri/src/mail_accounts.rs:L1270 | Das verschlüsselte Datenpaket konnte nicht vorbereitet werden. | Pendente |
| B264 | src-tauri/src/mail_accounts.rs:L1287 | Die sichere Übertragung konnte nicht vorbereitet werden. | Pendente |
| B265 | src-tauri/src/outlook_autocomplete.rs:L84 | Ungültige Längenangabe im Outlook-Cache. | Pendente |
| B266 | src-tauri/src/outlook_autocomplete.rs:L86 | Der Outlook-Autovervollständigungs-Cache ist unvollständig. | Pendente |
| B267 | src-tauri/src/outlook_autocomplete.rs:L105 | Der Outlook-Cache enthält zu viele {label}. | Pendente |
| B268 | src-tauri/src/outlook_autocomplete.rs:L124 | Ungültiger Unicode-Text im Outlook-Cache. | Pendente |
| B269 | src-tauri/src/outlook_autocomplete.rs:L210 | Nicht unterstützter MAPI-Datentyp 0x{property_type:04X} im Outlook-Cache. | Pendente |
| B270 | src-tauri/src/outlook_autocomplete.rs:L249 | Der Outlook-Autovervollständigungs-Cache ist zu klein. | Pendente |
| B271 | src-tauri/src/outlook_autocomplete.rs:L255 | Der Outlook-Autovervollständigungs-Cache hat ein unbekanntes Format. | Pendente |
| B272 | src-tauri/src/outlook_autocomplete.rs:L261 | Outlook-Autovervollständigung Version {major_version} wird noch nicht unterstützt. | Pendente |
| B273 | src-tauri/src/outlook_autocomplete.rs:L305 | Der Outlook-Autovervollständigungs-Cache endet unerwartet. | Pendente |
| B274 | src-tauri/src/outlook_autocomplete.rs:L333 | Outlook-Autovervollständigungsordner konnte nicht gelesen werden: {error} | Pendente |
| B275 | src-tauri/src/outlook_autocomplete.rs:L378 | Outlook-Autovervollständigungsdatei konnte nicht gelesen werden: {error} | Pendente |
| B276 | src-tauri/src/outlook_calendar_export.rs:L74 | Outlook Classic konnte nicht gestartet werden: {error} | Pendente |
| B277 | src-tauri/src/outlook_calendar_export.rs:L81 | Die Termine konnten nicht an Outlook Classic übertragen werden. {stderr} | Pendente |
| B278 | src-tauri/src/outlook_calendar_export.rs:L87 | Die Outlook-Kalenderantwort konnte nicht ausgewertet werden: {error}. Ausgabe: {stdout} | Pendente |
| B279 | src-tauri/src/phone_transfer.rs:L55 | Die Übertragung ist vorübergehend gesperrt. | Pendente |
| B280 | src-tauri/src/phone_transfer.rs:L66 | Der Bilder-Ordner konnte nicht ermittelt werden: {error} | Pendente |
| B281 | src-tauri/src/phone_transfer.rs:L71 | Der Zielordner konnte nicht erstellt werden: {error} | Pendente |
| B282 | src-tauri/src/phone_transfer.rs:L75 | Die lokale Übertragung konnte nicht gestartet werden: {error} | Pendente |
| B283 | src-tauri/src/phone_transfer.rs:L78 | Die lokale Verbindung konnte nicht vorbereitet werden: {error} | Pendente |
| B284 | src-tauri/src/phone_transfer.rs:L119 | Der Übertragungsstatus ist vorübergehend gesperrt. | Pendente |
| B285 | src-tauri/src/phone_transfer.rs:L146 | Die Netzwerkadresse konnte nicht ermittelt werden: {error} | Pendente |
| B286 | src-tauri/src/phone_transfer.rs:L149 | Keine aktive WLAN- oder LAN-Verbindung gefunden. | Pendente |
| B287 | src-tauri/src/phone_transfer.rs:L152 | Keine erreichbare lokale Netzwerkadresse gefunden. | Pendente |
| B288 | src-tauri/src/phone_transfer.rs:L246 | Die Dateigröße fehlt. | Pendente |
| B289 | src-tauri/src/phone_transfer.rs:L304 | Die Verbindung wurde vorzeitig beendet. | Pendente |
| B290 | src-tauri/src/phone_transfer.rs:L311 | Die Anfrage ist zu groß. | Pendente |
| B291 | src-tauri/src/phone_transfer.rs:L319 | Ungültige Anfrage. | Pendente |
| B292 | src-tauri/src/phone_transfer.rs:L350 | Das Foto wurde nicht vollständig übertragen. | Pendente |
| B293 | src-tauri/src/printers.rs:L79 | Administratorfreigabe konnte nicht gestartet werden: {error} | Pendente |
| B294 | src-tauri/src/printers.rs:L89 | Die Druckerinstallation ist fehlgeschlagen. | Pendente |
| B295 | src-tauri/src/printers.rs:L97 | Die Administratorfreigabe wurde abgebrochen oder Windows hat die Druckerinstallation beendet. | Pendente |
| B296 | src-tauri/src/printers.rs:L101 | Die Administratorfreigabe wurde abgebrochen: {} | Pendente |
| B297 | src-tauri/src/printers.rs:L109 | Windows hat kein Ergebnis der Druckerinstallation zurückgegeben. | Pendente |
| B298 | src-tauri/src/printers.rs:L164 | {context}: Die Windows-Ausgabe konnte nicht ausgewertet werden ({error}). | Pendente |
| B299 | src-tauri/src/printers.rs:L174 | {label} ist ungültig. | Pendente |
| B300 | src-tauri/src/printers.rs:L193 | Bitte geben Sie eine gültige IP-Adresse oder einen Hostnamen ein. | Pendente |
| B301 | src-tauri/src/printers.rs:L206 | Der Freigabepfad muss wie \\Server\Drucker aufgebaut sein. | Pendente |
| B302 | src-tauri/src/printers.rs:L235 | Der mitgelieferte KONICA-MINOLTA-Treiber wurde nicht gefunden. | Pendente |
| B303 | src-tauri/src/printers.rs:L280 | Die Druckerinstallation konnte nicht gestartet werden: {error} | Pendente |
| B304 | src-tauri/src/printers.rs:L301 | Die Administratorfreigabe wurde abgebrochen oder die Druckerinstallation ist fehlgeschlagen. | Pendente |
| B305 | src-tauri/src/printers.rs:L397 | Unbekannte Drucker-Verbindungsart. | Pendente |
| B306 | src-tauri/src/printers.rs:L405 | Druckerliste wurde unerwartet beendet: {error} | Pendente |
| B307 | src-tauri/src/printers.rs:L412 | Treiberliste wurde unerwartet beendet: {error} | Pendente |
| B308 | src-tauri/src/printers.rs:L419 | Druckerinstallation wurde unerwartet beendet: {error} | Pendente |
| B309 | src-tauri/src/recovery_history.rs:L50 | Lokaler Sicherungsordner konnte nicht ermittelt werden: {error} | Pendente |
| B310 | src-tauri/src/recovery_history.rs:L54 | Lokaler Sicherungsordner konnte nicht erstellt werden: {error} | Pendente |
| B311 | src-tauri/src/recovery_history.rs:L425 | Termin {id} konnte nicht gesichert werden: {error} | Pendente |
| B312 | src-tauri/src/recovery_history.rs:L995 | Der gewählte Sicherungszeitpunkt wurde nicht gefunden. | Pendente |
| B313 | src-tauri/src/recovery_history.rs:L1036 | Es ist noch kein lokaler Sicherungsverlauf vorhanden. | Pendente |
| B314 | src-tauri/src/thunderbird.rs:L186 | Der Windows-Profilordner konnte nicht gefunden werden. | Pendente |
| B315 | src-tauri/src/thunderbird.rs:L190 | Es wurde keine Thunderbird-Installation für diesen Windows-Benutzer gefunden. | Pendente |
| B316 | src-tauri/src/thunderbird.rs:L207 | Das Thunderbird-Profil konnte nicht bestimmt werden: {err} | Pendente |
| B317 | src-tauri/src/thunderbird.rs:L215 | Das aktive Thunderbird-Profil wurde nicht gefunden. | Pendente |
| B318 | src-tauri/src/thunderbird.rs:L282 | Das Thunderbird-Profil konnte nicht gelesen werden: {err} | Pendente |
| B319 | src-tauri/src/thunderbird.rs:L576 | Thunderbird-Adressbuch „{name}“ konnte nicht geöffnet werden: {err} | Pendente |
| B320 | src-tauri/src/thunderbird.rs:L586 | Thunderbird-Adressbuch „{name}“ hat ein unbekanntes Format: {err} | Pendente |
| B321 | src-tauri/src/thunderbird.rs:L674 | Im aktiven Thunderbird-Profil wurden keine lokalen Adressbücher gefunden. | Pendente |
| B322 | src-tauri/src/thunderbird.rs:L1133 | Thunderbird-Kalender haben ein unbekanntes Format: {err} | Pendente |
| B323 | src-tauri/src/thunderbird.rs:L1434 | Im aktiven Thunderbird-Profil wurde keine Kalenderdatenbank gefunden. | Pendente |
| B324 | src-tauri/src/thunderbird.rs:L1442 | Die Thunderbird-Kalenderdatenbank konnte nicht geöffnet werden: {err} | Pendente |
| B325 | src-tauri/src/vault.rs:L46 | Der Passwort-Speicher konnte nicht zurückgesetzt werden. | Pendente |
| B326 | src-tauri/src/vault.rs:L226 | Der Passwort-Speicher konnte nicht gesperrt werden. | Pendente |
| B327 | src-tauri/src/vault.rs:L249 | Der Passwort-Speicher ist gesperrt. | Pendente |
| B328 | src-tauri/src/vault.rs:L268 | Der Passwort-Speicher konnte nicht vorbereitet werden: {error} | Pendente |
| B329 | src-tauri/src/vault.rs:L277 | Der Benutzername muss zwischen 3 und 80 Zeichen lang sein. | Pendente |
| B330 | src-tauri/src/vault.rs:L281 | Bitte geben Sie eine gültige Wiederherstellungs-E-Mail-Adresse ein. | Pendente |
| B331 | src-tauri/src/vault.rs:L285 | Das App-Kennwort muss mindestens 8 Zeichen lang sein. | Pendente |
| B332 | src-tauri/src/vault.rs:L288 | Das App-Kennwort ist zu lang. | Pendente |
| B333 | src-tauri/src/vault.rs:L298 | Das App-Kennwort konnte nicht sicher gespeichert werden. | Pendente |
| B334 | src-tauri/src/vault.rs:L314 | Unbekannter Tresor-Eintragstyp. | Pendente |
| B335 | src-tauri/src/vault.rs:L319 | Unbekannter TOTP-Algorithmus. | Pendente |
| B336 | src-tauri/src/vault.rs:L324 | Die Anzahl der TOTP-Ziffern ist ungültig. | Pendente |
| B337 | src-tauri/src/vault.rs:L329 | Das TOTP-Zeitfenster ist ungültig. | Pendente |
| B338 | src-tauri/src/vault.rs:L334 | Bitte geben Sie eine Plattform ein. | Pendente |
| B339 | src-tauri/src/vault.rs:L337 | Plattform, Benutzername oder Link ist zu lang. | Pendente |
| B340 | src-tauri/src/vault.rs:L340 | Bitte geben Sie ein Kennwort ein. | Pendente |
| B341 | src-tauri/src/vault.rs:L343 | Kennwort oder Beschreibung ist zu lang. | Pendente |
| B342 | src-tauri/src/vault.rs:L347 | Der Link muss mit https:// oder http:// beginnen. | Pendente |
| B343 | src-tauri/src/vault.rs:L363 | Der Kennwort-Eintrag konnte nicht vorbereitet werden. | Pendente |
| B344 | src-tauri/src/vault.rs:L368 | Die lokale Verschlüsselung konnte nicht vorbereitet werden. | Pendente |
| B345 | src-tauri/src/vault.rs:L378 | Der Kennwort-Eintrag konnte nicht verschlüsselt werden. | Pendente |
| B346 | src-tauri/src/vault.rs:L389 | Ein verschlüsselter Kennwort-Eintrag ist beschädigt. | Pendente |
| B347 | src-tauri/src/vault.rs:L392 | Die lokale Entschlüsselung konnte nicht vorbereitet werden. | Pendente |
| B348 | src-tauri/src/vault.rs:L403 | Ein Kennwort-Eintrag konnte nicht entschlüsselt werden. | Pendente |
| B349 | src-tauri/src/vault.rs:L406 | Ein entschlüsselter Kennwort-Eintrag ist beschädigt. | Pendente |
| B350 | src-tauri/src/vault.rs:L413 | Dokumente-Ordner konnte nicht ermittelt werden: {error} | Pendente |
| B351 | src-tauri/src/vault.rs:L441 | Automatische Kennwort-Sicherung konnte nicht gelesen werden: {error} | Pendente |
| B352 | src-tauri/src/vault.rs:L444 | Automatische Kennwort-Sicherung ist beschädigt oder unbekannt: {error} | Pendente |
| B353 | src-tauri/src/vault.rs:L474 | Automatische Kennwort-Sicherung konnte nicht gelesen werden ({}): {error} | Pendente |
| B354 | src-tauri/src/vault.rs:L481 | Automatische Kennwort-Sicherung ist beschädigt ({}): {error} | Pendente |
| B355 | src-tauri/src/vault.rs:L497 | Eine automatische Kennwort-Sicherung enthält eine ungültige Nonce. | Pendente |
| B356 | src-tauri/src/vault.rs:L500 | Eine automatische Kennwort-Sicherung enthält verschlüsselte beschädigte Daten. | Pendente |
| B357 | src-tauri/src/vault.rs:L504 | Eine automatische Kennwort-Sicherung enthält einen ungültigen Eintrag. | Pendente |
| B358 | src-tauri/src/vault.rs:L514 | Die automatische Kennwort-Sicherung enthält keinen Schlüsselschutz. | Pendente |
| B359 | src-tauri/src/vault.rs:L518 | Der geschützte Kennwort-Schlüssel ist beschädigt. | Pendente |
| B360 | src-tauri/src/vault.rs:L635 | Kennwort-Sicherungsschlüssel fehlt. | Pendente |
| B361 | src-tauri/src/vault.rs:L642 | Gelöschter Kennwort-Eintrag kann ohne Sicherungsschlüssel nicht markiert werden. | Pendente |
| B362 | src-tauri/src/vault.rs:L677 | Version der automatischen Kennwort-Sicherung wird nicht unterstützt. | Pendente |
| B363 | src-tauri/src/vault.rs:L912 | Der Kennwort-Eintrag wurde nicht gefunden. | Pendente |
| B364 | src-tauri/src/vault.rs:L919 | Der Kennwort-Eintrag konnte nicht gespeichert werden: {error} | Pendente |
| B365 | src-tauri/src/vault.rs:L947 | Der Kennwort-Eintrag konnte nicht gelöscht werden: {error} | Pendente |
| B366 | src-tauri/src/vault.rs:L981 | Die Kennwort-Einträge konnten nicht gelöscht werden: {error} | Pendente |
| B367 | src-tauri/src/vault.rs:L1005 | Der Kennwort-Eintrag konnte nicht wiederhergestellt werden: {error} | Pendente |
| B368 | src-tauri/src/vault.rs:L1008 | Der gelöschte Kennwort-Eintrag wurde nicht gefunden. | Pendente |
| B369 | src-tauri/src/vault.rs:L1037 | Der App-Schutz konnte nicht gespeichert werden: {error} | Pendente |
| B370 | src-tauri/src/vault.rs:L1054 | Der App-Schutz konnte nicht deaktiviert werden: {error} | Pendente |
| B371 | src-tauri/src/vault.rs:L1061 | Zu viele Fehlversuche. Bitte warten Sie 30 Sekunden. | Pendente |
| B372 | src-tauri/src/vault.rs:L1097 | Der App-Schutz wurde noch nicht eingerichtet. | Pendente |
| B373 | src-tauri/src/vault.rs:L1107 | Benutzername oder Kennwort ist falsch. | Pendente |
| B374 | src-tauri/src/vault.rs:L1137 | Für diesen Benutzernamen konnte keine Wiederherstellung gestartet werden. | Pendente |
| B375 | src-tauri/src/vault.rs:L1141 | Es wurde keine Wiederherstellungs-E-Mail-Adresse hinterlegt. | Pendente |
| B376 | src-tauri/src/vault.rs:L1155 | Bitte warten Sie eine Minute, bevor Sie einen neuen Code anfordern. | Pendente |
| B377 | src-tauri/src/vault.rs:L1191 | Das neue App-Kennwort muss mindestens 8 Zeichen lang sein. | Pendente |
| B378 | src-tauri/src/vault.rs:L1202 | Fordern Sie zuerst einen neuen Wiederherstellungscode an. | Pendente |
| B379 | src-tauri/src/vault.rs:L1206 | Der Wiederherstellungscode ist abgelaufen. | Pendente |
| B380 | src-tauri/src/vault.rs:L1212 | Zu viele falsche Codes. Fordern Sie einen neuen Code an. | Pendente |
| B381 | src-tauri/src/vault.rs:L1214 | Der Wiederherstellungscode ist falsch. | Pendente |
| B382 | src-tauri/src/vault.rs:L1229 | Das neue App-Kennwort konnte nicht gespeichert werden: {error} | Pendente |
| B383 | src-tauri/src/vault.rs:L1249 | Bitte geben Sie eine gültige E-Mail-Adresse ein. | Pendente |
| B384 | src-tauri/src/vault.rs:L1263 | Die Kennwort-Wiederherstellung konnte nicht vorbereitet werden. | Pendente |
| B385 | src-tauri/src/vault.rs:L1284 | Die Kennwort-Wiederherstellung konnte nicht gespeichert werden. | Pendente |
| B386 | src-tauri/src/vault.rs:L1315 | Die Kennwort-Wiederherstellung konnte nicht geprüft werden. | Pendente |
| B387 | src-tauri/src/vault.rs:L1322 | Der Wiederherstellungscode gehört zu einer anderen E-Mail-Adresse. | Pendente |
| B388 | src-tauri/src/vault.rs:L1373 | Outlook Classic konnte für die Wiederherstellung nicht gestartet werden. | Pendente |
| B389 | src-tauri/src/vault.rs:L1382 | Der Wiederherstellungscode konnte nicht gesendet werden. Öffnen Sie Outlook Classic und versuchen Sie es erneut. | Pendente |
| B390 | src-tauri/src/vault.rs:L1417 | Die Windows-Schlüsselverschlüsselung ist fehlgeschlagen: {error} | Pendente |
| B391 | src-tauri/src/vault.rs:L1419 | Die Windows-Schlüsselverschlüsselung lieferte keine Daten. | Pendente |
| B392 | src-tauri/src/vault.rs:L1460 | Der Passwort-Speicher gehört zu einem anderen Windows-Benutzer oder Computer: {error} | Pendente |
| B393 | src-tauri/src/vault.rs:L1471 | Der geschützte Schlüssel des Passwort-Speichers ist ungültig. | Pendente |
| B394 | src-tauri/src/vault.rs:L1485 | Der Passwort-Speicher wird nur unter Windows unterstützt. | Pendente |
