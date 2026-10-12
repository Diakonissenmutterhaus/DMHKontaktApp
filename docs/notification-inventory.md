# Inventário de mensagens do aplicativo

Gerado pelo código atual com `node scripts/audit-notifications.mjs`.

**602 pontos de mensagem** encontrados em **48 arquivos**. Um ponto pode produzir várias alternativas. Este é um levantamento para classificação, não uma mudança de visibilidade.

As propostas abaixo **não foram aplicadas**. Todos os itens estão pendentes de decisão. `{expressão}` representa valores variáveis; `[Dinâmico: …]` significa que o texto depende de outro helper, dados nativos ou resposta externa. Não é possível enumerar todas as frases de servidores, Windows, sistema de arquivos, rede ou extensões. Erros de helpers são candidatos a chegar à interface, e sua propagação deve ser conferida antes de modificar o app. Confirmações e validações foram incluídas porque removê-las indiscriminadamente pode deixar uma ação destrutiva ou bloqueada sem explicação. Rótulos de botões e conteúdo normal das páginas não são notificações.

## Arquivos auditados com mensagens

| Arquivo | Pontos |
| --- | ---: |
| src/App.tsx | 5 |
| src/components/ActionResultDialog.tsx | 9 |
| src/components/AppLockScreen.tsx | 7 |
| src/components/AuditHistoryPanel.tsx | 3 |
| src/components/CalendarCategoryManager.tsx | 7 |
| src/components/CalendarEventForm.tsx | 4 |
| src/components/CalendarReconciliationDialog.tsx | 8 |
| src/components/ConfirmDialog.tsx | 1 |
| src/components/ContactForm.tsx | 2 |
| src/components/ContactReconciliationDialog.tsx | 13 |
| src/components/EasyImportDialog.tsx | 9 |
| src/components/EdvAccessDialog.tsx | 4 |
| src/components/Microsoft365SyncDialog.tsx | 1 |
| src/components/MigrationCaptureDialog.tsx | 6 |
| src/components/OnboardingDialog.tsx | 9 |
| src/components/OutdoorBookingsPanel.tsx | 10 |
| src/components/OutlookContactImportDialog.tsx | 11 |
| src/components/PhonePhotoTransferPanel.tsx | 10 |
| src/components/PrinterSettings.tsx | 9 |
| src/components/StatusMessage.tsx | 2 |
| src/components/UnsavedContactChangesDialog.tsx | 6 |
| src/components/UpdateNotifier.tsx | 8 |
| src/components/WelcomeSignIn.tsx | 13 |
| src/pages/AuthenticatorPage.tsx | 17 |
| src/pages/BackupPage.tsx | 5 |
| src/pages/CalendarPage.tsx | 46 |
| src/pages/ContactsPage.tsx | 41 |
| src/pages/DienstleistungenPage.tsx | 22 |
| src/pages/DocumentsPage.tsx | 53 |
| src/pages/ExportPage.tsx | 26 |
| src/pages/ExtrasPage.tsx | 4 |
| src/pages/FeatureDevelopmentPage.tsx | 9 |
| src/pages/GroupsPage.tsx | 6 |
| src/pages/ImportPage.tsx | 25 |
| src/pages/Microsoft365Page.tsx | 23 |
| src/pages/PasswordsPage.tsx | 16 |
| src/pages/RecoveryPage.tsx | 6 |
| src/pages/SettingsPage.tsx | 28 |
| src/pages/SimpleImportPage.tsx | 26 |
| src/pages/SynchronizationsPage.tsx | 37 |
| src/pages/TrashPage.tsx | 12 |
| src/pages/WelcomePage.tsx | 3 |
| src/services/db.ts | 4 |
| src/utils/automaticCalendarSync.ts | 12 |
| src/utils/easyImport.ts | 5 |
| src/utils/importParserWorker.ts | 3 |
| src/utils/localAuth.ts | 5 |
| src/utils/totp.ts | 11 |

## src/App.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N001 | L220 · promise | Mensagem produzida / repassada | **message:** [Dinâmico: describeMicrosoft365SyncFailure(1, [String(error)])] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N002 | L250 · loadVaultStatus | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N003 | L299 · App | Mensagem produzida / repassada | **message:** Microsoft-365-Einrichtung konnte nicht abgeschlossen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N004 | L406 · unlisten | Alerta nativo | **message:** Die App konnte nicht im Hintergrund weiterlaufen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N005 | L444 · App | Aviso no formulário / painel | **text:** ADMIN TEST · Isolierte Testdaten · Keine offizielle Version<br>**text:** Commit<br>**text:** [Dinâmico: import.meta.env.VITE_SOURCE_COMMIT?.slice(0, 8)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/ActionResultDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N006 | L48 · ActionResultDialog | Central de atividades | **title:** [Dinâmico: result.title]<br>**summary:** [Dinâmico: result.summary]<br>**details:** [Dinâmico: result.details] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N007 | L73 · ActionResultDialog | Aviso no formulário / painel | **text:** Ergebnis<br>**text:** [Dinâmico: result.title]<br>**text:** [Dinâmico: result.summary]<br>**text:** [Dinâmico: result.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)]<br>**text:** [Dinâmico: result.itemsLabel]<br>**text:** {result.items.length} betroffene Einträge anzeigen<br>**text:** [Dinâmico: result.items.slice(0, visibleItemCount).map((item, index) => ( <li key={`${item.label}-${index}`}> <strong>{item.label}</strong> {item.detail && <span>{item.detail}</span>} </li> ))]<br>**text:** [Dinâmico: result.dismissalLabel]<br>**text:** Diesen Hinweis nicht mehr anzeigen | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N008 | L74 · ActionResultDialog | Aviso no formulário / painel | **text:** Ergebnis<br>**text:** [Dinâmico: result.title] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N009 | L77 · ActionResultDialog | Aviso no formulário / painel | **text:** Ergebnis | Decidir com o usuário | Pendente |
| N010 | L85 · ActionResultDialog | Aviso no formulário / painel | **text:** [Dinâmico: result.summary] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N011 | L87 · ActionResultDialog | Aviso no formulário / painel | **text:** [Dinâmico: result.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N012 | L92 · ActionResultDialog | Aviso no formulário / painel | **text:** [Dinâmico: result.itemsLabel]<br>**text:** {result.items.length} betroffene Einträge anzeigen<br>**text:** [Dinâmico: result.items.slice(0, visibleItemCount).map((item, index) => ( <li key={`${item.label}-${index}`}> <strong>{item.label}</strong> {item.detail && <span>{item.detail}</span>} </li> ))] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N013 | L103 · ActionResultDialog | Aviso no formulário / painel | **text:** Weitere Einträge anzeigen (<br>**text:** [Dinâmico: Math.min(visibleItemCount, result.items.length)]<br>**text:** von<br>**text:** [Dinâmico: result.items.length]<br>**text:** ) | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N014 | L110 · ActionResultDialog | Aviso no formulário / painel | **text:** [Dinâmico: result.dismissalLabel]<br>**text:** Diesen Hinweis nicht mehr anzeigen | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/AppLockScreen.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N015 | L35 · login | Aviso / erro / status | **message:** [Dinâmico: String(unlockError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N016 | L50 · requestCode | Aviso / erro / status | **message:** [Dinâmico: String(requestError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N017 | L60 · resetPassword | Aviso / erro / status | **message:** Die beiden neuen Kennwörter stimmen nicht überein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N018 | L70 · resetPassword | Aviso / erro / status | **message:** [Dinâmico: String(resetError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N019 | L107 · AppLockScreen | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N020 | L134 · AppLockScreen | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N021 | L159 · AppLockScreen | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/AuditHistoryPanel.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N022 | L82 · loadPage | Aviso / erro / status | **message:** Die Historie konnte nicht geladen werden: {cause} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N023 | L170 · AuditHistoryPanel | Aviso no formulário / painel | **text:** Suche läuft …<br>**text:** {entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}{hasMore ? " · weitere vorhanden" : ""}<br>**text:** Filter aktiv | Decidir com o usuário | Pendente |
| N024 | L174 · AuditHistoryPanel | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/CalendarCategoryManager.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N025 | L44 · run | Aviso / erro / status | **message:** [Dinâmico: action()] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N026 | L45 · run | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N027 | L54 · CalendarCategoryManager | Aviso no formulário / painel | **text:** Exchange wird geladen …<br>**text:** Mit Exchange verbunden<br>**text:** Lokale Kategorien<br>**text:** [Dinâmico: props.categories.length]<br>**text:** Kategorien<br>**text:** Ohne Kategorie: Blau | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N028 | L55 · CalendarCategoryManager | Aviso no formulário / painel | **text:** Microsoft-365-Testmodus: nur lesen. Farben können hier angezeigt, aber nicht in Exchange geändert werden. | Decidir com o usuário | Pendente |
| N029 | L56 · CalendarCategoryManager | Aviso no formulário / painel | **text:** [Dinâmico: error]<br>**text:** [Dinâmico: props.loadError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N030 | L57 · CalendarCategoryManager | Aviso no formulário / painel | **text:** [Dinâmico: notice] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N031 | L58 · CalendarCategoryManager | Aviso no formulário / painel | **text:** Kategorien und zugehörige Termine werden aktualisiert. Bei vielen Terminen kann dies etwas dauern … | Decidir com o usuário | Pendente |

## src/components/CalendarEventForm.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N032 | L353 · CalendarEventForm | Aviso no formulário / painel | **text:** Das Ende muss nach dem Beginn liegen. | Decidir com o usuário | Pendente |
| N033 | L409 · CalendarEventForm | Aviso no formulário / painel | **text:** Kalender:<br>**text:** Kalender werden geladen …<br>**text:** [Dinâmico: calendarsError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N034 | L419 · CalendarEventForm | Aviso no formulário / painel | **text:** Kalender werden geladen … | Decidir com o usuário | Pendente |
| N035 | L420 · CalendarEventForm | Aviso no formulário / painel | **text:** [Dinâmico: calendarsError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/CalendarReconciliationDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N036 | L111 · scan | Erro de helper | **message:** Keine Termine in {platformName(nextPlatform)} gefunden. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N037 | L125 · scan | Aviso / erro / status | **message:** [Dinâmico: String(scanError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N038 | L148 · apply | Aviso / erro / status | **message:** {preview.newEvents} neu · {preview.updates + externalChoices} aktualisiert · {preview.exact} bereits vorhanden | Decidir com o usuário | Pendente |
| N039 | L166 · apply | Aviso / erro / status | **message:** Es wurde nichts übernommen. {String(applyError)}<br>**message:** Der Abgleich wurde unterbrochen. Die automatische Sicherung bleibt für die EDV verfügbar. {String(applyError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N040 | L183 · undo | Aviso / erro / status | **message:** Der letzte Kalenderabgleich wurde vollständig rückgängig gemacht. | Decidir com o usuário | Pendente |
| N041 | L190 · undo | Aviso / erro / status | **message:** Rückgängig machen nicht möglich: {String(undoError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N042 | L286 · CalendarReconciliationDialog | Aviso no formulário / painel | **text:** Abgleich rückgängig gemacht<br>**text:** Kalender sind abgeglichen<br>**text:** [Dinâmico: resultMessage] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N043 | L297 · CalendarReconciliationDialog | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/ConfirmDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N044 | L26 · ConfirmDialog | Aviso no formulário / painel | **text:** [Dinâmico: notice] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/ContactForm.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N045 | L325 · ContactForm | Aviso no formulário / painel | **text:** Bitte prüfen Sie die markierten E-Mail-Adressen. | Decidir com o usuário | Pendente |
| N046 | L330 · ContactForm | Aviso no formulário / painel | **text:** Änderungen noch nicht gespeichert | Decidir com o usuário | Pendente |

## src/components/ContactReconciliationDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N047 | L109 · scan | Erro de helper | **message:** Keine Outlook-Kontakte gefunden. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N048 | L113 · scan | Erro de helper | **message:** Keine Thunderbird-Kontakte gefunden. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N049 | L118 · scan | Aviso / erro / status | **message:** [Dinâmico: String(scanError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N050 | L134 · apply | Erro de helper | **message:** Die Outlook-Prüfung ist nicht mehr verfügbar. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N051 | L141 · apply | Aviso / erro / status | **message:** {result.imported} neu · {result.mergedDuplicates} zusammengeführt · {totalContacts} Kontakte insgesamt | Decidir com o usuário | Pendente |
| N052 | L145 · apply | Aviso / erro / status | **message:** {result.imported} neu · {result.mergedDuplicates} zusammengeführt · {totalContacts} Kontakte insgesamt | Decidir com o usuário | Pendente |
| N053 | L155 · apply | Aviso / erro / status | **message:** Es wurde nichts übernommen. {String(applyError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N054 | L169 · undo | Aviso / erro / status | **message:** Der letzte Abgleich wurde vollständig rückgängig gemacht. | Decidir com o usuário | Pendente |
| N055 | L176 · undo | Aviso / erro / status | **message:** Rückgängig machen nicht möglich: {String(undoError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N056 | L224 · ContactReconciliationDialog | Aviso no formulário / painel | **text:** [Dinâmico: summary.conflicts]<br>**text:** Getrennt behalten | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N057 | L232 · ContactReconciliationDialog | Aviso no formulário / painel | **text:** [Dinâmico: summary.skippedInvalid]<br>**text:** unvollständige Einträge werden ausgelassen. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N058 | L244 · ContactReconciliationDialog | Aviso no formulário / painel | **text:** Abgleich rückgängig gemacht<br>**text:** Kontakte sind aktuell<br>**text:** [Dinâmico: resultMessage] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N059 | L255 · ContactReconciliationDialog | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/EasyImportDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N060 | L54 · EasyImportDialog | Aviso / erro / status | **message:** Die verbundenen Kalender konnten nicht geprüft werden. Ihre vorhandenen Daten wurden nicht verändert. | Decidir com o usuário | Pendente |
| N061 | L69 · startImport | Aviso / erro / status | **message:** [Dinâmico: importErrorMessage(importError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N062 | L82 · scanConnectedCalendars | Aviso / erro / status | **message:** Die verbundenen Kalender konnten nicht geprüft werden. Ihre vorhandenen Daten wurden nicht verändert. | Decidir com o usuário | Pendente |
| N063 | L128 · EasyImportDialog | Aviso no formulário / painel | **text:** Verbundene Kalender werden gesucht …<br>**text:** Es werden nur Konten und Kalendernamen gelesen, keine Passwörter. | Decidir com o usuário | Pendente |
| N064 | L135 · EasyImportDialog | Aviso no formulário / painel | **text:** Prüfung nicht möglich<br>**text:** [Dinâmico: discoveryError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N065 | L142 · EasyImportDialog | Aviso no formulário / painel | **text:** [Dinâmico: discovery.sources.length]<br>**text:** verbundene Kalender gefunden<br>**text:** Termine können übernommen werden. Für die dauerhafte Verbindung ist je Anbieter einmalig eine sichere Anmeldung nötig. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N066 | L160 · EasyImportDialog | Aviso no formulário / painel | **text:** Ein nicht eingerichtetes Programm wurde übersprungen. Die gefundenen Kalender können trotzdem übernommen werden. | Decidir com o usuário | Pendente |
| N067 | L173 · EasyImportDialog | Aviso no formulário / painel | **text:** Import abgeschlossen<br>**text:** [Dinâmico: result.detail] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N068 | L182 · EasyImportDialog | Aviso no formulário / painel | **text:** Import nicht möglich<br>**text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/EdvAccessDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N069 | L13 · sha256 | Resultado de ação | **message:** [Dinâmico: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N070 | L28 · unlock | Aviso / erro / status | **message:** Das EDV-Kennwort ist nicht korrekt. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N071 | L49 · EdvAccessDialog | Aviso no formulário / painel | **text:** Der Zugriff ist ausschließlich für die EDV bestimmt. | Decidir com o usuário | Pendente |
| N072 | L59 · EdvAccessDialog | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/Microsoft365SyncDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N073 | L17 · Microsoft365SyncDialog | Aviso no formulário / painel | **text:** Microsoft 365 / Exchange | Decidir com o usuário | Pendente |

## src/components/MigrationCaptureDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N074 | L45 · submit | Aviso / erro / status | **message:** [Dinâmico: String(submitError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N075 | L46 · submit | Aviso / erro / status | **message:** [Dinâmico: String(submitError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N076 | L90 · MigrationCaptureDialog | Aviso no formulário / painel | **text:** [Dinâmico: error]<br>**text:** Den technischen Diagnosebericht können Sie anschließend in den Einstellungen speichern und an die EDV weitergeben. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N077 | L99 · MigrationCaptureDialog | Aviso no formulário / painel | **text:** Die EDV-Verarbeitung kann bei hoher Auslastung einige Minuten dauern. Bitte lassen Sie dieses Fenster geöffnet. | Decidir com o usuário | Pendente |
| N078 | L120 · MigrationCaptureDialog | Aviso no formulário / painel | **text:** Sichere Übertragung abgeschlossen<br>**text:** Die E-Mail-Konfiguration wurde verschlüsselt an die EDV übertragen.<br>**text:** {submittedResult.accountsSubmitted} E-Mail-Konfigurationen wurden verschlüsselt an die EDV übertragen.<br>**text:** Übermittelte Serverdaten<br>**text:** [Dinâmico: submittedResult.accounts.map((account, index) => ( <li key={`${account.email}-${account.incomingServer}-${index}`}> <strong>{account.email \|\| account.accountName \|\| `E-Mail-Konto ${index + 1}`}</strong> <dl> <div><dt>E-Mail</dt><dd>{account.email \|\| "Nicht angegeben"}</dd></div> <div><dt>IMAP-Benutzer</dt><dd>{account.incomingUser \|\| "Nicht angegeben"}</dd></div> <div><dt>IMAP-Server</dt><dd>{account.incomingServer \|\| "Nicht angegeben"}</dd></div> <div><dt>Port</dt><dd>{account.incomingPort \|\| "Nicht angegeben"}</dd></div> <div><dt>Sicherheit</dt><dd>{securityLabel(account.incomingSecurity)}</dd></div> </dl> </li> ))]<br>**text:** Das Kennwort wurde übertragen, wird hier aber nicht angezeigt.<br>**text:** Es erfolgt keine automatische weitere Übertragung. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N079 | L129 · MigrationCaptureDialog | Aviso no formulário / painel | **text:** Übermittelte Serverdaten<br>**text:** [Dinâmico: submittedResult.accounts.map((account, index) => ( <li key={`${account.email}-${account.incomingServer}-${index}`}> <strong>{account.email \|\| account.accountName \|\| `E-Mail-Konto ${index + 1}`}</strong> <dl> <div><dt>E-Mail</dt><dd>{account.email \|\| "Nicht angegeben"}</dd></div> <div><dt>IMAP-Benutzer</dt><dd>{account.incomingUser \|\| "Nicht angegeben"}</dd></div> <div><dt>IMAP-Server</dt><dd>{account.incomingServer \|\| "Nicht angegeben"}</dd></div> <div><dt>Port</dt><dd>{account.incomingPort \|\| "Nicht angegeben"}</dd></div> <div><dt>Sicherheit</dt><dd>{securityLabel(account.incomingSecurity)}</dd></div> </dl> </li> ))]<br>**text:** Das Kennwort wurde übertragen, wird hier aber nicht angezeigt. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/OnboardingDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N080 | L111 · finish | Aviso / erro / status | **message:** Die Einführung konnte nicht abgeschlossen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N081 | L117 · scanComputer | Aviso / erro / status | **message:** Die automatische Suche funktioniert nur in der installierten Windows-App. | Decidir com o usuário | Pendente |
| N082 | L177 · importSelectedData | Aviso / erro / status | **message:** Bitte wählen Sie mindestens einen Datenbereich aus. | Decidir com o usuário | Pendente |
| N083 | L223 · importSelectedData | Aviso / erro / status | **message:** [Dinâmico: errors.join(" · ")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N084 | L233 · OnboardingDialog | Aviso no formulário / painel | **text:** [Dinâmico: ["welcome", "tour", "import", "finished"].map((item, index) => <span className={stage === item ? "active" : ""} key={item}>{index + 1}</span>)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N085 | L249 · OnboardingDialog | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N086 | L306 · OnboardingDialog | Aviso no formulário / painel | **text:** Nicht gefundene Quellen<br>**text:** [Dinâmico: scanResult.notices.map((notice) => <li key={notice}>{notice}</li>)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N087 | L310 · OnboardingDialog | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N088 | L324 · OnboardingDialog | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/OutdoorBookingsPanel.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N089 | L130 · saveBooking | Aviso / erro / status | **message:** Die Endzeit muss nach der Startzeit liegen. | Decidir com o usuário | Pendente |
| N090 | L135 · saveBooking | Aviso / erro / status | **message:** Wählen Sie mindestens einen Bedarf oder ein Gerät aus. | Decidir com o usuário | Pendente |
| N091 | L138 · saveBooking | Confirmação | **message:** {conflicts.length} parallele Anfrage(n) verwenden mindestens dasselbe Material. Trotzdem als offene Anfrage speichern? | Manter confirmação antes da ação | Pendente |
| N092 | L153 · saveBooking | Aviso / erro / status | **message:** Anfrage {booking.id} wurde gespeichert. | Decidir com o usuário | Pendente |
| N093 | L161 · updateStatus | Aviso / erro / status | **message:** Status von {id} wurde auf „{status}“ gesetzt. | Decidir com o usuário | Pendente |
| N094 | L166 · OutdoorBookingsPanel | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N095 | L171 · OutdoorBookingsPanel | Aviso no formulário / painel | **text:** [Dinâmico: conflicts.length]<br>**text:** mögliche Überschneidungen | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N096 | L200 · OutdoorBookingsPanel | Aviso no formulário / painel | **text:** Zuerst auswählen, danach Menge, Herkunft und Zuständigkeit ergänzen. | Decidir com o usuário | Pendente |
| N097 | L222 · OutdoorBookingsPanel | Aviso no formulário / painel | **text:** Mögliche Doppelbelegung<br>**text:** [Dinâmico: conflicts.map((conflict) => `${conflict.id}: ${conflict.materials.join(", ")}`).join(" · ")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N098 | L239 · OutdoorBookingCard | Aviso no formulário / painel | **text:** [Dinâmico: booking.eventName]<br>**text:** [Dinâmico: booking.id]<br>**text:** ·<br>**text:** [Dinâmico: booking.responsible]<br>**text:** [Dinâmico: formatDate(booking.date)]<br>**text:** ·<br>**text:** [Dinâmico: booking.from]<br>**text:** –<br>**text:** [Dinâmico: booking.to]<br>**text:** Status | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/OutlookContactImportDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N099 | L165 · startClassicScan | Aviso / erro / status | **message:** Outlook Classic konnte nicht geprüft werden: {scanError} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N100 | L199 · chooseNewOutlookCsv | Aviso / erro / status | **message:** Die Outlook-CSV-Datei konnte nicht gelesen werden: {scanError} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N101 | L216 · submit | Aviso / erro / status | **message:** Bitte wählen Sie mindestens eine Quelle mit importierbaren Kontakten aus. | Decidir com o usuário | Pendente |
| N102 | L220 · confirmed | Confirmação | **message:** Es werden {selectedContacts.length} Kontakte einmalig importiert. Bei sehr großen Kontaktbeständen kann dies bis zu 5 Minuten dauern. Möchten Sie fortfahren? | Manter confirmação antes da ação | Pendente |
| N103 | L270 · submit | Aviso / erro / status | **message:** Kontakte konnten nicht importiert werden: {importError} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N104 | L324 · OutlookContactImportDialog | Aviso no formulário / painel | **text:** Kontakte werden sicher importiert …<br>**text:** Outlook-Kontakte und frühere Empfänger werden eingelesen …<br>**text:** CSV-Kontakte werden geprüft …<br>**text:** Kontaktordner und die lokal gespeicherte Outlook-Autovervollständigung werden gemeinsam geprüft.<br>**text:** Die Kontakte werden vollständig geprüft. Das kann je nach Dateigröße etwas dauern.<br>**text:** Laufzeit:<br>**text:** [Dinâmico: formatElapsedTime(busyElapsedSeconds)]<br>**text:** Die App arbeitet weiter. Bitte dieses Fenster geöffnet lassen. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N105 | L349 · OutlookContactImportDialog | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N106 | L356 · OutlookContactImportDialog | Aviso no formulário / painel | **text:** [Dinâmico: preview.found]<br>**text:** gefunden<br>**text:** [Dinâmico: preview.contacts.filter((item) => item.status === "new").length]<br>**text:** neu<br>**text:** [Dinâmico: preview.contacts.filter((item) => item.status === "duplicate_exact").length]<br>**text:** 100 % identisch<br>**text:** [Dinâmico: preview.contacts.filter((item) => item.status === "different").length]<br>**text:** abweichend | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N107 | L364 · OutlookContactImportDialog | Aviso no formulário / painel | **text:** [Dinâmico: warning] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N108 | L420 · OutlookContactImportDialog | Aviso no formulário / painel | **text:** [Dinâmico: contact.displayName]<br>**text:** Ohne Namen<br>**text:** [Dinâmico: contact.email]<br>**text:** [Dinâmico: contact.phone]<br>**text:** Keine E-Mail oder Telefonnummer<br>**text:** [Dinâmico: contact.reason]<br>**text:** · Gefunden: {contact.existingName}<br>**text:** Wird ausgelassen<br>**text:** Wird importiert<br>**text:** Wird zusammengeführt<br>**text:** Wird zusätzlich importiert | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N109 | L467 · OutlookContactImportDialog | Aviso no formulário / painel | **text:** Import abgeschlossen<br>**text:** [Dinâmico: result.imported]<br>**text:** Kontakte wurden übernommen.<br>**text:** [Dinâmico: result.mergedDuplicates]<br>**text:** Duplikate wurden zusammengeführt.<br>**text:** [Dinâmico: result.skippedExactDuplicates]<br>**text:** zu 100 % identische Kontakte wurden ausgelassen. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/PhonePhotoTransferPanel.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N110 | L38 · PhonePhotoTransferPanel | Aviso / erro / status | **message:** Übertragungsstatus konnte nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N111 | L61 · PhonePhotoTransferPanel | Aviso / erro / status | **message:** Der QR-Code konnte nicht erstellt werden. | Decidir com o usuário | Pendente |
| N112 | L71 · interval | Aviso / erro / status | **message:** Die Übertragungssitzung ist abgelaufen. Starten Sie bei Bedarf eine neue Sitzung. | Decidir com o usuário | Pendente |
| N113 | L79 · start | Aviso / erro / status | **message:** Die Handy-Übertragung kann nur in der installierten Desktop-App gestartet werden. | Decidir com o usuário | Pendente |
| N114 | L91 · start | Aviso / erro / status | **message:** Übertragung konnte nicht gestartet werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N115 | L101 · stop | Aviso / erro / status | **message:** Die Übertragung wurde beendet. | Decidir com o usuário | Pendente |
| N116 | L108 · copyLink | Aviso / erro / status | **message:** Der Link wurde kopiert. | Decidir com o usuário | Pendente |
| N117 | L110 · copyLink | Aviso / erro / status | **message:** Der Link konnte nicht kopiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N118 | L127 · PhonePhotoTransferPanel | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N119 | L161 · PhonePhotoTransferPanel | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/PrinterSettings.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N120 | L49 · refresh | Aviso / erro / status | **message:** Drucker konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N121 | L64 · installKopierraum | Aviso / erro / status | **message:** Drucker können nur in der installierten Windows-App hinzugefügt werden. | Decidir com o usuário | Pendente |
| N122 | L73 · installKopierraum | Aviso / erro / status | **message:** Der Drucker ist bereits installiert.<br>**message:** Kopierraum SH2 UG wurde hinzugefügt. | Decidir com o usuário | Pendente |
| N123 | L76 · installKopierraum | Aviso / erro / status | **message:** Drucker konnte nicht hinzugefügt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N124 | L86 · addPrinter | Aviso / erro / status | **message:** Drucker können nur in der installierten Windows-App hinzugefügt werden. | Decidir com o usuário | Pendente |
| N125 | L101 · addPrinter | Aviso / erro / status | **message:** Drucker wurde hinzugefügt. | Decidir com o usuário | Pendente |
| N126 | L109 · addPrinter | Aviso / erro / status | **message:** Drucker konnte nicht hinzugefügt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N127 | L117 · PrinterSettings | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N128 | L185 · PrinterSettings | Aviso no formulário / painel | **text:** [Dinâmico: printerStatusLabel(printer.printerStatus)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/StatusMessage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N129 | L30 · StatusMessage | Central de atividades | **title:** Aktion fehlgeschlagen<br>**title:** Erledigt<br>**title:** Hinweis<br>**summary:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N130 | L47 · StatusMessage | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/UnsavedContactChangesDialog.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N131 | L32 · UnsavedContactChangesDialog | Aviso no formulário / painel | **text:** Nicht gespeicherte Änderungen<br>**text:** Sie haben „<br>**text:** [Dinâmico: contactName]<br>**text:** “ geändert.<br>**text:** Das haben Sie geändert:<br>**text:** [Dinâmico: changes.map((change) => ( <div className="unsaved-contact-change" key={change.label}> <span className="unsaved-contact-change-label">{change.label}</span> <span className="unsaved-contact-change-values"> <del>{change.before}</del> <span aria-hidden="true">→</span> <ins>{change.after}</ins> </span> </div> ))]<br>**text:** Möchten Sie die Änderungen speichern oder verwerfen? | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N132 | L43 · UnsavedContactChangesDialog | Aviso no formulário / painel | **text:** Das haben Sie geändert:<br>**text:** [Dinâmico: changes.map((change) => ( <div className="unsaved-contact-change" key={change.label}> <span className="unsaved-contact-change-label">{change.label}</span> <span className="unsaved-contact-change-values"> <del>{change.before}</del> <span aria-hidden="true">→</span> <ins>{change.after}</ins> </span> </div> ))]<br>**text:** Möchten Sie die Änderungen speichern oder verwerfen? | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N133 | L45 · UnsavedContactChangesDialog | Aviso no formulário / painel | **text:** [Dinâmico: changes.map((change) => ( <div className="unsaved-contact-change" key={change.label}> <span className="unsaved-contact-change-label">{change.label}</span> <span className="unsaved-contact-change-values"> <del>{change.before}</del> <span aria-hidden="true">→</span> <ins>{change.after}</ins> </span> </div> ))] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N134 | L47 · UnsavedContactChangesDialog | Aviso no formulário / painel | **text:** [Dinâmico: change.label]<br>**text:** [Dinâmico: change.before]<br>**text:** →<br>**text:** [Dinâmico: change.after] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N135 | L48 · UnsavedContactChangesDialog | Aviso no formulário / painel | **text:** [Dinâmico: change.label] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N136 | L49 · UnsavedContactChangesDialog | Aviso no formulário / painel | **text:** [Dinâmico: change.before]<br>**text:** →<br>**text:** [Dinâmico: change.after] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/UpdateNotifier.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N137 | L123 · installUpdate | Aviso / erro / status | **message:** Das Update wird heruntergeladen … | Decidir com o usuário | Pendente |
| N138 | L139 · installUpdate | Aviso / erro / status | **message:** Das Update wird heruntergeladen … {percentage} % | Decidir com o usuário | Pendente |
| N139 | L147 · installUpdate | Aviso / erro / status | **message:** Download abgeschlossen. Das Update wird installiert … | Decidir com o usuário | Pendente |
| N140 | L152 · installUpdate | Aviso / erro / status | **message:** Update konnte nicht installiert werden: {error.message}<br>**message:** Update konnte nicht installiert werden. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N141 | L162 · installUpdate | Aviso / erro / status | **message:** Update abgeschlossen. DMH Backup wird neu gestartet … | Decidir com o usuário | Pendente |
| N142 | L168 · installUpdate | Aviso / erro / status | **message:** Update wurde installiert, aber DMH Backup konnte nicht neu gestartet werden: {error.message}<br>**message:** Update wurde installiert. Bitte starten Sie DMH Backup erneut. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N143 | L187 · UpdateNotifier | Aviso no formulário / painel | **text:** Update abgeschlossen<br>**text:** Update fehlgeschlagen<br>**text:** Update wird installiert<br>**text:** Update läuft<br>**text:** Neue Version verfügbar<br>**text:** [Dinâmico: message]<br>**text:** Version {availableUpdate.version} kann jetzt installiert werden. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N144 | L189 · UpdateNotifier | Aviso no formulário / painel | **text:** Update abgeschlossen<br>**text:** Update fehlgeschlagen<br>**text:** Update wird installiert<br>**text:** Update läuft<br>**text:** Neue Version verfügbar<br>**text:** [Dinâmico: message]<br>**text:** Version {availableUpdate.version} kann jetzt installiert werden. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/components/WelcomeSignIn.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N145 | L56 · continueWithEmail | Aviso / erro / status | **message:** Bitte geben Sie eine gültige E-Mail-Adresse ein. | Decidir com o usuário | Pendente |
| N146 | L68 · authenticate | Aviso / erro / status | **message:** Das Kennwort muss mindestens 8 Zeichen lang sein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N147 | L72 · authenticate | Aviso / erro / status | **message:** Die beiden Kennwörter stimmen nicht überein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N148 | L83 · authenticate | Aviso / erro / status | **message:** [Dinâmico: authenticationError.message]<br>**message:** [Dinâmico: String(authenticationError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N149 | L101 · requestPasswordRecovery | Erro de helper | **message:** Die Kennwort-Wiederherstellung ist nur in der installierten Windows-App verfügbar. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N150 | L110 · requestPasswordRecovery | Aviso / erro / status | **message:** [Dinâmico: recoveryError.message]<br>**message:** [Dinâmico: String(recoveryError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N151 | L120 · completePasswordRecovery | Aviso / erro / status | **message:** Bitte geben Sie den 6-stelligen Code ein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N152 | L124 · completePasswordRecovery | Aviso / erro / status | **message:** Das Kennwort muss mindestens 8 Zeichen lang sein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N153 | L128 · completePasswordRecovery | Aviso / erro / status | **message:** Die beiden Kennwörter stimmen nicht überein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N154 | L138 · completePasswordRecovery | Aviso / erro / status | **message:** [Dinâmico: recoveryError.message]<br>**message:** [Dinâmico: String(recoveryError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N155 | L178 · WelcomeSignIn | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N156 | L236 · WelcomeSignIn | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N157 | L282 · WelcomeSignIn | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/AuthenticatorPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N158 | L149 · AuthenticatorPage | Aviso / erro / status | **message:** 2FA-Einträge konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N159 | L187 · openMicrosoftSecurityInfo | Aviso / erro / status | **message:** Die Microsoft-Sicherheitsseite konnte nicht geöffnet werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N160 | L244 · saveEntry | Aviso / erro / status | **message:** Der 2FA-Schlüssel wurde verschlüsselt gespeichert. | Decidir com o usuário | Pendente |
| N161 | L246 · saveEntry | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N162 | L282 · importEntries | Aviso / erro / status | **message:** {imported.length - skipped} 2FA-Konten importiert{skipped ? `, ${skipped} bereits vorhanden` : ""}. | Decidir com o usuário | Pendente |
| N163 | L284 · importEntries | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N164 | L295 · loadImportFile | Aviso / erro / status | **message:** Dieser PC unterstützt keine QR-Bilderkennung. Fügen Sie die otpauth-migration://-Adresse als Text ein oder verwenden Sie später die mobile App. | Decidir com o usuário | Pendente |
| N165 | L301 · loadImportFile | Erro de helper | **message:** Im Bild wurde kein QR-Code gefunden. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N166 | L316 · removeEntryNow | Aviso / erro / status | **message:** Der 2FA-Eintrag wurde in den Papierkorb verschoben. | Decidir com o usuário | Pendente |
| N167 | L318 · removeEntryNow | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N168 | L336 · copyCode | Aviso / erro / status | **message:** Der 2FA-Code konnte nicht kopiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N169 | L340 · copyCode | Aviso / erro / status | **message:** Der aktuelle 2FA-Code wurde kopiert. Die Zwischenablage wird nach 30 Sekunden geleert. | Decidir com o usuário | Pendente |
| N170 | L357 · persistReorderedEntries | Aviso / erro / status | **message:** {movedEntry?.platform ?? "2FA-Konto"} wurde an Position {newPosition} verschoben. | Decidir com o usuário | Pendente |
| N171 | L360 · persistReorderedEntries | Aviso / erro / status | **message:** Die Reihenfolge konnte nicht gespeichert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N172 | L510 · showMessage | Aviso / erro / status | **message:** [Dinâmico: value] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N173 | L527 · AuthenticatorPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N174 | L749 · AuthenticatorPage | Confirmação | **title:** 2FA-Eintrag löschen<br>**message:** Möchten Sie „{pendingDelete.platform}“ wirklich in den Papierkorb verschieben?<br>**message:** Möchten Sie diesen 2FA-Eintrag wirklich löschen? | Manter confirmação antes da ação | Pendente |

## src/pages/BackupPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N175 | L21 · create | Aviso / erro / status | **message:** Sicherung wurde erstellt. | Decidir com o usuário | Pendente |
| N176 | L27 · restore | Confirmação | **message:** Die aktuellen Daten werden durch die Sicherung ersetzt. Fortfahren? | Manter confirmação antes da ação | Pendente |
| N177 | L31 · restore | Aviso / erro / status | **message:** Sicherung wurde wiederhergestellt. Die App wird neu geladen. | Decidir com o usuário | Pendente |
| N178 | L43 · BackupPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N179 | L44 · BackupPage | Aviso no formulário / painel | **title:** Der lokale Sicherungsverlauf funktioniert ohne Microsoft-Konto und schützt vor versehentlichen Änderungen.<br>**text:** Automatischer Sicherungsverlauf aktiv<br>**text:** Speichert nur Änderungen und bewahrt gelöschte Kontakte, Gruppen und Termine dauerhaft lokal auf | Decidir com o usuário | Pendente |

## src/pages/CalendarPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N180 | L562 · CalendarPage | Aviso / erro / status | **message:** Die gespeicherten Kalenderdaten konnten nicht geladen werden. | Decidir com o usuário | Pendente |
| N181 | L575 · reloadCategories | Aviso / erro / status | **message:** Die gespeicherten Kalenderkategorien konnten nicht geladen werden. | Decidir com o usuário | Pendente |
| N182 | L622 · CalendarPage | Aviso / erro / status | **message:** Microsoft 365 ist nicht verbunden. | Decidir com o usuário | Pendente |
| N183 | L625 · CalendarPage | Aviso / erro / status | **message:** Exchange-Kalender konnten nicht geladen werden. Termin erneut öffnen, um es nochmals zu versuchen. | Decidir com o usuário | Pendente |
| N184 | L670 · reloadStoredEvents | Aviso / erro / status | **message:** Die von Microsoft 365 empfangenen Kalenderdaten konnten nicht angezeigt werden. | Decidir com o usuário | Pendente |
| N185 | L675 · showAutomaticSyncStatus | Aviso / erro / status | **message:** [Dinâmico: detail.message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N186 | L793 · persist | Aviso / erro / status | **message:** Kalenderänderung konnte nicht sicher gespeichert werden. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N187 | L809 · persistSingleEvent | Aviso / erro / status | **message:** Kalenderänderung konnte nicht sicher gespeichert werden. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N188 | L824 · persistRemovedEvent | Aviso / erro / status | **message:** Kalenderänderung konnte nicht sicher gespeichert werden. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N189 | L890 · openCategoryManager | Aviso / erro / status | **message:** Kategorien konnten nicht vollständig geladen werden: {String(error)}. Bitte neu laden. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N190 | L932 · reviewExactDuplicates | Aviso / erro / status | **message:** Kalender wird auf Duplikate geprüft … | Decidir com o usuário | Pendente |
| N191 | L940 · reviewExactDuplicates | Diálogo de resultado | **title:** Duplikate geprüft<br>**summary:** Es wurden keine Termine mit gleichem Titel, Datum und Beginn gefunden. | Decidir com o usuário | Pendente |
| N192 | L950 · reviewExactDuplicates | Diálogo de resultado | **title:** Duplikate konnten nicht geprüft werden<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N193 | L958 · cleanupExactDuplicates | Aviso / erro / status | **message:** Keine doppelten Termine gefunden. | Decidir com o usuário | Pendente |
| N194 | L976 · cleanupExactDuplicates | Diálogo de resultado | **title:** Duplikate nicht entfernt<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N195 | L982 · cleanupExactDuplicates | Diálogo de resultado | **title:** Duplikate entfernt<br>**summary:** {result.removedEvents.length} überzählige {result.removedEvents.length === 1 ? "Kopie wurde" : "Kopien wurden"} entfernt.<br>**details:** Je Termin bleibt immer eine Kopie erhalten.<br>**details:** Die entfernten Kopien sind gesichert und können über „Bereinigung rückgängig“ wiederhergestellt werden.<br>**details:** [Dinâmico: ...(result.removedEvents.length > 500 ? ["Aus Leistungsgründen zeigt diese Liste die ersten 500 Einträge. Im Papierkorb sind alle Kopien vollständig vorhanden."] : [])] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N196 | L1000 · undoDuplicateCleanup | Aviso / erro / status | **message:** Keine frühere Duplikatbereinigung zum Wiederherstellen vorhanden. | Decidir com o usuário | Pendente |
| N197 | L1003 · undoDuplicateCleanup | Confirmação | **message:** {backup.removedEventIds.length} zuvor entfernte Kalenderkopien wiederherstellen? | Manter confirmação antes da ação | Pendente |
| N198 | L1012 · undoDuplicateCleanup | Diálogo de resultado | **title:** Bereinigung konnte nicht rückgängig gemacht werden<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N199 | L1017 · undoDuplicateCleanup | Diálogo de resultado | **title:** Bereinigung rückgängig gemacht<br>**summary:** {backup.removedEventIds.length} {backup.removedEventIds.length === 1 ? "Kalenderkopie wurde" : "Kalenderkopien wurden"} wiederhergestellt.<br>**details:** Bestehende Termine wurden dabei nicht überschrieben. | Decidir com o usuário | Pendente |
| N200 | L1027 · createCategory | Erro de helper | **message:** Bitte geben Sie einen Namen mit höchstens 255 Zeichen ein. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N201 | L1028 · createCategory | Erro de helper | **message:** Diese Kategorie gibt es bereits. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N202 | L1038 · createCategory | Resultado de ação | **message:** Kategorie „{name}“ wurde in Exchange bestätigt.<br>**message:** Kategorie „{name}“ wurde lokal erstellt. | Decidir com o usuário | Pendente |
| N203 | L1054 · updateCategoryColor | Resultado de ação | **message:** Die Farbe von „{category.name}“ wurde in Exchange bestätigt.<br>**message:** Die Farbe von „{category.name}“ wurde lokal gespeichert. | Decidir com o usuário | Pendente |
| N204 | L1060 · changeCategories | Erro de helper | **message:** Diese Kategorie gibt es bereits. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N205 | L1086 · changeCategories | Resultado de ação | **message:** {operation.names.length} {replacement ? "Kategorie umbenannt" : "Kategorien gelöscht"}. {localEvents} Termine in der App{operation.exchange ? ` und ${exchangeEvents} in Exchange aktualisiert` : " aktualisiert"}. | Decidir com o usuário | Pendente |
| N206 | L1097 · repairExchangeCategoryColors | Diálogo de resultado | **title:** Microsoft-365-Testmodus: nur lesen<br>**summary:** Diese App darf keine Exchange-Farben ändern. Öffnen Sie die verbundene Admin-Test-App ohne „NUR LESEN“, um die Farben zu reparieren. | Decidir com o usuário | Pendente |
| N207 | L1106 · repairExchangeCategoryColors | Diálogo de resultado | **title:** Keine verknüpften Exchange-Termine gefunden<br>**summary:** Es gibt derzeit keine bereits verknüpften Termine, deren Kategorien isoliert repariert werden können. | Decidir com o usuário | Pendente |
| N208 | L1116 · confirmed | Confirmação | **message:** [Dinâmico: `${preview.linkedEvents} bereits verknüpfte Exchange-Termine werden geprüft.\n` + `${preview.categoriesToRepair} Master-Kategorien müssen angelegt oder farblich korrigiert werden.\n\n` + `Die normale Warteschlange mit ${preview.pendingOperations} Vorgängen, darunter ${preview.pendingDeletions} Löschungen, wird NICHT ausgeführt oder verändert.` + `${categorySummary}\n\nJetzt ausschließlich Kategorien und Farben reparieren?`] | Manter confirmação antes da ação | Pendente |
| N209 | L1128 · repairExchangeCategoryColors | Diálogo de resultado | **title:** Kategorien in Exchange bestätigt<br>**title:** Exchange-Kategorien teilweise bestätigt<br>**summary:** Exchange hat die gespeicherte Kategorie bei {result.updated} von {result.scanned} erneut gelesenen Terminen bestätigt.<br>**details:** Die {preview.pendingOperations} ausstehenden Synchronisierungsvorgänge wurden nicht ausgeführt oder verändert.<br>**details:** Titel, Uhrzeit, Teilnehmer und Inhalte der Termine blieben unverändert.<br>**details:** Falls Teams weiterhin Grau zeigt, laden Sie den Kalender neu und prüfen Sie die Kategorie desselben Termins in Outlook.<br>**details:** [Dinâmico: ...result.errorMessages] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N210 | L1140 · repairExchangeCategoryColors | Diálogo de resultado | **title:** Exchange-Farben konnten nicht repariert werden<br>**summary:** [Dinâmico: String(error)]<br>**details:** Falls die Berechtigung für Kategorien fehlt, verbinden Sie Microsoft 365 einmal neu und versuchen Sie es erneut. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N211 | L1461 · forwardContextMenuEvent | Aviso / erro / status | **message:** E-Mail-Programm zum Weiterleiten geöffnet. | Decidir com o usuário | Pendente |
| N212 | L1463 · forwardContextMenuEvent | Aviso / erro / status | **message:** Das E-Mail-Programm konnte nicht geöffnet werden. | Decidir com o usuário | Pendente |
| N213 | L1485 · exportContextMenuEvent | Diálogo de resultado | **title:** Termin als ICS gespeichert<br>**summary:** „{target.title \|\| "Ohne Titel"}“ kann jetzt in einem Kalenderprogramm importiert werden. | Decidir com o usuário | Pendente |
| N214 | L1487 · exportContextMenuEvent | Diálogo de resultado | **title:** ICS-Datei konnte nicht erstellt werden<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N215 | L1500 · saveEvent | Erro de helper | **message:** Dieser Kalender erlaubt keine Änderungen. Bitte einen beschreibbaren Kalender mit ausgehender Synchronisierung wählen. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N216 | L1510 · saveEvent | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N217 | L1525 · deleteEvent | Confirmação | **message:** {objectName} wirklich löschen? | Manter confirmação antes da ação | Pendente |
| N218 | L1528 · deleteEvent | Diálogo de resultado | **title:** Terminserie in den Papierkorb verschoben<br>**title:** Termin in den Papierkorb verschoben<br>**summary:** „{master.title}“ kann im Papierkorb wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N219 | L1541 · deleteAllEvents | Confirmação | **message:** Alle {allEvents.length} Termine und Terminserien in den Papierkorb verschieben? | Manter confirmação antes da ação | Pendente |
| N220 | L1552 · deleteAllEvents | Diálogo de resultado | **title:** Termine in den Papierkorb verschoben<br>**summary:** {movedEvents.length} Termine und Serien können im Papierkorb wiederhergestellt werden.<br>**details:** Aus Leistungsgründen zeigt diese Liste die ersten 100 Einträge. Im Papierkorb sind alle Termine vollständig vorhanden.<br>**details:** [Dinâmico: undefined] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N221 | L1561 · deleteAllEvents | Diálogo de resultado | **title:** Termine konnten nicht gelöscht werden<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N222 | L1566 · openReconciliation | Aviso / erro / status | **message:** Kalenderdaten werden für den Vergleich vorbereitet … | Decidir com o usuário | Pendente |
| N223 | L1574 · openReconciliation | Diálogo de resultado | **title:** Kalendervergleich konnte nicht geöffnet werden<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N224 | L1614 · CalendarPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N225 | L1643 · CalendarPage | Aviso no formulário / painel | **text:** Als Duplikat gilt ein Termin nur, wenn Titel, Datum und Startzeit gleich sind. Sobald eines dieser drei Merkmale abweicht, bleiben beide Termine erhalten. | Decidir com o usuário | Pendente |

## src/pages/ContactsPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N226 | L463 · ContactsPage | Aviso / erro / status | **message:** Fehler beim Laden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N227 | L472 · reloadMicrosoft365Changes | Aviso / erro / status | **message:** Microsoft-365-Änderungen konnten nicht angezeigt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N228 | L508 · ContactsPage | Aviso / erro / status | **message:** Kontakte konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N229 | L552 · reviewContactDuplicates | Diálogo de resultado | **title:** Duplikate geprüft<br>**summary:** Es wurden keine möglichen Kontaktduplikate gefunden.<br>**details:** Ihre Kontakte wurden nicht verändert. | Decidir com o usuário | Pendente |
| N230 | L562 · reviewContactDuplicates | Diálogo de resultado | **title:** Duplikate konnten nicht geprüft werden<br>**summary:** Die Kontakte bleiben unverändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N231 | L592 · cleanContactDuplicates | Diálogo de resultado | **title:** Kontaktduplikate bereinigt<br>**title:** Keine sicheren Duplikate entfernt<br>**summary:** {result.removed} {result.removed === 1 ? "doppelte Kopie wurde" : "doppelte Kopien wurden"} in den Papierkorb verschoben. Jeweils ein vollständiger Kontakt bleibt erhalten.<br>**summary:** Es wurden keine Kontakte gelöscht, weil die gefundenen Einträge nicht eindeutig genug zusammenpassen.<br>**details:** Ergänzende Angaben wie E-Mail-Adresse, Telefonnummer und Gruppenzuordnung wurden im erhaltenen Kontakt zusammengeführt.<br>**details:** {remainingGroups.length} unsichere Treffergruppen bleiben zur manuellen Prüfung erhalten.<br>**details:** Es sind keine weiteren möglichen Duplikate übrig.<br>**details:** Die entfernten Kopien können im Papierkorb wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N232 | L611 · cleanContactDuplicates | Diálogo de resultado | **title:** Duplikate nicht bereinigt<br>**summary:** Es wurden keine Kontakte verändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N233 | L638 · submitGroup | Aviso / erro / status | **message:** Bitte geben Sie einen Gruppennamen ein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N234 | L648 · submitGroup | Diálogo de resultado | **title:** Gruppe erstellt<br>**summary:** „{name}“ steht jetzt bereit. | Decidir com o usuário | Pendente |
| N235 | L653 · submitGroup | Aviso / erro / status | **message:** Eine Gruppe mit diesem Namen existiert bereits.<br>**message:** Gruppe konnte nicht erstellt werden: {detail} | Decidir com o usuário | Pendente |
| N236 | L674 · submitGroupRename | Aviso / erro / status | **message:** Bitte geben Sie einen Gruppennamen ein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N237 | L682 · submitGroupRename | Diálogo de resultado | **title:** Gruppe umbenannt<br>**summary:** Die Gruppe heißt jetzt „{name}“. | Decidir com o usuário | Pendente |
| N238 | L687 · submitGroupRename | Aviso / erro / status | **message:** Eine Gruppe mit diesem Namen existiert bereits.<br>**message:** Gruppe konnte nicht umbenannt werden: {detail} | Decidir com o usuário | Pendente |
| N239 | L698 · submit | Diálogo de resultado | **title:** Kontakt nicht gespeichert<br>**summary:** Bitte prüfen Sie zuerst die markierten E-Mail-Adressen. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N240 | L713 · submit | Diálogo de resultado | **title:** Kontakt gespeichert<br>**summary:** „{displayName(editing)}“ wurde lokal gespeichert. | Decidir com o usuário | Pendente |
| N241 | L720 · submit | Diálogo de resultado | **title:** Kontakt nicht gespeichert<br>**summary:** Der Kontakt wurde nicht verändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N242 | L778 · deleteContactNow | Diálogo de resultado | **title:** Kontakt in den Papierkorb verschoben<br>**summary:** „{displayName(contact)}“ kann im Papierkorb wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N243 | L781 · deleteContactNow | Aviso / erro / status | **message:** Die Kontaktübersicht konnte nicht aktualisiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N244 | L785 · deleteContactNow | Diálogo de resultado | **title:** Kontakt nicht gelöscht<br>**summary:** Der Kontakt bleibt unverändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N245 | L800 · deleteGroupNow | Diálogo de resultado | **title:** Gruppe in den Papierkorb verschoben<br>**summary:** „{group.name}“ kann im Papierkorb wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N246 | L804 · deleteGroupNow | Diálogo de resultado | **title:** Gruppe nicht gelöscht<br>**summary:** Die Gruppe bleibt unverändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N247 | L822 · deleteUngroupedGroupNow | Diálogo de resultado | **title:** Gruppe in den Papierkorb verschoben<br>**summary:** „{ungroupedGroupName}“ kann im Papierkorb wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N248 | L826 · deleteUngroupedGroupNow | Diálogo de resultado | **title:** Gruppe nicht gelöscht<br>**summary:** „{ungroupedGroupName}“ bleibt unverändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N249 | L846 · deleteAllContactsNow | Diálogo de resultado | **title:** Kontakte und Gruppen in den Papierkorb verschoben<br>**summary:** {result.contacts} {result.contacts === 1 ? "Kontakt" : "Kontakte"} und {result.groups} {result.groups === 1 ? "Gruppe wurden" : "Gruppen wurden"} nicht endgültig gelöscht und können wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N250 | L859 · deleteAllContactsNow | Diálogo de resultado | **title:** Kontakte und Gruppen nicht gelöscht<br>**summary:** Kontakte und Gruppen bleiben unverändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N251 | L881 · deleteSelectedContactsNow | Diálogo de resultado | **title:** Kontakte in den Papierkorb verschoben<br>**summary:** 1 Kontakt kann im Papierkorb wiederhergestellt werden.<br>**summary:** {deleted} Kontakte können im Papierkorb wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N252 | L891 · deleteSelectedContactsNow | Diálogo de resultado | **title:** Kontakte nicht gelöscht<br>**summary:** Die ausgewählten Kontakte bleiben unverändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N253 | L922 · copyEmail | Aviso / erro / status | **message:** E-Mail-Adresse wurde kopiert. | Decidir com o usuário | Pendente |
| N254 | L975 · chooseGroupEmailApp | Aviso / erro / status | **message:** "{groupName}" hat keine Kontakte mit E-Mail-Adresse. | Decidir com o usuário | Pendente |
| N255 | L986 · chooseGroupEmailApp | Aviso / erro / status | **message:** E-Mail-Liste konnte nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N256 | L1005 · sendEmail | Aviso / erro / status | **message:** E-Mail-Anwendung konnte nicht geöffnet werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N257 | L1044 · moveContactsToSelection | Diálogo de resultado | **title:** Kontakte verschoben<br>**summary:** Der Kontakt ist jetzt in „{targetLabel}“.<br>**summary:** {contactIds.length} Kontakte sind jetzt in „{targetLabel}“. | Decidir com o usuário | Pendente |
| N258 | L1058 · moveContactsToSelection | Diálogo de resultado | **title:** Kontakte nicht verschoben<br>**summary:** Die Zuordnung wurde nicht geändert: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N259 | L1266 · ContactsPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N260 | L1319 · ContactsPage | Aviso no formulário / painel | **text:** Sicher bereinigen ist möglich.<br>**text:** Die App behält automatisch den vollständigsten Kontakt, ergänzt fehlende Angaben und verschiebt nur passende Kopien in den Papierkorb. Widersprüchliche Kontakte bleiben erhalten. | Decidir com o usuário | Pendente |
| N261 | L1468 · ContactsPage | Aviso no formulário / painel | **text:** [Dinâmico: groupCreateError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N262 | L1499 · ContactsPage | Aviso no formulário / painel | **text:** [Dinâmico: groupRenameError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N263 | L1509 · ContactsPage | Aviso no formulário / painel | **text:** Kontakte werden geladen … | Decidir com o usuário | Pendente |
| N264 | L1883 · ContactsPage | Confirmação | **title:** Alle Kontaktduplikate bereinigen?<br>**message:** Die App führt ergänzende Daten zusammen, behält je Treffer einen Kontakt und verschiebt passende Kopien in den Papierkorb. Bei widersprüchlichen E-Mail-Adressen, Telefonnummern oder Adressen wird nichts gelöscht. | Manter confirmação antes da ação | Pendente |
| N265 | L1895 · ContactsPage | Confirmação | **title:** Gruppe löschen<br>**title:** Gruppe löschen<br>**title:** Alle Kontakte löschen<br>**title:** Kontakte löschen<br>**title:** Kontakt löschen<br>**message:** Möchten Sie die Gruppe „{deleteRequest.group.name}“ wirklich in den Papierkorb verschieben?<br>**message:** Möchten Sie die Gruppe „{ungroupedGroupName}“ wirklich in den Papierkorb verschieben? Die Kontakte bleiben erhalten.<br>**message:** Alle Kontakte und alle vorhandenen Gruppen werden in den Papierkorb verschoben. Möchten Sie fortfahren?<br>**message:** {deleteRequest.contactIds.length} ausgewählte Kontakte werden in den Papierkorb verschoben. Möchten Sie fortfahren?<br>**message:** Möchten Sie den Kontakt „{displayName(deleteRequest.contact)}“ wirklich in den Papierkorb verschieben?<br>**message:** Möchten Sie diesen Eintrag wirklich löschen? | Manter confirmação antes da ação | Pendente |
| N266 | L1928 · onChanged | Aviso / erro / status | **message:** [Dinâmico: nextMessage] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/DienstleistungenPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N267 | L187 · saveBooking | Aviso / erro / status | **message:** Die Buchungsanfrage wurde gespeichert und kann nun bearbeitet werden. | Decidir com o usuário | Pendente |
| N268 | L196 · handleTicketFiles | Aviso / erro / status | **message:** Es können höchstens {maxTicketAttachments} Dateien angehängt werden. | Decidir com o usuário | Pendente |
| N269 | L203 · handleTicketFiles | Aviso / erro / status | **message:** [Dinâmico: errors.join(" ")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N270 | L206 · handleTicketFiles | Aviso / erro / status | **message:** {attachments.length} Datei(en) wurden zum Ticket hinzugefügt. | Decidir com o usuário | Pendente |
| N271 | L217 · saveTicket | Aviso / erro / status | **message:** Ticket {ticket.id} wurde geöffnet. | Decidir com o usuário | Pendente |
| N272 | L237 · saveCheckin | Aviso / erro / status | **message:** Die Mahlzeit wurde reserviert. | Decidir com o usuário | Pendente |
| N273 | L251 · DienstleistungenPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N274 | L500 · ServicesOverview | Aviso no formulário / painel | **text:** Status filtern | Decidir com o usuário | Pendente |
| N275 | L511 · ServicesOverview | Aviso no formulário / painel | **text:** [Dinâmico: record.status] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N276 | L524 · ServicesOverview | Aviso no formulário / painel | **text:** [Dinâmico: selectedRecord.status] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N277 | L563 · updated | Mensagem produzida / repassada | **title:** [Dinâmico: draft.title.trim()]<br>**message:** [Dinâmico: draft.message.trim()] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N278 | L585 · addComment | Mensagem produzida / repassada | **message:** [Dinâmico: comment.trim()] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N279 | L594 · addAttachments | Aviso / erro / status | **message:** Es können höchstens {maxTicketAttachments} Dateien angehängt werden. | Decidir com o usuário | Pendente |
| N280 | L605 · addAttachments | Aviso / erro / status | **message:** [Dinâmico: result.errors.join(" ")]<br>**message:** {result.attachments.length} Datei(en) wurden angehängt. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N281 | L617 · removeAttachment | Aviso / erro / status | **message:** {attachment.name} wurde entfernt. | Decidir com o usuário | Pendente |
| N282 | L634 · changeTicketState | Mensagem produzida / repassada | **message:** Ticket wurde erneut geöffnet und an {responsibleTeam} zurückgegeben.<br>**message:** Ticket wurde geschlossen. Zuständiges Team: {responsibleTeam}. | Decidir com o usuário | Pendente |
| N283 | L642 · TicketRecordDialog | Aviso no formulário / painel | **text:** [Dinâmico: ticket.status] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N284 | L680 · TicketRecordDialog | Aviso no formulário / painel | **text:** [Dinâmico: attachmentMessage] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N285 | L709 · ticketDraft | Mensagem produzida / repassada | **title:** [Dinâmico: ticket.title]<br>**message:** [Dinâmico: ticket.message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N286 | L809 · readFileAsDataUrl | Resultado de ação | **message:** [Dinâmico: new Promise((resolve, reject) => { if (file.size > 2_000_000) { reject(new Error(`${file.name} ist größer als 2 MB.`)); return; } const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`${file.name} konnte nicht gelesen werden.`)); reader.readAsDataURL(file); })] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N287 | L811 · readFileAsDataUrl | Erro de helper | **message:** {file.name} ist größer als 2 MB. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N288 | L816 · readFileAsDataUrl | Erro de helper | **message:** {file.name} konnte nicht gelesen werden. | Revisar propagação; detalhe técnico na EDV | Pendente |

## src/pages/DocumentsPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N289 | L145 · loadItems | Aviso / erro / status | **message:** [Dinâmico: String(loadError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N290 | L163 · loadSharePointSources | Aviso / erro / status | **message:** SharePoint konnte nicht geladen werden: {String(loadError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N291 | L185 · loadSources | Aviso / erro / status | **message:** [Dinâmico: String(loadError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N292 | L206 · poll | Aviso / erro / status | **message:** Die Microsoft-Anmeldung wurde nicht abgeschlossen: {String(pollError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N293 | L222 · startReconnect | Aviso / erro / status | **message:** Die Verbindung wurde nicht abgeschlossen: {String(startError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N294 | L236 · startReconnectWithCode | Aviso / erro / status | **message:** Die Microsoft-Anmeldung konnte nicht automatisch geöffnet werden: {String(openError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N295 | L239 · startReconnectWithCode | Aviso / erro / status | **message:** Die alternative Verbindung konnte nicht gestartet werden: {String(startError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N296 | L245 · reopenMicrosoftSignIn | Aviso / erro / status | **message:** [Dinâmico: String(openError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N297 | L268 · runDocumentSync | Aviso / erro / status | **message:** {summary.conflicts} Konflikt(e) benötigen eine Entscheidung. Keine Version wurde überschrieben. | Decidir com o usuário | Pendente |
| N298 | L269 · runDocumentSync | Aviso / erro / status | **message:** {summary.uploaded} Änderung(en) hochgeladen, {summary.downloaded} aktualisiert. | Decidir com o usuário | Pendente |
| N299 | L270 · runDocumentSync | Aviso / erro / status | **message:** Alle Offline-Dateien sind aktuell. | Decidir com o usuário | Pendente |
| N300 | L271 · runDocumentSync | Aviso / erro / status | **message:** [Dinâmico: summary.errors.join("\n")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N301 | L274 · runDocumentSync | Aviso / erro / status | **message:** Synchronisierung wird später erneut versucht: {String(syncError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N302 | L297 · resolveSyncConflict | Aviso / erro / status | **message:** Beide Versionen wurden sicher aufbewahrt.<br>**message:** Ihre lokale Version wurde übernommen.<br>**message:** Die Online-Version wurde übernommen. Die lokale Fassung bleibt bei Online-Löschungen im Wiederherstellungsordner erhalten. | Decidir com o usuário | Pendente |
| N303 | L298 · resolveSyncConflict | Aviso / erro / status | **message:** [Dinâmico: String(resolveError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N304 | L323 · createFolder | Aviso / erro / status | **message:** Ordner „{name}“ wurde erstellt. | Decidir com o usuário | Pendente |
| N305 | L324 · createFolder | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N306 | L331 · createTextFile | Aviso / erro / status | **message:** Datei „{name}“ wurde erstellt. | Decidir com o usuário | Pendente |
| N307 | L332 · createTextFile | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N308 | L339 · renameItem | Aviso / erro / status | **message:** Element wurde umbenannt. | Decidir com o usuário | Pendente |
| N309 | L340 · renameItem | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N310 | L346 · removeItems | Confirmação | **message:** {label} in den Microsoft-365-Papierkorb verschieben? | Manter confirmação antes da ação | Pendente |
| N311 | L350 · removeItems | Aviso / erro / status | **message:** {deleted} Element(e) wurden in den Papierkorb verschoben. | Decidir com o usuário | Pendente |
| N312 | L351 · removeItems | Aviso / erro / status | **message:** {deleted} Element(e) gelöscht. Danach: {String(actionError)}<br>**message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N313 | L361 · downloadItem | Aviso / erro / status | **message:** Offline gespeichert: {path} | Decidir com o usuário | Pendente |
| N314 | L363 · downloadItem | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N315 | L381 · uploadLocalRevision | Confirmação | **message:** Lokale Änderungen an „{item.name}“ nach Microsoft 365 hochladen? Bei einem Online-Konflikt wird nichts überschrieben. | Manter confirmação antes da ação | Pendente |
| N316 | L383 · uploadLocalRevision | Aviso / erro / status | **message:** Die lokale Version wurde sicher hochgeladen. | Decidir com o usuário | Pendente |
| N317 | L384 · uploadLocalRevision | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N318 | L394 · makeFolderOffline | Aviso / erro / status | **message:** „{item.name}“ ist jetzt immer offline verfügbar: {result.files} Datei(en), {result.folders} Ordner. | Decidir com o usuário | Pendente |
| N319 | L395 · makeFolderOffline | Aviso / erro / status | **message:** [Dinâmico: (current) => `${current} ${result.skippedLocalChanges} lokale Änderung(en) bleiben geschützt.`] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N320 | L396 · makeFolderOffline | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N321 | L405 · uploadPaths | Aviso / erro / status | **message:** {files} Datei(en) und {folders} Ordner hochgeladen. | Decidir com o usuário | Pendente |
| N322 | L406 · uploadPaths | Aviso / erro / status | **message:** {files \|\| folders ? `${files} Datei(en), ${folders} Ordner verarbeitet. ` : ""}{String(actionError)} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N323 | L432 · transferItems | Aviso / erro / status | **message:** [Dinâmico: result.errors.join("\n")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N324 | L434 · transferItems | Aviso / erro / status | **message:** {count} Element(e) {result.queued ? "werden kopiert" : "wurden kopiert"}.<br>**message:** {count} Element(e) wurden verschoben. | Decidir com o usuário | Pendente |
| N325 | L438 · transferItems | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N326 | L445 · placeOnClipboard | Aviso / erro / status | **message:** {targets.length} Element(e) zum {operation === "copy" ? "Kopieren" : "Verschieben"} vorgemerkt. | Decidir com o usuário | Pendente |
| N327 | L450 · allowEdit | Confirmação | **message:** Soll der Link Bearbeitung erlauben? OK = Bearbeiten, Abbrechen = Nur anzeigen | Manter confirmação antes da ação | Pendente |
| N328 | L452 · shareItem | Aviso / erro / status | **message:** Interner Freigabelink wurde in die Zwischenablage kopiert. | Decidir com o usuário | Pendente |
| N329 | L453 · shareItem | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N330 | L460 · showVersions | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N331 | L464 · restoreVersion | Confirmação | **message:** Version {version.id} als aktuelle Version wiederherstellen? | Manter confirmação antes da ação | Pendente |
| N332 | L466 · restoreVersion | Aviso / erro / status | **message:** Version {version.id} wurde wiederhergestellt. | Decidir com o usuário | Pendente |
| N333 | L467 · restoreVersion | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N334 | L527 · openLocalFolder | Aviso / erro / status | **message:** [Dinâmico: String(actionError)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N335 | L573 · DocumentsPage | Aviso no formulário / painel | **text:** Microsoft-Anmeldung abschließen<br>**text:** Microsoft 365 ist nicht verbunden<br>**text:** Ihre gespeicherte Anmeldung ist nicht mehr gültig. Verbinden Sie das Konto erneut, damit OneDrive und SharePoint wieder angezeigt und synchronisiert werden.<br>**text:** Die geschützte Microsoft-Anmeldung wurde geöffnet. Der einmalige Code wurde automatisch kopiert. Geben Sie ihn dort ein und melden Sie sich mit Ihrem Microsoft-Konto an.<br>**text:** Ihr Anmeldecode<br>**text:** [Dinâmico: reconnectCode.userCode]<br>**text:** Bereits in die Zwischenablage kopiert<br>**text:** Diese Seite verbindet sich danach automatisch.<br>**text:** [Dinâmico: reconnectError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N336 | L592 · DocumentsPage | Aviso no formulário / painel | **text:** [Dinâmico: reconnectError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N337 | L596 · DocumentsPage | Aviso no formulário / painel | **text:** [Dinâmico: error] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N338 | L597 · DocumentsPage | Aviso no formulário / painel | **text:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N339 | L602 · DocumentsPage | Aviso no formulário / painel | **text:** [Dinâmico: sourcesError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N340 | L629 · DocumentsPage | Aviso no formulário / painel | **text:** [Dinâmico: visibleItems.length]<br>**text:** Element(e)<br>**text:** {selectedIds.size} ausgewählt<br>**text:** Rechtsklick für Aktionen · Strg+A wählt alles aus<br>**text:** [Dinâmico: clipboard.items.length]<br>**text:** vorgemerkt | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N341 | L629 · DocumentsPage | Aviso no formulário / painel | **text:** [Dinâmico: clipboard.items.length]<br>**text:** vorgemerkt | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/ExportPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N342 | L60 · ExportPage | Aviso / erro / status | **message:** Gruppen konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N343 | L66 · ExportPage | Aviso / erro / status | **message:** Outlook-Konten konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N344 | L101 · showExportResult | Diálogo de resultado | **title:** [Dinâmico: title]<br>**summary:** [Dinâmico: summary]<br>**details:** [Dinâmico: details] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N345 | L166 · runContactExport | Diálogo de resultado | **title:** Kontaktdatei wurde erstellt<br>**summary:** {contacts.length} Kontakte aus ausgewählten Gruppen wurden exportiert.<br>**summary:** {contacts.length} Kontakte wurden exportiert.<br>**details:** Die CSV-Datei kann jetzt in einem Tabellenprogramm geöffnet werden.<br>**details:** Öffnen Sie Outlook, gehen Sie zu Personen/Kontakte und wählen Sie Importieren. | Decidir com o usuário | Pendente |
| N346 | L177 · runContactExport | Diálogo de resultado | **title:** Kontaktdatei konnte nicht erstellt werden<br>**summary:** [Dinâmico: String(error)]<br>**details:** Ihre Kontakte im App wurden nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N347 | L185 · runCalendarExport | Diálogo de resultado | **title:** Keine Termine zum Exportieren<br>**summary:** Im Kalender wurden keine Termine gefunden. | Decidir com o usuário | Pendente |
| N348 | L201 · runCalendarExport | Diálogo de resultado | **title:** Kalenderdatei wurde erstellt<br>**summary:** {events.length} Termine und Terminserien wurden für {calendarTargetNames[target]} exportiert.<br>**details:** Importieren Sie die Datei in Apple Kalender. Dies ist eine einmalige Übertragung.<br>**details:** Importieren Sie die Datei am Computer unter Google Kalender → Einstellungen → Importieren & Exportieren.<br>**details:** Importieren Sie die Datei in den Outlook-Kalender desselben Microsoft-365-Kontos; die Termine erscheinen danach auch im Teams-Kalender.<br>**details:** Die ICS-Datei kann in gängigen Kalenderprogrammen importiert werden. | Decidir com o usuário | Pendente |
| N349 | L208 · runCalendarExport | Diálogo de resultado | **title:** Kalenderdatei konnte nicht erstellt werden<br>**summary:** [Dinâmico: String(error)]<br>**details:** Ihre Termine im App wurden nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N350 | L214 · runDirectOutlookExport | Diálogo de resultado | **title:** Outlook-Übertragung nicht verfügbar<br>**summary:** Diese Funktion steht nur in der installierten Windows-App zur Verfügung. | Decidir com o usuário | Pendente |
| N351 | L230 · runDirectOutlookExport | Diálogo de resultado | **title:** Keine Kontakte übertragen<br>**summary:** Es wurden keine passenden Kontakte für die gewählte Auswahl gefunden. | Decidir com o usuário | Pendente |
| N352 | L232 · runDirectOutlookExport | Diálogo de resultado | **title:** Outlook-Übertragung teilweise abgeschlossen<br>**summary:** {result.autocompleteResolved} Vorschläge wurden vorbereitet. {result.autocompleteErrors} E-Mail-Adressen konnten nicht vollständig verarbeitet werden.<br>**summary:** {result.linked} von {result.total} Kontakten wurden an Outlook übertragen.<br>**details:** {result.errors + result.autocompleteErrors} Einträge konnten nicht vollständig verarbeitet werden.<br>**details:** Die Kontakte im App wurden nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N353 | L241 · runDirectOutlookExport | Diálogo de resultado | **title:** Outlook-Übertragung abgeschlossen<br>**summary:** {result.autocompleteResolved} E-Mail-Adressen wurden für die Outlook-Autovervollständigung vorbereitet.<br>**summary:** {result.total} Kontakte wurden in {result.foldersUsed} Outlook-Ordner übertragen.<br>**summary:** {result.total} Kontakte wurden in {result.foldersUsed} Outlook-Ordner übertragen.<br>**details:** Es wurden keine Outlook-Kontakte angelegt.<br>**details:** {result.autocompleteResolved} Adressen wurden zusätzlich für die Empfängersuche vorbereitet.<br>**details:** [Dinâmico: undefined] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N354 | L257 · runDirectOutlookExport | Diálogo de resultado | **title:** Outlook-Übertragung fehlgeschlagen<br>**summary:** [Dinâmico: String(error)]<br>**details:** Ihre Kontakte im App wurden nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N355 | L265 · runDirectOutlookCalendarExport | Diálogo de resultado | **title:** Outlook-Übertragung nicht verfügbar<br>**summary:** Diese Funktion steht nur in der installierten Windows-App zur Verfügung. | Decidir com o usuário | Pendente |
| N356 | L270 · runDirectOutlookCalendarExport | Diálogo de resultado | **title:** Keine Termine übertragen<br>**summary:** Im Kalender wurden keine Termine gefunden. | Decidir com o usuário | Pendente |
| N357 | L280 · runDirectOutlookCalendarExport | Diálogo de resultado | **title:** Kalender teilweise übertragen<br>**summary:** {result.created + result.updated} von {result.total} Terminen wurden an Outlook übertragen.<br>**details:** {result.errors} Termine konnten nicht vollständig verarbeitet werden.<br>**details:** Ihre Termine im App wurden nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N358 | L287 · runDirectOutlookCalendarExport | Diálogo de resultado | **title:** Kalender übertragen<br>**summary:** {result.total} Termine wurden an Outlook Classic übertragen.<br>**details:** {result.created} neu angelegt · {result.updated} aktualisiert | Decidir com o usuário | Pendente |
| N359 | L292 · runDirectOutlookCalendarExport | Diálogo de resultado | **title:** Outlook-Kalenderübertragung fehlgeschlagen<br>**summary:** [Dinâmico: String(error)]<br>**details:** Ihre Termine im App wurden nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N360 | L332 · ExportPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N361 | L423 · ExportPage | Aviso no formulário / painel | **text:** Bitte mindestens einen Ordner auswählen. | Decidir com o usuário | Pendente |
| N362 | L452 · ExportPage | Aviso no formulário / painel | **text:** [Dinâmico: selectedMailAccount.accountName]<br>**text:** [Dinâmico: selectedMailAccount.email]<br>**text:** [Dinâmico: selectedMailAccount.email] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N363 | L453 · ExportPage | Aviso no formulário / painel | **text:** Alle Kontaktordner<br>**text:** Ausgewählte Kontaktordner<br>**text:** Alle Kontaktordner und Kontakte ohne Gruppe werden übertragen.<br>**text:** Nur diese Ordner werden übertragen: {[ ...selectedOutlookGroups.map((group) => group.name), ...(includeUngroupedOutlook ? ["Gesammelte Adressen"] : []) ].join(", ")}.<br>**text:** Noch kein Ordner ausgewählt. | Decidir com o usuário | Pendente |
| N364 | L454 · ExportPage | Aviso no formulário / painel | **text:** Nur Outlook-Vorschläge<br>**text:** Outlook-Kontakte und Vorschläge<br>**text:** Nur Kontaktordner<br>**text:** Es werden keine Outlook-Kontakte angelegt.<br>**text:** Outlook nach der Übertragung einmal normal schließen.<br>**text:** Die Autovervollständigung bleibt unverändert. | Decidir com o usuário | Pendente |
| N365 | L455 · ExportPage | Aviso no formulário / painel | **text:** {directOutlookResult.autocompleteResolved} Outlook-Vorschläge<br>**text:** {directOutlookResult.linked} Kontakte · {directOutlookResult.foldersUsed} Gruppenordner<br>**text:** {directOutlookResult.autocompleteErrors} Adressen konnten nicht vorbereitet werden<br>**text:** {directOutlookResult.contactCopies} Einträge · {directOutlookResult.created} neu · {directOutlookResult.updated} aktualisiert{outlookContactExportMode === "contacts-and-autocomplete" ? ` · ${directOutlookResult.autocompleteResolved} Vorschläge` : ""}<br>**text:** Ziel:<br>**text:** [Dinâmico: directOutlookResult.folderPath] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N366 | L480 · ExportPage | Aviso no formulário / painel | **text:** [Dinâmico: t.outlookClassic]<br>**text:** [Dinâmico: t.newOutlook]<br>**text:** Allgemeine CSV<br>**text:** Exportiert werden nur Kontakte aus: {selectedGroups.map((group) => group.name).join(", ")}.<br>**text:** Ohne Gruppenauswahl werden alle Kontakte exportiert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N367 | L495 · ExportPage | Aviso no formulário / painel | **text:** [Dinâmico: directOutlookCalendarResult.created + directOutlookCalendarResult.updated]<br>**text:** Termine in<br>**text:** [Dinâmico: directOutlookCalendarResult.storeName]<br>**text:** Outlook<br>**text:** [Dinâmico: directOutlookCalendarResult.created]<br>**text:** neu ·<br>**text:** [Dinâmico: directOutlookCalendarResult.updated]<br>**text:** aktualisiert<br>**text:** Ziel:<br>**text:** [Dinâmico: directOutlookCalendarResult.folderPath] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/ExtrasPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N368 | L86 · ExtrasPage | Aviso no formulário / painel | **text:** Gesendet am {sentAt}<br>**text:** Erfolgreich gesendet | Decidir com o usuário | Pendente |
| N369 | L95 · ExtrasPage | Aviso no formulário / painel | **text:** Nicht eingerichtet | Decidir com o usuário | Pendente |
| N370 | L110 · ExtrasPage | Aviso no formulário / painel | **text:** [Dinâmico: migrationError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N371 | L147 · onFailed | Aviso / erro / status | **message:** Übertragung fehlgeschlagen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/FeatureDevelopmentPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N372 | L36 · FeatureToggleCard | Aviso no formulário / painel | **text:** Auf diesem PC aktiv<br>**text:** Nicht aktiv | Decidir com o usuário | Pendente |
| N373 | L61 · confirmed | Confirmação | **message:** App vollständig zurücksetzen? Alle aktiven lokalen App-Daten werden gelöscht. Outlook, Exchange und der lokale Sicherungsverlauf bleiben zur Wiederherstellung erhalten. | Manter confirmação antes da ação | Pendente |
| N374 | L68 · resetApplication | Aviso / erro / status | **message:** Zurücksetzen wurde abgebrochen. | Decidir com o usuário | Pendente |
| N375 | L81 · resetApplication | Aviso / erro / status | **message:** App konnte nicht vollständig zurückgesetzt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N376 | L87 · confirmed | Confirmação | **message:** „An EDV senden“ für eine neue Vorführung zurücksetzen? Die lokale Markierung „Bereits gesendet“ wird entfernt. E-Mail-Konten, Kennwörter und bereits an die EDV übertragene Daten bleiben unverändert. | Manter confirmação antes da ação | Pendente |
| N377 | L96 · resetEdvTransfer | Erro de helper | **message:** Der Versandstatus ist weiterhin als abgeschlossen markiert. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N378 | L98 · resetEdvTransfer | Aviso / erro / status | **message:** „An EDV senden“ wurde vollständig zurückgesetzt. Der Ablauf kann jetzt erneut gestartet und später beliebig oft wieder zurückgesetzt werden. | Decidir com o usuário | Pendente |
| N379 | L101 · resetEdvTransfer | Aviso / erro / status | **message:** EDV-Versandstatus konnte nicht zurückgesetzt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N380 | L158 · FeatureDevelopmentPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/GroupsPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N381 | L22 · GroupsPage | Aviso / erro / status | **message:** Fehler beim Laden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N382 | L30 · submit | Aviso / erro / status | **message:** Bitte geben Sie einen Gruppennamen ein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N383 | L35 · submit | Aviso / erro / status | **message:** Gruppe wurde gespeichert. | Decidir com o usuário | Pendente |
| N384 | L42 · removeNow | Aviso / erro / status | **message:** Gruppe wurde gelöscht. | Decidir com o usuário | Pendente |
| N385 | L60 · GroupsPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N386 | L92 · GroupsPage | Confirmação | **title:** Gruppe löschen<br>**message:** Möchten Sie die Gruppe „{pendingDelete.name}“ wirklich löschen?<br>**message:** Möchten Sie diese Gruppe wirklich löschen? | Manter confirmação antes da ação | Pendente |

## src/pages/ImportPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N387 | L52 · ImportPage | Aviso / erro / status | **message:** Gruppen konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N388 | L76 · ImportPage | Aviso / erro / status | **message:** Ein unterbrochener Kalenderimport kann sicher fortgesetzt werden.<br>**message:** Kalenderdatei ist für den Import bereit. | Decidir com o usuário | Pendente |
| N389 | L98 · chooseMode | Aviso / erro / status | **message:** Wählen Sie eine Kontaktdatei aus.<br>**message:** Wählen Sie eine Kalenderdatei oder Outlook-Datendatei aus. | Decidir com o usuário | Pendente |
| N390 | L128 · chooseFile | Aviso / erro / status | **message:** Outlook-Datendatei wird gelesen. Das kann einige Minuten dauern. | Decidir com o usuário | Pendente |
| N391 | L134 · chooseFile | Aviso / erro / status | **message:** {contactsLabel(contacts.length)} gefunden. Bitte Kontaktgruppe wählen und prüfen. | Decidir com o usuário | Pendente |
| N392 | L136 · chooseFile | Aviso / erro / status | **message:** {eventsLabel(result.events.length)} gefunden. Originalkategorien werden beibehalten; bitte Ersatzkategorie prüfen und bestätigen. | Decidir com o usuário | Pendente |
| N393 | L142 · chooseFile | Aviso / erro / status | **message:** Kalenderdatei wird für den sicheren Import vorbereitet … | Decidir com o usuário | Pendente |
| N394 | L145 · chooseFile | Aviso / erro / status | **message:** Der frühere Importstand wurde gefunden und kann fortgesetzt werden.<br>**message:** Datei ist bereit. Der Import erfolgt speicherschonend in sicheren Blöcken. | Decidir com o usuário | Pendente |
| N395 | L150 · chooseFile | Aviso / erro / status | **message:** Kontaktdatei wird im Hintergrund verarbeitet … | Decidir com o usuário | Pendente |
| N396 | L153 · chooseFile | Aviso / erro / status | **message:** Keine E-Mail-Spalte gefunden. Der Import ist erst möglich, wenn eine Datei mit E-Mail/Kontakt-Spalte gewählt wird.<br>**message:** {contactsLabel(result.contacts.length)} gefunden. Bitte Kontaktgruppe wählen und prüfen. | Decidir com o usuário | Pendente |
| N397 | L162 · chooseFile | Aviso / erro / status | **message:** Import fehlgeschlagen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N398 | L168 · createGroup | Aviso / erro / status | **message:** Bitte geben Sie einen Gruppennamen ein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N399 | L177 · createGroup | Aviso / erro / status | **message:** Gruppe wurde erstellt und für den Import ausgewählt. | Decidir com o usuário | Pendente |
| N400 | L208 · submit | Aviso / erro / status | **message:** Bitte wählen Sie zuerst eine Datei mit importierbaren Daten aus. | Decidir com o usuário | Pendente |
| N401 | L212 · submit | Aviso / erro / status | **message:** Keine E-Mail-Spalte gefunden. Der Import wurde nicht gestartet. | Decidir com o usuário | Pendente |
| N402 | L227 · submit | Aviso / erro / status | **message:** Import wurde sicher pausiert. Sie können ihn später an derselben Stelle fortsetzen. | Decidir com o usuário | Pendente |
| N403 | L252 · submit | Diálogo de resultado | **title:** Import abgeschlossen<br>**summary:** {contactsLabel(importedContacts)} und {eventsLabel(calendarResult.imported)} wurden importiert.<br>**details:** {contactsLabel(skippedContactDuplicates)} mit exakt gleichem Inhalt wurden sicher ausgelassen.<br>**details:** Keine exakt gleichen Kontaktkopien wurden zusätzlich angelegt.<br>**details:** {eventsLabel(calendarResult.skipped)} mit gleicher ID oder exakt gleichen Feldern wurden sicher ausgelassen.<br>**details:** Keine exakt gleichen Kalenderkopien wurden zusätzlich angelegt.<br>**details:** {calendarResult.categories} Kategorie(n) mit Farbe wurden übernommen.<br>**details:** Es mussten keine zusätzlichen Kategorien angelegt werden. | Decidir com o usuário | Pendente |
| N404 | L264 · submit | Diálogo de resultado | **title:** Import fehlgeschlagen<br>**summary:** [Dinâmico: String(error)]<br>**details:** Bereits vorhandene Daten wurden nicht gelöscht.<br>**details:** Sie können den Import nach der Prüfung erneut starten. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N405 | L278 · pauseNativeImport | Aviso / erro / status | **message:** Der Import wird nach dem aktuellen sicheren Block pausiert … | Decidir com o usuário | Pendente |
| N406 | L286 · cancelPreview | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N407 | L291 · cancelPreview | Aviso / erro / status | **message:** Import abgebrochen. | Decidir com o usuário | Pendente |
| N408 | L304 · ImportPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N409 | L431 · ImportPage | Aviso no formulário / painel | **text:** [Dinâmico: nativeCalendarImport.lastError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N410 | L443 · ImportPage | Aviso no formulário / painel | **text:** E-Mail-Spalte erkannt: {preview.mapping.email}<br>**text:** Keine E-Mail-Spalte gefunden<br>**text:** [Dinâmico: pendingEvents.length]<br>**text:** Kalendertermine erkannt<br>**text:** Ersatzkategorie:<br>**text:** [Dinâmico: calendarCategory.trim()]<br>**text:** Allgemein<br>**text:** Die Datei wird direkt vom Datenträger gelesen; Termine werden nicht vollständig in den Arbeitsspeicher geladen.<br>**text:** Ersatzkategorie:<br>**text:** [Dinâmico: calendarCategory.trim()]<br>**text:** Allgemein<br>**text:** [Dinâmico: contactsWithEmail.length]<br>**text:** Kontakte mit E-Mail erkannt<br>**text:** [Dinâmico: contactsWithoutEmail.length]<br>**text:** Kontakte ohne E-Mail erkannt<br>**text:** Ziel:<br>**text:** Gesammelte Adressen<br>**text:** [Dinâmico: groups.find((group) => group.id === selectedGroupId)?.name]<br>**text:** Gruppe | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N411 | L504 · ImportPage | Aviso no formulário / painel | **text:** Diese Personen haben keine erkannte E-Mail-Adresse. Sie können ausgewählt bleiben, werden aber ohne E-Mail importiert. | Decidir com o usuário | Pendente |

## src/pages/Microsoft365Page.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N412 | L92 · prepareCompleteSynchronization | Aviso / erro / status | **message:** Die automatische Synchronisierung konnte nicht eingerichtet werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N413 | L112 · loadStatus | Aviso / erro / status | **message:** Microsoft-365-Status konnte nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N414 | L128 · handleAutomaticSync | Aviso / erro / status | **message:** [Dinâmico: detail.message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N415 | L152 · poll | Aviso / erro / status | **message:** Microsoft 365 wurde verbunden. Kontakte und Kalender werden jetzt automatisch synchronisiert. | Decidir com o usuário | Pendente |
| N416 | L165 · poll | Aviso / erro / status | **message:** Microsoft-365-Anmeldung wurde nicht abgeschlossen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N417 | L186 · connect | Aviso / erro / status | **message:** Microsoft 365 wurde verbunden. Kontakte und Kalender werden jetzt automatisch synchronisiert. | Decidir com o usuário | Pendente |
| N418 | L191 · connect | Aviso / erro / status | **message:** Microsoft-365-Anmeldung wurde nicht abgeschlossen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N419 | L204 · connectWithCode | Aviso / erro / status | **message:** Alternative Anmeldung: Geben Sie den angezeigten Code bei Microsoft ein. | Decidir com o usuário | Pendente |
| N420 | L209 · connectWithCode | Aviso / erro / status | **message:** Alternative Microsoft-Anmeldung konnte nicht gestartet werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N421 | L223 · cancelConnection | Aviso / erro / status | **message:** Anmeldung wurde abgebrochen. | Decidir com o usuário | Pendente |
| N422 | L231 · copyCode | Aviso / erro / status | **message:** Anmeldecode wurde kopiert. | Decidir com o usuário | Pendente |
| N423 | L234 · copyCode | Aviso / erro / status | **message:** Anmeldecode konnte nicht kopiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N424 | L245 · testConnection | Aviso / erro / status | **message:** Verbindung zu Microsoft 365 wurde erfolgreich geprüft. | Decidir com o usuário | Pendente |
| N425 | L248 · testConnection | Aviso / erro / status | **message:** Microsoft-365-Verbindung konnte nicht bestätigt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N426 | L255 · disconnect | Confirmação | **message:** Microsoft-365-Konto von dieser App trennen? Kontakte, Kalender und Daten in Microsoft 365 werden dadurch nicht gelöscht. | Manter confirmação antes da ação | Pendente |
| N427 | L264 · disconnect | Aviso / erro / status | **message:** Microsoft-365-Konto wurde von dieser App getrennt. | Decidir com o usuário | Pendente |
| N428 | L267 · disconnect | Aviso / erro / status | **message:** Microsoft-365-Konto konnte nicht getrennt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N429 | L277 · synchronizeEverythingNow | Aviso / erro / status | **message:** Die automatische Synchronisierung für Kontakte und Kalender ist jetzt aktiv. | Decidir com o usuário | Pendente |
| N430 | L282 · synchronizeEverythingNow | Aviso / erro / status | **message:** Kontakte und Kalender werden jetzt geprüft … | Decidir com o usuário | Pendente |
| N431 | L310 · Microsoft365Page | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N432 | L386 · Microsoft365Page | Aviso no formulário / painel | **text:** [Dinâmico: status.account.displayName.trim().slice(0, 1).toUpperCase()]<br>**text:** M<br>**text:** Verbunden<br>**text:** [Dinâmico: status.account.displayName]<br>**text:** [Dinâmico: status.account.email]<br>**text:** [Dinâmico: status.account.userPrincipalName] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N433 | L412 · Microsoft365Page | Aviso no formulário / painel | **text:** Wird eingerichtet …<br>**text:** Prüfung fehlgeschlagen<br>**text:** Im Hintergrund aktiv<br>**text:** Nicht aktiv | Decidir com o usuário | Pendente |
| N434 | L418 · Microsoft365Page | Aviso no formulário / painel | **text:** Letzte Prüfung nicht erfolgreich<br>**text:** [Dinâmico: syncRuntimeStatus.lastError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/PasswordsPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N435 | L90 · PasswordsPage | Aviso / erro / status | **message:** Passwörter konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N436 | L131 · saveEntry | Aviso / erro / status | **message:** Der Passwort-Eintrag wurde verschlüsselt gespeichert. | Decidir com o usuário | Pendente |
| N437 | L134 · saveEntry | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N438 | L148 · removeEntryNow | Aviso / erro / status | **message:** Der Passwort-Eintrag wurde in den Papierkorb verschoben. | Decidir com o usuário | Pendente |
| N439 | L151 · removeEntryNow | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N440 | L173 · removeAllEntriesNow | Aviso / erro / status | **message:** {removed} Passwort-Einträge wurden in den Papierkorb verschoben. | Decidir com o usuário | Pendente |
| N441 | L176 · removeAllEntriesNow | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N442 | L203 · copyValue | Aviso / erro / status | **message:** {label} wurde kopiert. Die Zwischenablage wird nach 30 Sekunden geleert. | Decidir com o usuário | Pendente |
| N443 | L237 · saveProtection | Aviso / erro / status | **message:** Die beiden App-Kennwörter stimmen nicht überein. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N444 | L252 · saveProtection | Aviso / erro / status | **message:** Der App-Schutz ist eingerichtet. Beim nächsten Start ist eine Anmeldung erforderlich. | Decidir com o usuário | Pendente |
| N445 | L255 · saveProtection | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N446 | L262 · disableProtection | Confirmação | **message:** App-Schutz wirklich deaktivieren? Die Passwort-Einträge bleiben weiterhin lokal verschlüsselt. | Manter confirmação antes da ação | Pendente |
| N447 | L268 · disableProtection | Aviso / erro / status | **message:** Der App-Schutz wurde deaktiviert. Die Einträge bleiben verschlüsselt gespeichert. | Decidir com o usuário | Pendente |
| N448 | L271 · disableProtection | Aviso / erro / status | **message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N449 | L309 · PasswordsPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N450 | L459 · PasswordsPage | Confirmação | **title:** Alle Passwörter löschen<br>**title:** Passwort löschen<br>**message:** {deleteRequest.count} Passwort-Einträge werden in den Papierkorb verschoben. Möchten Sie fortfahren?<br>**message:** Möchten Sie „{deleteRequest.entry.platform}“ wirklich in den Papierkorb verschieben?<br>**message:** Möchten Sie diesen Eintrag wirklich löschen? | Manter confirmação antes da ação | Pendente |

## src/pages/RecoveryPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N451 | L86 · refreshStatus | Aviso / erro / status | **message:** Wiederherstellungsarchiv konnte nicht geprüft werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N452 | L118 · timer | Aviso / erro / status | **message:** {sourceTitle(source)} konnte nicht gelesen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N453 | L137 · confirmed | Confirmação | **message:** [Dinâmico: `${preview.sourceLabel} vom ${formatDate(preview.createdAt)} verwenden?\n\n` + `${preview.activeContacts} Kontakte, ${preview.activeCalendarEvents} Termine und ${preview.groupsToCreate} Gruppen werden aktiv zurückgebracht. ` + `${preview.trashContacts + preview.trashCalendarEvents} bereits früher gelöschte Elemente werden sicher in den Papierkorb gelegt.\n\n` + "Vorher wird ein zusätzlicher Sicherheitsstand erstellt. Vorhandene Daten werden nicht ersetzt oder gelöscht."] | Manter confirmação antes da ação | Pendente |
| N454 | L153 · restore | Aviso / erro / status | **message:** [Dinâmico: `${result.activeContacts} Kontakte und ${result.activeCalendarEvents} Termine wurden aktiv wiederhergestellt. ` + `${result.trashContacts + result.trashCalendarEvents} historische Elemente liegen im Papierkorb. ` + `${result.groups} Gruppen wurden ergänzt oder wieder aktiviert.`] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N455 | L161 · restore | Aviso / erro / status | **message:** Wiederherstellung konnte nicht abgeschlossen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N456 | L178 · RecoveryPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/SettingsPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N457 | L117 · SettingsPage | Aviso / erro / status | **message:** Gespeicherte E-Mail-Konten konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N458 | L131 · updateDeletionConfirmation | Aviso / erro / status | **message:** Löschbestätigungen wurden aktiviert.<br>**message:** Löschbestätigungen wurden deaktiviert. | Decidir com o usuário | Pendente |
| N459 | L135 · updateDeletionConfirmation | Aviso / erro / status | **message:** Einstellung konnte nicht gespeichert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N460 | L148 · checkForAppUpdate | Aviso / erro / status | **message:** DMH Backup ist bereits auf dem neuesten Stand. | Decidir com o usuário | Pendente |
| N461 | L153 · checkForAppUpdate | Aviso / erro / status | **message:** Version {update.version} ist verfügbar. Die Aktualisierung kann jetzt gestartet werden. | Decidir com o usuário | Pendente |
| N462 | L156 · checkForAppUpdate | Aviso / erro / status | **message:** Aktualisierungen konnten gerade nicht geprüft werden. Bitte Internetverbindung prüfen und später erneut versuchen. | Decidir com o usuário | Pendente |
| N463 | L227 · runSystemCheck | Aviso / erro / status | **message:** Systemprüfung abgeschlossen: {errors} Problem(e) müssen geprüft werden.<br>**message:** Systemprüfung abgeschlossen: {warnings} Hinweis(e), keine beschädigten lokalen Daten erkannt.<br>**message:** Systemprüfung abgeschlossen. Alle geprüften Bereiche sind bereit. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N464 | L265 · scan | Aviso / erro / status | **message:** Im aktuellen Outlook-Classic-Profil wurde kein IMAP-Konto gefunden.<br>**message:** {result.length} {result.length === 1 ? "IMAP-Konto" : "IMAP-Konten"} in Outlook Classic gefunden. | Decidir com o usuário | Pendente |
| N465 | L272 · scan | Aviso / erro / status | **message:** Outlook-Konten konnten nicht gelesen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N466 | L285 · importAccount | Aviso / erro / status | **message:** „{candidate.accountName \|\| candidate.email}“ wurde importiert. Das Kennwort liegt ausschließlich im Windows Credential Manager. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N467 | L290 · importAccount | Aviso / erro / status | **message:** IMAP-Konto konnte nicht importiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N468 | L302 · testAccount | Aviso / erro / status | **message:** IMAP-Anmeldung für „{account.accountName \|\| account.email}“ war erfolgreich. | Decidir com o usuário | Pendente |
| N469 | L305 · testAccount | Aviso / erro / status | **message:** IMAP-Verbindung konnte nicht bestätigt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N470 | L313 · confirmed | Confirmação | **message:** E-Mail-Kennwort aus Outlook für „{accountLabel}“ sichtbar anzeigen? Achten Sie darauf, dass niemand auf den Bildschirm schaut. Das Kennwort wird nach 60 Sekunden oder beim Verlassen des Fensters automatisch verborgen. | Manter confirmação antes da ação | Pendente |
| N471 | L325 · revealPassword | Aviso / erro / status | **message:** Das Kennwort wurde nicht angezeigt, weil das App-Fenster nicht mehr aktiv war. Versuchen Sie es bei Bedarf erneut. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N472 | L330 · revealPassword | Aviso / erro / status | **message:** Das E-Mail-Kennwort wird vorübergehend angezeigt und nicht in der App-Datenbank gespeichert. | Mostrar de forma contextual se bloquear a ação | Pendente |
| N473 | L333 · revealPassword | Aviso / erro / status | **message:** E-Mail-Kennwort konnte nicht angezeigt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N474 | L340 · confirmed | Confirmação | **message:** „{account.accountName \|\| account.email}“ entfernen? Dabei werden auch die zugehörigen Kennwörter aus dem Windows Credential Manager gelöscht. | Manter confirmação antes da ação | Pendente |
| N475 | L353 · removeAccount | Aviso / erro / status | **message:** E-Mail-Konto und lokale Credential-Manager-Einträge wurden entfernt. | Decidir com o usuário | Pendente |
| N476 | L356 · removeAccount | Aviso / erro / status | **message:** E-Mail-Konto konnte nicht entfernt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N477 | L411 · SettingsPage | Aviso no formulário / painel | **text:** [Dinâmico: searchResults.map((item, index) => ( <button className={index === searchIndex ? "settings-search-result active" : "settings-search-result"} key={item.id} type="button" role="option" aria-selected={index === searchIndex} onMouseEnter={() => setSearchIndex(index)} onClick={() => selectSearchItem(item)} > <strong>{item.label}</strong> <span>{item.description}</span> </button> ))] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N478 | L413 · SettingsPage | Aviso no formulário / painel | **text:** [Dinâmico: item.label]<br>**text:** [Dinâmico: item.description] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N479 | L430 · SettingsPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N480 | L466 · onChange | Aviso / erro / status | **message:** Aktivitäten wurden aktiviert.<br>**message:** Aktivitäten wurden deaktiviert. | Decidir com o usuário | Pendente |
| N481 | L503 · SettingsPage | Aviso no formulário / painel | **text:** [Dinâmico: systemCheck.map((check) => { const Icon = check.icon; const StateIcon = check.status === "ok" ? CheckCircle2 : check.status === "error" ? AlertCircle : AlertTriangle; return ( <article className={`system-check-result ${check.status}`} key={check.label}> <span className="system-check-area-icon"><Icon size={22} aria-hidden="true" /></span> <div><strong>{check.label}</strong><small>{check.detail}</small></div> <StateIcon className="system-check-state-icon" size={22} aria-label={check.status === "ok" ? "In Ordnung" : check.status === "error" ? "Problem" : "Hinweis"} /> </article> ); })]<br>**text:** Kontakte und<br>**text:** Termine werden nur gelesen. Die Prüfung ändert oder löscht nichts. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N482 | L508 · SettingsPage | Aviso no formulário / painel | **text:** [Dinâmico: check.label]<br>**text:** [Dinâmico: check.detail] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N483 | L515 · SettingsPage | Aviso no formulário / painel | **text:** Kontakte und<br>**text:** Termine werden nur gelesen. Die Prüfung ändert oder löscht nichts. | Decidir com o usuário | Pendente |
| N484 | L587 · SettingsPage | Aviso no formulário / painel | **text:** Dies ist das in Outlook gespeicherte Kennwort für den E-Mail-Server. Schreiben Sie es bei Bedarf auf Papier ab und bewahren Sie den Zettel sicher auf. | Mostrar de forma contextual se bloquear a ação | Pendente |

## src/pages/SimpleImportPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N485 | L40 · showImportResult | Diálogo de resultado | **title:** [Dinâmico: title]<br>**summary:** [Dinâmico: summary]<br>**details:** [Dinâmico: details] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N486 | L44 · contactsImported | Diálogo de resultado | **title:** Kontaktimport abgeschlossen<br>**summary:** {result.imported} Kontakte aus {source === "classic" ? "Outlook Classic" : "dem neuen Outlook"} wurden einmalig übernommen.<br>**details:** {result.mergedDuplicates} Duplikate wurden automatisch zusammengeführt.<br>**details:** {result.skippedExactDuplicates} in allen Feldern exakt gleiche Kontakte wurden ausgelassen.<br>**details:** Gleiche Namen mit unterschiedlichen E-Mail-Adressen bleiben getrennt. Es besteht keine Synchronisierung. | Decidir com o usuário | Pendente |
| N487 | L57 · confirmed | Confirmação | **message:** Den letzten Outlook-Kontaktimport rückgängig machen? Nur Kontakte aus diesem Importvorgang werden entfernt. | Manter confirmação antes da ação | Pendente |
| N488 | L63 · undoOutlookContactImport | Aviso / erro / status | **message:** Letzter Outlook-Kontaktimport wird rückgängig gemacht … | Decidir com o usuário | Pendente |
| N489 | L66 · undoOutlookContactImport | Diálogo de resultado | **title:** Import rückgängig gemacht<br>**title:** Kein Import zum Rückgängigmachen<br>**summary:** {deleted} Kontakte aus dem letzten Outlook-Import wurden entfernt.<br>**summary:** Es wurde kein Outlook-Kontaktimport gefunden, der rückgängig gemacht werden kann. | Decidir com o usuário | Pendente |
| N490 | L74 · undoOutlookContactImport | Diálogo de resultado | **title:** Import konnte nicht rückgängig gemacht werden<br>**summary:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N491 | L83 · previewAppointments | Aviso / erro / status | **message:** Die Outlook-Kalender werden analysiert. Dies kann einige Minuten dauern … | Decidir com o usuário | Pendente |
| N492 | L88 · previewAppointments | Aviso / erro / status | **message:** [Dinâmico: `${preview.calendars.length} Outlook-Kalender mit insgesamt ${preview.totalEvents} Terminen gefunden. ` + (preview.duplicateGroups.length > 0 ? `${preview.duplicateGroups.length} Duplikatgruppen mit gleichem Titel, Datum und Beginn wurden gefunden.` : "Es wurden keine Duplikate mit gleichem Titel, Datum und Beginn erkannt.")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N493 | L96 · previewAppointments | Aviso / erro / status | **message:** Outlook-Kalender konnten nicht analysiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N494 | L104 · confirmed | Confirmação | **message:** [Dinâmico: `Die Vorschau zeigt ${outlookCalendarPreview.calendars.length} getrennte Outlook-Kalender mit insgesamt ${outlookCalendarPreview.totalEvents} Terminen. Diese Kalender werden getrennt als Quellen übernommen.\n\n` + (outlookCalendarPreview.duplicateGroups.length > 0 ? `Es wurden ${outlookCalendarPreview.duplicateGroups.length} Duplikatgruppen mit gleichem Titel, Datum und Beginn gefunden. Beim Import wird jeweils nur eine Kopie übernommen.\n\n` : "Es wurden keine Duplikate mit gleichem Titel, Datum und Beginn erkannt.\n\n") + "Jetzt einmalig importieren? Outlook wird nicht verändert."] | Manter confirmação antes da ação | Pendente |
| N495 | L115 · importAppointmentsOnce | Aviso / erro / status | **message:** Die angezeigten Outlook-Kalender werden importiert. Dies kann einige Minuten dauern … | Decidir com o usuário | Pendente |
| N496 | L119 · importAppointmentsOnce | Diálogo de resultado | **title:** Keine Outlook-Termine gefunden<br>**title:** Outlook-Kalender importiert<br>**summary:** In den erreichbaren Outlook-Kalendern wurden keine Termine gefunden.<br>**summary:** {result.imported} von {result.found} Outlook-Terminen wurden einmalig übernommen.<br>**details:** [Dinâmico: undefined]<br>**details:** {duplicates} bereits vorhandene Termine mit gleichem Titel, Datum und Beginn wurden ausgelassen.<br>**details:** {result.skippedInvalid} nicht lesbare Einträge wurden ausgelassen. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N497 | L131 · importAppointmentsOnce | Diálogo de resultado | **title:** Outlook-Termine konnten nicht importiert werden<br>**summary:** [Dinâmico: String(error)]<br>**details:** Outlook wurde nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N498 | L138 · confirmed | Confirmação | **message:** [Dinâmico: "Alle Kontakte aus dem aktiven Thunderbird-Profil einmalig übernehmen?\n\nAdressbücher und darin enthaltene Verteilerlisten werden automatisch als Gruppen angelegt. " + (includeThunderbirdAutocomplete ? "Frühere Empfänger aus der Thunderbird-Autovervollständigung werden ebenfalls übernommen. " : "Die Thunderbird-Autovervollständigung wird ausgelassen. ") + "Bereits vorhandene Kontakte mit derselben E-Mail-Adresse werden nicht doppelt angelegt, sondern den passenden Gruppen zugeordnet. Thunderbird wird nicht verändert."] | Manter confirmação antes da ação | Pendente |
| N499 | L149 · importThunderbirdContacts | Aviso / erro / status | **message:** Thunderbird-Adressbücher und Listen werden gelesen … | Decidir com o usuário | Pendente |
| N500 | L157 · importThunderbirdContacts | Diálogo de resultado | **title:** Keine Thunderbird-Kontakte gefunden<br>**title:** Thunderbird-Kontakte importiert<br>**summary:** In {result.addressBooks} Thunderbird-Adressbüchern wurden keine Kontakte gefunden.<br>**summary:** {result.imported} neue Thunderbird-Kontakte wurden importiert.<br>**details:** [Dinâmico: undefined]<br>**details:** {result.linkedExisting} bereits vorhandene Kontakte wurden den passenden Gruppen zugeordnet.<br>**details:** [Dinâmico: autocompleteSummary.trim()]<br>**details:** {result.addressBooks} Adressbücher und {result.groupsUsed} Gruppen oder Listen wurden berücksichtigt.<br>**details:** {result.skippedInvalid} nicht lesbare Einträge wurden ausgelassen. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N501 | L171 · importThunderbirdContacts | Diálogo de resultado | **title:** Thunderbird-Kontakte konnten nicht importiert werden<br>**summary:** [Dinâmico: String(error)]<br>**details:** Thunderbird wurde nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N502 | L178 · confirmed | Confirmação | **message:** Alle Termine aus allen im aktiven Thunderbird-Profil gespeicherten Kalendern einmalig übernehmen? Serien, Ausnahmen, Kategorien und Kalenderfarben werden soweit möglich beibehalten. Bereits importierte Thunderbird-Termine werden aktualisiert und nicht doppelt angelegt. Thunderbird wird nicht verändert. | Manter confirmação antes da ação | Pendente |
| N503 | L185 · importThunderbirdCalendars | Aviso / erro / status | **message:** Thunderbird-Kalender, Terminserien und Ausnahmen werden gelesen … | Decidir com o usuário | Pendente |
| N504 | L189 · importThunderbirdCalendars | Diálogo de resultado | **title:** Keine Thunderbird-Termine gefunden<br>**title:** Thunderbird-Kalender importiert<br>**summary:** In den erreichbaren Thunderbird-Kalendern wurden keine Termine gefunden.<br>**summary:** {result.imported} neue Thunderbird-Termine oder Serien wurden übernommen.<br>**details:** [Dinâmico: undefined]<br>**details:** {alreadyPresent} Termine mit gleichem Titel, Datum und Beginn waren bereits vorhanden.<br>**details:** {result.skippedInvalid} nicht unterstützte oder beschädigte Einträge wurden ausgelassen. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N505 | L201 · importThunderbirdCalendars | Diálogo de resultado | **title:** Thunderbird-Kalender konnten nicht importiert werden<br>**summary:** [Dinâmico: String(error)]<br>**details:** Thunderbird wurde nicht verändert. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N506 | L218 · SimpleImportPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N507 | L314 · SimpleImportPage | Aviso no formulário / painel | **text:** Vorschau vor dem Import<br>**text:** [Dinâmico: outlookCalendarPreview.calendars.length]<br>**text:** Kalender ·<br>**text:** [Dinâmico: outlookCalendarPreview.totalEvents]<br>**text:** Termine | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N508 | L328 · SimpleImportPage | Aviso no formulário / painel | **text:** [Dinâmico: outlookCalendarPreview.duplicateGroups.length]<br>**text:** mögliche Duplikatgruppen<br>**text:** Diese Termine wurden in mehreren Outlook-Kalendern gefunden. Sie werden nicht automatisch zusammengelegt.<br>**text:** [Dinâmico: outlookCalendarPreview.duplicateGroups.map((duplicate, index) => ( <li key={`${duplicate.startsAt}-${duplicate.title}-${index}`}> <strong>{duplicate.title}</strong> <span>{formatPreviewDate(duplicate.startsAt)} · {duplicate.occurrenceCount} Vorkommen</span> <small>{duplicate.calendars.join(" · ")}</small> </li> ))] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N509 | L329 · SimpleImportPage | Aviso no formulário / painel | **text:** [Dinâmico: outlookCalendarPreview.duplicateGroups.length]<br>**text:** mögliche Duplikatgruppen | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N510 | L419 · onImported | Diálogo de resultado | **title:** Kalenderimport abgeschlossen<br>**summary:** [Dinâmico: importResult.detail] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/SynchronizationsPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N511 | L130 · poll | Aviso / erro / status | **message:** Microsoft 365 wurde verbunden. Jetzt können Sie die Synchronisierung hier konfigurieren. | Decidir com o usuário | Pendente |
| N512 | L139 · poll | Aviso / erro / status | **message:** Microsoft-365-Anmeldung wurde nicht abgeschlossen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N513 | L177 · saveConfig | Aviso / erro / status | **message:** Bitte mindestens einen Microsoft-365-Kalender für die automatische Synchronisierung auswählen. | Decidir com o usuário | Pendente |
| N514 | L188 · saveConfig | Aviso / erro / status | **message:** Einstellungen gespeichert. Neue Kalenderänderungen werden automatisch synchronisiert.<br>**message:** Einstellungen gespeichert. Die Synchronisierung bleibt manuell. | Decidir com o usuário | Pendente |
| N515 | L193 · saveConfig | Aviso / erro / status | **message:** Einstellungen konnten nicht gespeichert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N516 | L202 · createPreview | Aviso / erro / status | **message:** Die Synchronisierung ist pausiert. | Decidir com o usuário | Pendente |
| N517 | L207 · createPreview | Aviso / erro / status | **message:** Bitte mindestens eine Quelle auswählen. | Decidir com o usuário | Pendente |
| N518 | L231 · createPreview | Aviso / erro / status | **message:** Vorschau erstellt. Es wurden keine Daten verändert. | Decidir com o usuário | Pendente |
| N519 | L234 · createPreview | Aviso / erro / status | **message:** Vorschau konnte nicht erstellt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N520 | L259 · refreshM365Sources | Aviso / erro / status | **message:** Quellen aktualisiert. Es wurden keine Daten verändert. | Decidir com o usuário | Pendente |
| N521 | L262 · refreshM365Sources | Aviso / erro / status | **message:** Quellen konnten nicht gelesen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N522 | L276 · connectAccount | Aviso / erro / status | **message:** Microsoft 365 wurde verbunden. Jetzt können Sie die Synchronisierung hier konfigurieren. | Decidir com o usuário | Pendente |
| N523 | L281 · connectAccount | Aviso / erro / status | **message:** Microsoft-Anmeldung wurde nicht abgeschlossen: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N524 | L296 · refreshM365SourcesForAccount | Aviso / erro / status | **message:** Microsoft-365-Quellen konnten nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N525 | L307 · connectWithCode | Aviso / erro / status | **message:** Geben Sie den angezeigten Code im Microsoft-Anmeldefenster ein. | Decidir com o usuário | Pendente |
| N526 | L312 · connectWithCode | Aviso / erro / status | **message:** Alternative Microsoft-Anmeldung konnte nicht gestartet werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N527 | L322 · cancelAccountConnection | Aviso / erro / status | **message:** Anmeldung wurde abgebrochen. | Decidir com o usuário | Pendente |
| N528 | L330 · copyDeviceCode | Aviso / erro / status | **message:** Anmeldecode wurde kopiert. | Decidir com o usuário | Pendente |
| N529 | L333 · copyDeviceCode | Aviso / erro / status | **message:** Anmeldecode konnte nicht kopiert werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N530 | L344 · checkAccount | Aviso / erro / status | **message:** Verbindung zu Microsoft 365 wurde erfolgreich geprüft. | Decidir com o usuário | Pendente |
| N531 | L348 · checkAccount | Aviso / erro / status | **message:** Microsoft-365-Verbindung konnte nicht bestätigt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N532 | L355 · disconnectAccount | Confirmação | **message:** Microsoft-365-Konto von dieser App trennen? Kontakte, Kalender und Daten in Microsoft 365 werden dadurch nicht gelöscht. | Manter confirmação antes da ação | Pendente |
| N533 | L363 · disconnectAccount | Aviso / erro / status | **message:** Microsoft-365-Konto wurde von dieser App getrennt. | Decidir com o usuário | Pendente |
| N534 | L366 · disconnectAccount | Aviso / erro / status | **message:** Microsoft-365-Konto konnte nicht getrennt werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N535 | L391 · togglePaused | Aviso / erro / status | **message:** Synchronisierung pausiert. Einstellungen bleiben erhalten.<br>**message:** Synchronisierung fortgesetzt. | Decidir com o usuário | Pendente |
| N536 | L395 · togglePaused | Aviso / erro / status | **message:** [Dinâmico: error.message]<br>**message:** [Dinâmico: String(error)] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N537 | L408 · applySync | Confirmação | **message:** {total} Änderung(en) jetzt ausführen? Vorher wird der lokale Sicherungsverlauf aktualisiert. | Manter confirmação antes da ação | Pendente |
| N538 | L435 · applySync | Aviso / erro / status | **message:** {result.created} erstellt, {result.updated} aktualisiert, {result.deleted} gelöscht, {result.ignored} ignoriert, {result.errors} Fehler. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N539 | L439 · applySync | Aviso / erro / status | **message:** Synchronisierung konnte nicht abgeschlossen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N540 | L462 · SynchronizationsPage | Aviso no formulário / painel | **message:** Sicherer Kalendertest: Microsoft 365 ist schreibgeschützt. Nur Termine aus Exchange werden in die App übernommen; ausgehende Änderungen und Löschungen sind gesperrt.<br>**message:** Sicherer Kalendertest ist nicht bestätigt. Keine Synchronisierung ausführen. | Decidir com o usuário | Pendente |
| N541 | L465 · SynchronizationsPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N542 | L469 · SynchronizationsPage | Aviso no formulário / painel | **text:** Microsoft 365 / Exchange<br>**text:** Verbindung wird geprüft …<br>**text:** Verbunden{m365Status.account?.email ? ` · ${m365Status.account.email}` : ""}<br>**text:** Noch nicht verbunden<br>**text:** Pausiert<br>**text:** Automatisch<br>**text:** Manuell<br>**text:** Nicht verbunden | Decidir com o usuário | Pendente |
| N543 | L472 · SynchronizationsPage | Aviso no formulário / painel | **text:** Pausiert<br>**text:** Automatisch<br>**text:** Manuell<br>**text:** Nicht verbunden | Decidir com o usuário | Pendente |
| N544 | L517 · SynchronizationsPage | Aviso no formulário / painel | **text:** [Dinâmico: m365Status.account.displayName.trim().slice(0, 1).toUpperCase()]<br>**text:** M<br>**text:** [Dinâmico: m365Status.account.displayName]<br>**text:** [Dinâmico: m365Status.account.email]<br>**text:** [Dinâmico: m365Status.account.userPrincipalName] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N545 | L569 · SynchronizationsPage | Aviso no formulário / painel | **text:** [Dinâmico: unavailableCalendarIds.length]<br>**text:** früher ausgewählte Kalender sind mit diesem Konto nicht erreichbar. Entfernen Sie nur deren Auswahl; es werden dabei keine Termine gelöscht. | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N546 | L605 · SynchronizationsPage | Aviso no formulário / painel | **text:** Mindestens ein Postfach ist nicht erreichbar. | Decidir com o usuário | Pendente |
| N547 | L613 · SynchronizationsPage | Aviso no formulário / painel | **text:** [Dinâmico: entry.errors]<br>**text:** Fehler | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/pages/TrashPage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N548 | L152 · TrashPage | Aviso / erro / status | **message:** Papierkorb konnte nicht geladen werden: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N549 | L158 · restoreDeletedEvent | Diálogo de resultado | **title:** Termin wiederhergestellt<br>**summary:** „{event.title \|\| "Ohne Titel"}“ ist wieder im Kalender. | Decidir com o usuário | Pendente |
| N550 | L170 · restoreDeletedContact | Diálogo de resultado | **title:** Kontakt wiederhergestellt<br>**summary:** „{displayName(contact)}“ ist wieder bei Ihren Kontakten. | Decidir com o usuário | Pendente |
| N551 | L208 · restoreSelectedContacts | Diálogo de resultado | **title:** Kontakte wiederhergestellt<br>**summary:** {selectedDeletedContactIds.length} Kontakte sind wieder verfügbar. | Decidir com o usuário | Pendente |
| N552 | L218 · restoreAllDeletedContacts | Diálogo de resultado | **title:** Kontakte wiederhergestellt<br>**summary:** {deletedContactIds.length} Kontakte sind wieder verfügbar. | Decidir com o usuário | Pendente |
| N553 | L228 · restoreDeletedGroup | Diálogo de resultado | **title:** Gruppe wiederhergestellt<br>**summary:** „{group.name}“ ist wieder verfügbar. | Decidir com o usuário | Pendente |
| N554 | L237 · restoreCollectedAddresses | Diálogo de resultado | **title:** Gruppe wiederhergestellt<br>**summary:** „Gesammelte Adressen“ ist wieder verfügbar. | Decidir com o usuário | Pendente |
| N555 | L243 · restoreDeletedPassword | Diálogo de resultado | **title:** 2FA-Code wiederhergestellt<br>**title:** Passwort wiederhergestellt<br>**summary:** „{entry.platform \|\| entry.username \|\| "Eintrag"}“ ist wieder verfügbar. | Decidir com o usuário | Pendente |
| N556 | L285 · permanentlyDeleteTrash | Diálogo de resultado | **title:** Papierkorb endgültig geleert<br>**summary:** {removed} {removed === 1 ? "Eintrag wurde" : "Einträge wurden"} endgültig gelöscht und können nicht wiederhergestellt werden. | Decidir com o usuário | Pendente |
| N557 | L295 · permanentlyDeleteTrash | Diálogo de resultado | **title:** Papierkorb nicht geleert<br>**summary:** {trashCategoryLabels[category]} wurden nicht endgültig gelöscht: {error} | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N558 | L367 · TrashPage | Aviso no formulário / painel | **message:** [Dinâmico: message] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N559 | L493 · TrashPage | Confirmação | **title:** {trashCategoryLabels[category]} endgültig löschen?<br>**message:** {purgePreview.count} {purgePreview.count === 1 ? "Element" : "Elemente"} aus „{trashCategoryLabels[category]}“ werden endgültig gelöscht ({purgePreview.period.description}). Andere Bereiche bleiben unverändert. Dies kann nicht rückgängig gemacht werden. | Manter confirmação antes da ação | Pendente |

## src/pages/WelcomePage.tsx

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N560 | L110 · WelcomePage | Aviso no formulário / painel | **text:** [Dinâmico: [migrationCompleted, contactsCompleted, calendarCompleted].filter(Boolean).length]<br>**text:** von 3 erledigt | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N561 | L122 · WelcomePage | Aviso no formulário / painel | **text:** Alle notwendigen Schritte für die Migration haben Sie bereits abgeschlossen. Vielen Dank für Ihre Hilfe. | Decidir com o usuário | Pendente |
| N562 | L147 · WelcomePage | Aviso no formulário / painel | **text:** Übertragung fehlgeschlagen:<br>**text:** [Dinâmico: migrationError] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/services/db.ts

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N563 | L506 · createDocumentShareLink | Resultado de ação | **message:** [Dinâmico: invoke("create_document_share_link", { driveId, itemId, allowEdit })] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N564 | L518 · downloadDocumentItem | Resultado de ação | **message:** [Dinâmico: invoke("download_document_item", { driveId, itemId, name, relativePath, eTag, parentId })] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N565 | L550 · getDocumentsLocalRoot | Resultado de ação | **message:** [Dinâmico: invoke("get_documents_local_root")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N566 | L654 · getMigrationDiagnosticLog | Resultado de ação | **message:** [Dinâmico: invoke("get_migration_diagnostic_log")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |

## src/utils/automaticCalendarSync.ts

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N567 | L69 · describeMicrosoft365SyncFailure | Resultado de ação | **message:** Microsoft 365 hat einen Serverfehler gemeldet. Lokale Änderungen bleiben gespeichert und werden erneut versucht. Falls der Fehler anhält, prüfen Sie die Verbindung. | Ocultar aviso automático; registrar na EDV | Pendente |
| N568 | L71 · describeMicrosoft365SyncFailure | Resultado de ação | **message:** Exchange konnte {errors} Änderung(en) noch nicht übernehmen: {detail.slice(0, 300)}<br>**message:** Exchange konnte {errors} Änderung(en) noch nicht übernehmen. Die Änderungen bleiben lokal gespeichert und werden erneut versucht. | Ocultar aviso automático; registrar na EDV | Pendente |
| N569 | L132 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** Sicherer Kalender-Test wurde abgebrochen: Das Schreibverbot in der nativen App ist nicht aktiv. | Ocultar aviso automático; registrar na EDV | Pendente |
| N570 | L144 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** Automatische Synchronisierung ist aktiviert, aber es wurde kein Microsoft-365-Kalender ausgewählt. | Ocultar aviso automático; registrar na EDV | Pendente |
| N571 | L158 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** Die Änderung wurde lokal gespeichert. Microsoft 365 ist momentan nicht verbunden. | Ocultar aviso automático; registrar na EDV | Pendente |
| N572 | L217 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** [Dinâmico: describeMicrosoft365SyncFailure(queueErrors, messages)] | Ocultar aviso automático; registrar na EDV | Pendente |
| N573 | L223 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** {transferred} Änderung(en) sicher an Exchange übertragen.<br>**message:** Lokale Änderungen wurden abgeglichen. | Ocultar aviso automático; registrar na EDV | Pendente |
| N574 | L229 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** Microsoft 365 ist bereits synchron. | Ocultar aviso automático; registrar na EDV | Pendente |
| N575 | L286 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** [Dinâmico: describeMicrosoft365SyncFailure(combinedResult.errors, combinedResult.errorMessages)] | Ocultar aviso automático; registrar na EDV | Pendente |
| N576 | L289 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** {result.conflicts} bereits vorhandene Einträge wurden vorsichtshalber nicht geändert. Die EDV kann sie später prüfen. | Ocultar aviso automático; registrar na EDV | Pendente |
| N577 | L295 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** Microsoft 365 ist bereits synchron. | Ocultar aviso automático; registrar na EDV | Pendente |
| N578 | L297 · runAutomaticCalendarSync | Mensagem produzida / repassada | **message:** {exchangeCount} Änderung(en) automatisch mit Microsoft 365 synchronisiert. | Ocultar aviso automático; registrar na EDV | Pendente |

## src/utils/easyImport.ts

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N579 | L25 · easyImportContacts | Mensagem produzida / repassada | **detail:** Keine erreichbaren Outlook-Kontakte gefunden. | Decidir com o usuário | Pendente |
| N580 | L33 · easyImportContacts | Mensagem produzida / repassada | **detail:** {result.imported} neu importiert · {result.mergedDuplicates} Duplikate zusammengeführt · {totalContacts} Kontakte insgesamt | Decidir com o usuário | Pendente |
| N581 | L42 · easyImportContacts | Mensagem produzida / repassada | **detail:** {imported} neu importiert · {result.mergedDuplicates} zusammengeführt · {totalContacts} Kontakte insgesamt | Decidir com o usuário | Pendente |
| N582 | L52 · easyImportCalendar | Mensagem produzida / repassada | **detail:** {result.imported} neu importiert · {existing} bereits vorhanden | Decidir com o usuário | Pendente |
| N583 | L60 · easyImportCalendar | Mensagem produzida / repassada | **detail:** {result.imported} neu importiert · {alreadyPresent} bereits vorhanden | Decidir com o usuário | Pendente |

## src/utils/importParserWorker.ts

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N584 | L14 · runParserWorker | Erro de helper | **message:** Die Hintergrundverarbeitung ist auf diesem Gerät nicht verfügbar. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N585 | L24 · runParserWorker | Erro de helper | **message:** [Dinâmico: data.error] | Revisar propagação; detalhe técnico na EDV | Pendente |
| N586 | L28 · runParserWorker | Erro de helper | **message:** [Dinâmico: event.message]<br>**message:** Die Datei konnte im Hintergrund nicht verarbeitet werden. | Revisar propagação; detalhe técnico na EDV | Pendente |

## src/utils/localAuth.ts

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N587 | L129 · createLocalAccount | Erro de helper | **message:** Für diese E-Mail-Adresse besteht bereits ein Konto. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N588 | L147 · signInToLocalAccount | Erro de helper | **message:** Zu dieser E-Mail-Adresse wurde kein Konto gefunden. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N589 | L151 · signInToLocalAccount | Erro de helper | **message:** Das Kennwort ist nicht richtig. Bitte versuchen Sie es erneut. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N590 | L161 · resetLocalAccountPassword | Erro de helper | **message:** Zu dieser E-Mail-Adresse wurde kein Konto gefunden. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N591 | L164 · resetLocalAccountPassword | Erro de helper | **message:** Das Kennwort muss mindestens 8 Zeichen lang sein. | Revisar propagação; detalhe técnico na EDV | Pendente |

## src/utils/totp.ts

| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |
| --- | --- | --- | --- | --- | --- |
| N592 | L19 · parseTotpInput | Erro de helper | **message:** Bitte geben Sie einen geheimen Schlüssel ein. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N593 | L24 · parseTotpInput | Erro de helper | **message:** Nur TOTP-QR-Codes werden unterstützt. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N594 | L29 · parseTotpInput | Erro de helper | **message:** Dieser TOTP-Algorithmus wird nicht unterstützt. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N595 | L34 · parseTotpInput | Erro de helper | **message:** Die TOTP-Einstellungen des QR-Codes sind ungültig. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N596 | L72 · parseAuthenticatorImport | Erro de helper | **message:** Keine unterstützte 2FA-Exportadresse gefunden. Fügen Sie eine otpauth://-Adresse oder einen Google-Export ein. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N597 | L98 · generateTotpCode | Resultado de ação | **message:** [Dinâmico: String(binary % (10 ** config.digits)).padStart(config.digits, "0")] | Reescrever para o usuário; detalhe técnico na EDV | Pendente |
| N598 | L109 · base32Decode | Erro de helper | **message:** Der geheime Schlüssel muss ein gültiger Base32-Schlüssel sein. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N599 | L127 · parseGoogleMigration | Erro de helper | **message:** Der Google-Authenticator-Export enthält keine Daten. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N600 | L143 · parseGoogleMigration | Erro de helper | **message:** Der Google-Export enthält keine TOTP-Konten. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N601 | L191 · readField | Erro de helper | **message:** Der 2FA-Export enthält ein unbekanntes Datenformat. | Revisar propagação; detalhe técnico na EDV | Pendente |
| N602 | L204 · readVarint | Erro de helper | **message:** Der 2FA-Export ist beschädigt. | Revisar propagação; detalhe técnico na EDV | Pendente |
