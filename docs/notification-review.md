# Classificação das notificações — proposta para decidir juntos

Este documento preserva a proposta inicial para referência. A instrução posterior do usuário foi implementada em 12/10/2026: mensagens de rotina e técnicas ficam na história da EDV, e rejeições reais de envio têm aviso por item com orientação. Veja [a política implementada](notification-policy.md). As colunas “Pendente” abaixo pertencem ao levantamento original; não descrevem o estado atual de execução.

O levantamento encontrou **602 pontos de mensagem em 48 arquivos do frontend**. Isso não significa 602 avisos distintos: inclui emissores, locais de exibição, alternativas, confirmações e erros de helpers. Também há **394 textos candidatos no backend nativo**. Alguns ficam somente na EDV ou nunca chegam à tela. Os relatórios marcam mensagens dinâmicas e a origem para conferir cada fluxo antes de implementar.

- [Catálogo do frontend: textos originais, variações, IDs e fontes](notification-inventory.md)
- [Textos candidatos do backend: IDs B e fontes](notification-native-candidates.md)
- [Dados estruturados do levantamento](notification-inventory.json)

`{…}` representa dados variáveis. `[Dinâmico: …]` representa texto produzido em outro lugar. Microsoft 365, Windows, arquivos, rede e extensões podem devolver mensagens arbitrárias; não existe uma lista finita de todas essas frases. O erro do print combina o emissor **N568** com um erro do Microsoft Graph, como **B191**, e o detalhe externo `ErrorItemNotFound`.

## Destinos propostos

| Destino | O que significa |
| --- | --- |
| Silencioso / EDV | Sem faixa, popup ou entrada confusa na central do usuário. Preservar diagnóstico acessível à EDV. |
| Contextual | Informação curta no formulário ou painel da ação que a pessoa pediu. Sem alerta global. |
| Confirmação | Pergunta antes de uma ação destrutiva ou de descartar alterações. |
| Urgente | Aviso destacado e simples quando a alteração não foi salva, o app está bloqueado ou há risco concreto aos dados/proteção. |

## Grupos para classificação

| Grupo | Mensagens / situações possíveis | Proposta | Decisão |
| --- | --- | --- | --- |
| G01 | Sincronização automática concluída; já sincronizado; quantidade enviada/recebida; alterações conciliadas. | Silencioso / EDV | Pendente |
| G02 | Falha remota de Exchange/Graph, incluindo 404, 429 e 5xx; fila ainda pendente; nova tentativa; lentidão ou falta de rede, com alteração local preservada. Um 404 persistente pode exigir investigação da EDV, mas o código HTTP sozinho não prova perda de dados. | Silencioso / EDV | Pendente |
| G03 | Conta desconectada; sessão expirada; autorização ou permissões impedindo sincronização. | Contextual na conexão; EDV recebe o detalhe | Pendente |
| G04 | Sincronização habilitada sem selecionar calendário/pasta; configuração incompleta; seleção indisponível. | Contextual na configuração / EDV | Pendente |
| G05 | Dados existentes não alterados por segurança; conflitos de sincronização; comparação aguardando escolhas. | EDV no automático; contextual no comparador aberto pelo usuário | Pendente |
| G06 | Evento, contato, senha, grupo ou mudança solicitada não gravada localmente; “Kalenderänderung konnte nicht sicher gespeichert werden.”; “Kontakt nicht gespeichert”. | Urgente: explicar que não foi salvo, sem mensagem técnica | Pendente |
| G07 | Dados locais/cofre não podem ser abertos; falha de inicialização; restauração ou leitura impede continuar. | Urgente quando houver bloqueio real; contextual nos demais casos | Pendente |
| G08 | Salvo, criado, renomeado, movido, excluído, restaurado; contatos/grupos/categorias atualizados com sucesso. | Silencioso; resultado visível na própria tela | Pendente |
| G09 | E-mail, link, senha ou código copiado; aplicação de e-mail aberta; ordem salva. | Sem popup; feedback breve no próprio controle, se desejado | Pendente |
| G10 | Campo obrigatório; e-mail inválido; nome vazio/duplicado; horário final anterior ao inicial; código/senha com formato incorreto. | Contextual no campo | Pendente |
| G11 | Excluir contato/grupo/evento/conta 2FA; apagar todas as categorias; excluir lotes; apagar definitivamente. | Confirmação antes da ação | Pendente |
| G12 | Alterações não salvas; sair do contato sem salvar; salvar ou descartar mudanças. | Confirmação antes de descartar | Pendente |
| G13 | Importação/exportação/abertura/consulta/prévia em andamento; processamento de arquivo; análise de duplicados. | Progresso no painel da ação, sem faixa global | Pendente |
| G14 | Importação/exportação concluída; totais, itens ignorados e duplicados; nenhum dado encontrado; nenhuma duplicata encontrada; reversão concluída. | Resumo no painel solicitado; decidir se deve abrir diálogo | Pendente |
| G15 | Importação/exportação não concluída; arquivo incompatível/corrompido/ausente; Outlook/Thunderbird indisponível; operação não pôde ser desfeita. | Contextual e em linguagem simples; EDV recebe o erro completo | Pendente |
| G16 | Documentos offline atualizados; quantidade de uploads/downloads; SharePoint/OneDrive temporariamente indisponível; nova tentativa posterior. | Silencioso no automático; contextual em uma sincronização manual | Pendente |
| G17 | Documento alterado localmente e online; versão não sobrescrita; ambas as versões preservadas; decisão entre versões pendente. | Contextual com uma ação clara; urgente somente se houver risco concreto de perder uma versão | Pendente |
| G18 | Documento/pasta criado, renomeado, movido, copiado, compartilhado ou baixado; cópia local removida. | Sem popup; feedback na própria lista | Pendente |
| G19 | Falha ao abrir/editar/excluir/copiar/compartilhar arquivo; operação parcial; original mantido por segurança; erro de versões ou anexos. | Contextual com resultado real e opção de tentar de novo; EDV recebe o detalhe | Pendente |
| G20 | Backup automático criado; histórico ativo; limpeza/manutenção de rotina; diagnóstico gerado com sucesso. | Silencioso / EDV | Pendente |
| G21 | Backup pedido manualmente não concluído; restauração falhou; segurança do backup/proteção comprometida. Falha isolada de backup automático não prova emergência. | Contextual em pedido manual; urgente se houver falha de proteção confirmada e relevante | Pendente |
| G22 | Restaurar backup substituindo dados; restaurar/limpar lixeira; redefinir dados locais; eliminar dados definitivamente. | Confirmação antes da ação | Pendente |
| G23 | Senha incorreta; conta local não encontrada; código de recuperação inválido; senha curta/diferente; 2FA inválido ou QR não reconhecido. | Contextual na autenticação/formulário | Pendente |
| G24 | Cofre/chave/proteção não pode ser aberto, gravado ou aplicado; mudança de proteção falhou; acesso ao conteúdo ficou impedido. | Urgente quando bloquear ou comprometer proteção; EDV recebe o detalhe | Pendente |
| G25 | Nova versão disponível; busca de atualizações falhou; versão já atual; download/instalação/reinício em andamento ou falhou. | Rotina silenciosa; resultado contextual quando atualização foi solicitada. Definir separadamente atualizações realmente críticas | Pendente |
| G26 | Migração de e-mail em andamento/concluída; transmissão não confirmada; sessão de fotos pelo celular iniciada/finalizada; conexão local indisponível. | Contextual no fluxo solicitado; EDV recebe os dados técnicos | Pendente |
| G27 | Reserva/solicitação/ticket/refeição salva ou aberta; anexo adicionado/removido; limite, tipo ou tamanho de anexo inválido. | Sucesso sem popup; validação/falha contextual | Pendente |
| G28 | Impressora instalada/encontrada; driver/IP inválido; falha de instalação/teste; aplicativo externo não aberto. | Contextual na configuração/teste solicitado; EDV recebe detalhes técnicos | Pendente |
| G29 | Modo de teste somente leitura, proteção de teste ausente, funções experimentais/indisponíveis, mensagens de diagnóstico e verificações EDV. | Somente no ambiente/painel da EDV; bloqueio de teste continua efetivo | Pendente |

## A mensagem da imagem

`Exchange konnte 4 Änderung(en) noch nicht übernehmen: Mittagspause: Microsoft Graph konnte die Daten nicht lesen (HTTP 404), ErrorItemNotFound: The specified object was not found in the store..`

Proposta: **G02 — tirar do aviso geral e guardar para a EDV**. A frase mostra uma operação pendente no Exchange, não comprova que o compromisso local desapareceu. Não se deve afirmar “sincronizado com sucesso” enquanto a fila contém erro. Também não se deve descartar o registro: um objeto remoto ausente pode exigir recuperação ou correção da fila.

## Regra sugerida para a implementação posterior

Não decidir a gravidade por palavras soltas, `HTTP 404` ou pelo tipo genérico `error`. Cada origem deve indicar contexto, resultado da gravação e ação necessária. O aviso ao usuário usa texto curto e claro. O detalhe completo segue para um diagnóstico restrito à EDV, sem nomes/dados técnicos espalhados nas telas e na central de atividades.

Todos os grupos continuam pendentes. Para classificar, basta responder, por exemplo: “G01/G02 ocultos; G06 urgente; G10/G11/G12 manter; G14 sem diálogo”. Também podemos discutir cada área separadamente.
