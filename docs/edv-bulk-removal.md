# Remoção em massa na EDV

Acesso: **EDV Tools → Massenlöschung**, subabas **Kalender** e **Kontakte**. Os três comandos de consulta, prévia e execução exigem a sessão EDV no backend. O modo de teste somente leitura bloqueia a execução.

Lista compacta com páginas de 100 linhas, ordenação e seleção por caixas ou intervalo com Shift. A seleção individual permanece entre páginas e buscas. “Alle … Treffer auswählen” abrange todos os resultados do filtro no banco, inclusive os de páginas não carregadas; é possível desmarcar exceções. Alterar a busca ou uma condição cancela essa seleção geral para evitar aplicar uma condição diferente por engano.

Calendário: busca por título, correspondência exata opcional, origem/calendário, categoria e intervalo do início. Contatos: busca por nome, e-mail, empresa, cidade ou telefone; nome exato opcional, empresa e grupo. Filtros são combinados. Para séries, o intervalo considera o início da série; selecionar a série remove também suas exceções, inclusive fora do intervalo. A prévia mostra o total afetado.

A confirmação inclui o alcance no Exchange/Teams. A ação usa a lixeira existente e enfileira exclusões nas filas duráveis de sincronização, respeitando calendários, pastas e direções habilitados. A confirmação de remoção local não afirma que o Exchange já concluiu a exclusão. Existe uma cópia local no histórico de recuperação antes da transação e a Historie registra os itens removidos.

O backend calcula uma revisão de todos os itens e exceções afetados. Uma alteração ou novo resultado entre prévia e execução cancela a operação e exige nova conferência. A execução aguarda a sincronização do respectivo tipo e a transação inclui a remoção local e sua fila; falhas não deixam uma exclusão parcial sem fila. Séries são processadas antes das exceções para não duplicar exclusões remotas.

Testes usam bancos e contas simulados. Nenhuma remoção de dados reais é necessária para validar a tela.
