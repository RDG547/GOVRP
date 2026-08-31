# Matriz interna de permissões — Alpha

Data da auditoria: 30/08/2026

Esta matriz registra os acessos efetivos dos domínios de maior impacto. `Serviço` significa backend com chave secreta; essa chave nunca é enviada ao navegador. Funções de transição validam `auth.uid()`, cargo, estado atual e regras do fluxo antes de escrever.

| Entidade | SELECT | INSERT direto | UPDATE direto | DELETE direto | Caminho autoritativo |
|---|---|---|---|---|---|
| `profiles` | dados públicos concluídos; dono vê o próprio; Admin vê para gestão | próprio perfil inicial | dono, com campos oficiais protegidos por gatilho | nenhum cliente | onboarding, `admin_update_user`, sincronização eleitoral |
| `candidates` | público vê aprovadas; dono/vice vê a própria; Admin vê todas | nenhum cliente | nenhum cliente | nenhum cliente | `submit_candidacy`, `approve_candidacy`, `reject_candidacy` |
| `votes` | somente eleições com voto público | nenhum cliente | nenhum cliente | nenhum cliente | `cast_vote` |
| `elections` | público | Admin | Admin | Admin | criação administrativa e `settle_election_offices` |
| `election_settlements` e cargos | público | nenhum cliente | nenhum cliente | nenhum cliente | `settle_election_offices`, endpoint Admin autenticado |
| `party_members` | público | nenhum atalho legado | nenhum atalho legado | nenhum atalho legado | filiação, resposta da liderança e desfiliação por RPC |
| `bills` | público | nenhum cliente | nenhum cliente | nenhum cliente | proposta, votação, resultado e decisão presidencial por RPC |
| `bill_votes` / `parliament_voting_votes` | público | nenhum cliente | nenhum cliente | nenhum cliente | `cast_parliament_vote` |
| `parliament_votings` | público | nenhum cliente | nenhum cliente | nenhum cliente | `start_parliament_bill_voting`, `close_parliament_voting` |
| `accounts` | dono e Banco Nacional | nenhum cliente | nenhum cliente | nenhum cliente | abertura no onboarding e RPCs bancárias |
| `transactions` | participantes; histórico global somente Admin por consulta protegida | nenhum cliente | nenhum cliente | nenhum cliente | transferências, compras, boletos e rotinas financeiras autoritativas |
| `cards` | dono e Banco Nacional | nenhum cliente | policy apenas para entrega Realtime; gatilho bloqueia escrita do cliente | nenhum cliente | aprovação de solicitação, cancelamento e `set_bank_card_limit` |
| `credit_card_applications` | dono e Banco Nacional | dono, sempre pendente | policy apenas para Realtime; gatilho bloqueia escrita do cliente | nenhum cliente | aprovar/rejeitar/cancelar por RPC |
| `loan_applications` | dono e Banco Nacional | dono, sempre pendente | policy apenas para Realtime; gatilho bloqueia escrita do cliente | nenhum cliente | aprovar/rejeitar por RPC |
| `loans` legado | dono | nenhum cliente | nenhum cliente | nenhum cliente | novas solicitações usam `loan_applications` |
| `businesses` | dono e Admin | nenhum cliente | dono/Admin apenas para gestão da empresa existente | nenhum cliente | `register_business_authoritative`, compra de empresa e rotinas econômicas |
| `products` | público | nenhum cliente | nenhum cliente | dono pode remover o próprio | `save_business_product` |
| `commerce_orders` | comprador, vendedor empresarial e Admin | nenhum cliente | nenhum cliente | nenhum cliente | `buy_product` |
| `police_occurrences` | participante e autoridades contextuais | nenhum cliente | nenhum cliente | nenhum cliente | `create_police_occurrence`, triagem e investigação por RPC |
| `criminal_investigations` | partes e autoridades contextuais | nenhum cliente | nenhum cliente | nenhum cliente | abertura, provas, relatório e indiciamento por RPC |
| `criminal_cases` | partes e autoridades contextuais | nenhum cliente | nenhum cliente | nenhum cliente | denúncia do MP, recebimento judicial e transições por RPC |
| decisões, sentenças e mandados | partes e autoridades conforme sigilo/função | nenhum cliente | nenhum cliente | nenhum cliente | RPCs exclusivas de Juiz/autoridade competente |
| `government_finances` | Admin e Presidência | nenhum cliente | nenhum cliente | nenhum cliente | despesas, receitas e decisões econômicas validadas |
| `government_rules` / `law_effects` | público para transparência | nenhum cliente | nenhum cliente | nenhum cliente | proposta estruturada e ativação após sanção/promulgação |
| `national_indicator_points` | público | nenhum cliente | nenhum cliente | nenhum cliente | gatilhos e motores de consequência |
| `government_popularity_state` | público | nenhum cliente | nenhum cliente | nenhum cliente | `apply_government_impact` e consumidores de eventos |
| `national_game_events` / `national_events` | público conforme estado | nenhum cliente comum | nenhum cliente comum | nenhum cliente | criação Admin, decisão de autoridade e resolução por RPC |
| `domain_events` | público para transparência | nenhum cliente | nenhum cliente | nenhum cliente | produtores internos idempotentes |
| logs eleitoral, econômico, judicial e de segurança | autoridade correspondente | nenhum cliente | bloqueado inclusive para serviço normal | bloqueado inclusive para serviço normal | gatilhos/funções internas append-only |

## Verificações executadas

- Todas as tabelas públicas indicadas pelos advisors estão com RLS habilitado.
- O advisor de segurança local encerrou com zero erros.
- Escritas diretas críticas foram testadas com contas reais e rejeitadas.
- Escritas legítimas foram testadas pelas funções autoritativas.
- Logs imutáveis rejeitaram tentativas reais de alteração.
- Índices foram adicionados às pesquisas administrativas, timelines, eventos, auditorias e políticas novas.

## Regra operacional

Qualquer entidade nova que conceda cargo, mova dinheiro, altere regra do país, decida processo ou mude resultado eleitoral deve nascer sem escrita direta do cliente e com teste funcional de negação + caminho legítimo.
