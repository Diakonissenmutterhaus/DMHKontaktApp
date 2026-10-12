# Mensagens e diagnóstico da EDV

Implementação de 12/10/2026. As mensagens de rotina e os detalhes técnicos vão para **EDV Tools → Historie**. Não são faixas, diálogos de sucesso ou atividades acessíveis ao usuário comum.

## História

O registro local usa `audit_log`, com horário da ocorrência, usuário Windows, origem, nível e operação. Falhas capturadas na fila de sincronização incluem o ID real do item, nome, início do compromisso e calendário/pasta de destino. Uma falha de preparação geral identifica os itens ainda pendentes e a etapa bloqueada, sem afirmar que cada envio foi rejeitado individualmente. Mensagens sem item associado são registradas como ocorrências da aplicação, sem inventar um compromisso.

Na história, **Aktion → Fehlermeldungen** filtra os erros. A busca encontra o texto técnico, código, ID, nome e operação; os filtros de origem, área, período e paginação continuam disponíveis. Mensagens repetidas idênticas no mesmo intervalo de 15 segundos são deduplicadas. Credenciais não são gravadas no texto de diagnóstico.

A leitura da história exige uma sessão EDV autorizada no backend. A senha existente é verificada nativamente. Ao voltar ao calendário ou a outra página comum, a sessão EDV é bloqueada. Mensagens técnicas antigas da central de atividades são migradas com suas datas originais; se a gravação falhar, o original é mantido.

## Avisos ao usuário

A gravidade não é inferida a partir da quantidade de tentativas ou da palavra `error`. O backend produz uma falha estruturada por operação e item. Uma rejeição de envio conhecida — por exemplo, dados recusados, permissão negada ou vínculo remoto ausente — pode gerar uma mensagem curta com o compromisso, data/hora e orientação. Uma indisponibilidade temporária, limitação de chamadas, erro interno SQL ou falha de importação automática permanece no diagnóstico.

O aviso de Exchange aparece em qualquer aba. Se houver vários itens, um é apresentado primeiro e os demais ficam numa lista expansível. Uma nova falha temporária não apaga a orientação anterior. O aviso só é limpo automaticamente quando a sincronização confirma sucesso e a fila de saída está vazia.

Falhas ao gravar alterações locais também não podem aparentar sucesso: são registradas e recebem um aviso simples, vinculado à ação/item conhecido. Validações de formulário e confirmações antes de excluir/descartar continuam funcionando. Erros técnicos em formulários são substituídos por uma orientação curta à EDV.

## Cor incerta no calendário

Uma categoria sem cor reconhecida ou ausente do catálogo confirmado recebe **sem categoria e azul**. O fallback altera somente metadados; preserva ID, título, horários, descrição, série, participantes e link do Teams. O calendário conectado usa azul como padrão. A limpeza de categoria é enviada pela fila de metadados, sem substituir uma edição ou exclusão real já pendente.

Erros de manutenção de cores ficam na Historie da EDV. Uma referência antiga que retorna 404 durante essa manutenção encerra somente a tentativa de cor, preservando o registro local; não cria, exclui ou presume a existência de uma cópia remota. Ausência ou rejeição ao enviar uma alteração real de conteúdo continua sendo um problema acionável para o usuário. Falhas no catálogo de cores não devem impedir a tentativa de envio do título, horário e demais dados; o envio utiliza categorias vazias.

## Vínculos de contatos

Um registro remoto já associado a outro contato local não é reutilizado por uma correspondência aproximada. O vínculo é gravado em uma transação, com verificação de titularidade e repetição idempotente. Um conflito não rouba nem remove o vínculo existente. As falhas por item são capturadas antes de continuar a fila; uma exceção interna não passa a ser apresentada como falha genérica de um compromisso.

## Catálogo anterior

`notification-inventory.md`, `notification-native-candidates.md` e `notification-inventory.json` são o levantamento anterior à implementação. Os IDs desse levantamento são referências da revisão, não códigos de erro de produção. `scripts/audit-notifications.mjs` pode gerar um novo levantamento; ele não altera a política de execução.
