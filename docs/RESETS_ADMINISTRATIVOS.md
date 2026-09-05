# Resets administrativos

O painel fica em **Administração → Resets** (`/admin-dashboard/reset`). A ação **Resetar cidadão** no gerenciamento de usuários abre a tela com aquela conta selecionada. A seleção pode atravessar páginas e filtros; **Selecionar resultados** adiciona todos os resultados da busca atual.

| Modalidade | Alcance |
| --- | --- |
| Selecionados | Reinicia somente as contas escolhidas e seus registros relacionados. Uma única seleção permite reset individual. |
| Todos os cidadãos | Reinicia todas as contas ativas, incluindo administradores, mantendo o estado nacional corrente. |
| RP completo | Reinicia os cidadãos, limpa os registros da temporada e prepara novamente os países ativos a partir das fontes reais. |

As credenciais de login, a identidade privada da conta, doações reais, suporte, registros de segurança e catálogos do sistema são preservados. Contas anteriormente removidas não são reativadas. O administrador mantém o acesso ao painel, mas precisa criar um novo cidadão para acessar as áreas de jogo.

## O que acontece com o cidadão

O perfil mantém o ID da conta e a data original de cadastro. Recebe outro `citizen_id`, username provisório e os valores iniciais dos campos do personagem. Identidade, gênero, biografia, avatar, documentos, residência, aspiração, títulos, cargos, reputação, pontos políticos, situação criminal, prisão e tutorial recomeçam. A jornada volta a `welcome`, na modalidade `standard`.

São removidos os dados pertencentes ao cidadão e os registros dependentes: contas, cartões, faturas, empréstimos, investimentos, operações, empresas, produtos, inventário, serviços, documentos, progressão, posts, comentários, conversas, filiações, candidaturas e consequências jurídicas. As chaves estrangeiras são percorridas até alcançar os dependentes. Vínculos compartilhados também podem ser removidos: uma transferência envolvendo a conta, respostas ao post apagado, membros de um partido removido, produtos de uma empresa removida e mensagens de uma conversa compartilhada.

Os saldos e as identidades dos cidadãos fora da seleção permanecem. Os apontamentos de cargos em `executive_governance` e `election_office_sync` são limpos para não restaurarem nomeações antigas. Contadores sociais são reconciliados com o conteúdo restante.

O frontend acompanha alterações do próprio perfil por Realtime, atualiza ao retomar a aplicação e verifica novamente a cada minuto enquanto a página está visível. A troca do `citizen_id` recria a árvore das páginas, descartando o estado em memória do personagem anterior. O carrinho e as dispensas dos avisos de check-in e salário usam chaves por cidadão, para não reaproveitarem o estado da vida anterior. O usuário é encaminhado ao Registro Nacional de Cidadania; a conta bancária e os documentos novos usam as RPCs existentes, inclusive o saldo inicial configurado e sua proteção contra duplicidade.

## Economia da nova temporada

Antes da confirmação do reset completo, o cliente consulta novamente as fontes usadas no panorama de países: Banco Mundial, os fallbacks existentes e Frankfurter. Para o Brasil, consulta também a Selic no Banco Central (SGS 432) e as cotações de USD, EUR, GBP, JPY e CNY em reais. A operação exige todos os indicadores necessários, as fontes e a data de consulta. Se a consulta falhar ou retornar dados incompletos, o reset não é preparado.

O reset limpa históricos, períodos, transações, eventos, decisões de política, choques, reservas e dívidas do RP. O Tesouro e os empréstimos públicos começam zerados. PIB, câmbio, indicadores demográficos e Selic partem da fotografia real; índices internos e a ponderação de jogadores/simulação recomeçam em seus valores iniciais. Os países ativos recebem a mesma fotografia em `economic_baseline` e `economic_current`, revisão zero e nova data de início. Os grupos populacionais e o mercado de câmbio são reconstruídos. Regras iniciais de governo são repostas para permitir novas leis e empresas. Definições do catálogo e parâmetros administrativos do motor permanecem configurados.

Depois disso, os gatilhos e o motor existentes voltam a governar a economia corrente. A fotografia de partida fica preservada. Os dados anuais podem ter um ano de referência anterior ao da consulta; a prévia informa o ano e as fontes.

## Confirmação e integridade

1. O administrador escolhe o alcance e informa um motivo de 5 a 500 caracteres.
2. `admin_prepare_rp_reset` valida o acesso e guarda uma solicitação privada com IDs, fontes e contagens da prévia. Nenhum dado do jogo é apagado nessa etapa.
3. A confirmação exige `RESETAR USUARIOS` ou `RESETAR RP`, conforme o alcance, em até 15 minutos.
4. `admin_execute_rp_reset` valida novamente o administrador e a solicitação. Resets globais são recusados se a lista de contas ou países mudou desde a prévia.
5. A exclusão, a reinicialização e o registro do resultado ocorrem em uma transação. Uma falha reverte tudo. Repetir a mesma solicitação concluída retorna o resultado salvo.

Durante a execução, tabelas são bloqueadas para impedir escritas concorrentes e observação de estado parcial. Apenas os gatilhos de aplicação são suspensos temporariamente; chaves estrangeiras, unicidade e constraints continuam valendo. Os modos originais dos gatilhos são restaurados ao concluir ou pelo rollback em caso de erro. Atividades relacionadas criadas depois da prévia e antes da execução entram no reset; o histórico guarda as contagens efetivamente planejadas sob os bloqueios.

`private.rp_reset_policy()` classifica explicitamente cada tabela pública como preservada, reiniciada ou limpa. Uma tabela nova sem classificação impede o reset até que a política seja revisada. As funções auxiliares e a tabela de solicitações não são acessíveis diretamente aos clientes. O histórico administrativo mostra as últimas 30 operações concluídas.

Os arquivos de mídia sem referência deixados no Storage não fazem parte da transação SQL: as URLs são removidas dos registros do jogo. A remoção física de objetos exige a API de Storage e pode ser tratada pela manutenção de arquivos órfãos, sem excluir arquivos de outros cidadãos.

## Instalação e testes

A migração `supabase/migrations/20260905141051_admin_citizen_and_rp_reset.sql` deve ser aplicada antes da publicação do frontend. Ela adiciona somente a infraestrutura do recurso; **aplicar a migração não executa nenhum reset**. O histórico local e remoto deve conter a mesma versão após a aplicação.

O teste `supabase/tests/admin_rp_reset.sql` exige uma cópia isolada e vazia do esquema com todas as migrações aplicadas. Ele recusa bancos que já contenham perfis e faz rollback de todas as fixtures. Para o container de teste `govrp-reset-test`:

```sh
npm run test:resets
```

Outro container pode ser indicado por `RESET_TEST_CONTAINER`. Nunca use o banco de produção nem a base local de jogadores para estes testes.

As verificações cobrem permissões, prévia sem exclusões, confirmação, reset individual/em lote/global, dados compartilhados, preservação de terceiros, recriação completa da cidadania, saldo inicial único, repetição da solicitação, falha forçada com rollback, gatilhos, expiração, regras iniciais e evolução econômica posterior pelo RP.
