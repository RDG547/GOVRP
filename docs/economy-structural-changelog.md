# GOV.RP — changelog completo da reforma estrutural da economia

Trabalho acumulado de 21 a 23/11/2026, desde o primeiro prompt e incluindo todas as retomadas. Repositório `RDG547/GOVRP`, base `936ba5dd65f38e32e6d536cf16ca39eb74e689df`.

**Situação atual: 18 migrations e integração real verificadas em homologação; liberação gradual preparada. Consulte a seção de conclusão e economy-release-status.json para o estado de produção. Os ensaios não comprovam sustentabilidade universal.**

## Conclusão da homologação — 23/11/2026

Esta seção atualiza os estados históricos abaixo sem apagar o registro do trabalho anterior.

- Reutilizado o ambiente Supabase do PR: `vsuwizhffoyisklhoule`. As 18 migrations estruturais estão instaladas, verificadas por versão/nome; não foram reaplicadas.
- Corrigidos três bloqueios legados de reprodução do schema: dois atos históricos são pulados somente quando seus registros de origem não existem; a proteção partidária já instalada não é reaplicada. Nenhuma eleição/veto de produção foi alterado.
- Alinhados 17 nomes de arquivos à versão já registrada em produção. O mapeamento auditável está em `docs/economy-migration-version-alignment.json`. O histórico de produção não foi reescrito.
- 20 verificações aprovadas com duas sessões Auth reais: RPC pública, cinco RPCs administrativas, negativas de permissão, leitura sob RLS, entrega de eventos e reconexão. Contas sintéticas somente na homologação; sem envio de email.
- A confirmação do canal precedia a prontidão da replicação PostgreSQL. O transporte compartilhado agora reconcilia também na confirmação de prontidão do banco; 22 verificações comportamentais cobrem esse fluxo.
- Motor operacional completo, com triggers reais: 68 dias-empresa processados e R$ 5.402,18 de consumo. Nenhum saldo/estoque negativo ou dia duplicado. Não são dados posteriores de produção.
- Nova migration de conclusão: investimento público derivado de despesas capturadas de projetos e parcela produtiva, sem confundir manutenção/transferência; CPI combina índices de preços do mesmo produto com a cesta simulada, respeitando pesos configurados e datas históricas; orçamento por categoria fica fixo durante a rodada, fornecedores reservados saem do denominador, compras usam tributos efetivos e localização tem peso limitado e neutro quanto ao proprietário.
- Nova migration de recuperação: pequenas tentativas semanais de produção após falta prolongada de insumos, sujeitas a caixa/insumos/equipe reais; reposição de anúncios NPC ativos usa apenas estoque não reservado, sem recriar mercadorias ou pular cobrança/validade do anúncio.
- Seis verificações novas de preço comparável e investimento capturado aprovadas; regressões de períodos, fiscal e fechamentos aprovadas. Reposição foi executada em transação revertida na homologação e conservou estoque físico.
- Advisors não apontaram erro de segurança. Avisos existentes de funções públicas protegidas por lógica de autorização, tabelas privadas com RLS sem política e proteção contra senha vazada permanecem discriminados; não houve relaxamento de RLS para fazer os testes passarem.
- O ensaio de 56 dias afetado pelo consumo foi atualizado; o ensaio adicional de recuperação, 28 dias sem humanos, aprovou 33 verificações contábeis e manteve R$ 100.036,13 de dinheiro total. Nenhum aporte foi feito durante as simulações. A presença de prejuízos/insolvência não foi ocultada.

### Resultados atualizados do ensaio de consumo de 56 dias

| Humanos | Dinheiro inicial = final | Salários pendentes | Resultado operacional | Encerramentos |
| --- | --- | --- | --- | --- |
| 0 | R$ 100.036,13 | R$ 8.296,65 | −R$ 92.703,42 | 5 |
| 5 | R$ 111.700,23 | R$ 82.417,39 | −R$ 282.291,43 | 29 |
| 30 | R$ 177.796,19 | R$ 259.972,55 | −R$ 557.440,47 | 25 |

Estes são cenários de concorrência sem gestão corretiva das empresas humanas, com capital e autorização financeira sintéticos declarados no teste. Demonstram conservação e continuidade da atividade, não lucro garantido nem aceitação de sustentabilidade universal. O teste de recuperação posterior cobre a nova tentativa de produção; não equivale a repetir todos os cenários de 56 dias.

### Liberação e decisões administrativas

Código validado para implantação gradual com o piloto NPC desativado. Ativação do piloto, autorização de programa financeiro e recuperação histórica continuam exigindo decisão administrativa específica. Nenhum orçamento ou correção histórica foi autorizado por esta implementação. A cobertura fiscal estima bases modeladas e informa regras sem base nacional estimável; receitas efetivas dessas regras continuam registradas operacionalmente.

Status de produção será registrado em `docs/economy-release-status.json` após verificar migrations e publicação. O checklist anterior registra o ponto de partida desta retomada; as verificações de homologação/Realtime, investimento público, CPI normalizado, reposição e alinhamento de migrations descritas nesta seção já foram concluídas.

## Investigação e preservação

Consultados repositório, migrations, estrutura e funções reais do Supabase, RPCs, triggers, jobs, catálogo, regras legais, calendário, painéis e transporte compartilhado. Confirmados limites trimestrais inconsistentes, divergência entre PIB publicado e eventos posteriores, escassez de caixa e ausência de NPCs ativos. A implementação reutiliza a arquitetura existente: 16 migrations incrementais, componentes nos painéis atuais e testes reproduzíveis.

Não houve reset, exclusão de dados, reescrita de saldos, alteração de tributos, mudança do calendário político ou correção automática do histórico publicado.

## Calendário, competência e fechamentos

- Limites canônicos em UTC, início inclusivo/fim exclusivo, conversão explícita entre tempo real e RP.
- Trimestre exige três meses válidos/fechados; ano exige quatro trimestres. Fechamento antecipado bloqueado mesmo com parâmetro de força.
- Locks por período, precedência cronológica, idempotência e contagem correta das execuções concluídas.
- Captura imutável dos eventos e insumos fiscais usados no fechamento; períodos superiores reutilizam capturas dos filhos.
- Eventos atrasados ou visíveis somente após a captura entram em fila auditável de revisão, sem alterar silenciosamente agregados publicados.
- Competência diária de salários, consumo de insumos e despesas operacionais distribuída entre meses RP atravessados pelo dia civil de São Paulo, conservando centavos. Vendas mantêm o momento efetivo da liquidação.
- Chaves de origem/grupo distintas por parcela mensal, compatíveis com o índice único de produção; vínculo com a transação original preservado.
- Transição prospectiva a partir do próximo mês/trimestre/ano RP completo. Períodos legados incompatíveis ficam explicitamente bloqueados, sem paralisar os novos ciclos.
- Prévia administrativa por período: limites armazenados/canônicos, PIB publicado, ledger, capturas, filhos, revisões e orientação de recuperação. Não foi implementada aplicação automática de correção histórica.

## Empresas NPC e circulação monetária

- Entrada em lacunas reais de abastecimento, com capital debitado da carteira populacional, reserva para consumo, CNPJ e equipe mínima financiados.
- Configuração inicial: até 32 NPCs ativos, duas entradas por dia, reserva populacional de 75% e limite de registros. Piloto desativado por padrão.
- Escassez persistente observada antes de ampliar fornecedores; limite de dois NPCs ativos por recurso e intervalo de 14 dias entre entradas para reduzir redundância.
- Produção, insumos, salários, despesas, impostos, estoque, fechamento semanal, contratação/demissão e saída integrados ao motor existente.
- Encerramento preserva passivos, salários devidos, estoque e caixa residual. Fechamento semanal não reabre empresa encerrada pelo gestor autônomo.
- Retorno de até 25% do lucro retido elegível à população, com reserva para custos/salários, bloqueio por salários pendentes, imposto de transferência e registro auditável. Não há distribuição de lucro inexistente.
- Controle administrativo de ativação/desativação com identidade, justificativa, chave de idempotência e registro da configuração anterior/posterior. Não capitaliza empresas instantaneamente.
- Programa opcional de circulação exige autorização, referência, orçamento total, teto diário e prazo. Limites técnicos de R$ 100 mil/dia, R$ 1 milhão no total e 90 dias reais. Cada pagamento fica limitado ao caixa efetivo do Tesouro e produz transferência e despesa operacional vinculadas. Pode ser encerrado para impedir pagamentos futuros.
- Nenhum programa de circulação é criado ou ativado pela migration. Não há emissão de dinheiro nem dívida automática para cobrir saldo insuficiente.

## Produção, comércio e Mercado Nacional

- Diagnóstico de receitas, insumos necessários, fornecedores, capacidade e estoque efetivamente disponível.
- Estoque livre desconta contratos pendentes e anúncios aprovados. Locks ordenados protegem contas/estoque/reservas contra gasto ou venda simultânea.
- Liquidação valida valores finitos, aplica regras legais vigentes e conserva pagamento/impostos. Compra parcial considera saldo incluindo tributos.
- NPCs procuram múltiplos fornecedores. Produção depende de insumos reais, equipe, vendas recentes, contratos e estoque acumulado; teste inicial de demanda limitado.
- Consumo automático por categorias com carteira finita e condições econômicas/ofertas; retirada a quota que favorecia um tipo de proprietário.
- Mercado limitado por orçamento/estoque reais; consumo parcial evita bloquear mercadoria apenas porque a compra integral excede o saldo.
- Novos anúncios NPC usam parcela limitada do estoque livre, preservando outros canais.
- Preservadas as 69 referências com preço automático desativado. Decisões administrativas de preço não foram substituídas.

## Viabilidade e tributação

- Avaliados 68 tipos empresariais, receitas, produtividade regional, pessoal, salários, despesas, licenças e tributos sobre insumos/vendas.
- No catálogo examinado, 33 tipos tinham margem potencial negativa no preço de referência. A solução calcula preço específico por custo/risco dentro do intervalo existente de multiplicadores de 1 a 3, sem alterar preços oficiais manuais.
- Os 68 tipos alcançaram margem potencial positiva em algum preço permitido nas condições de custo inspecionadas. Isso depende de venda e demanda: não garante lucro ou sustentabilidade.
- Custos, preço sugerido e ponto de equilíbrio nos painéis empresarial/administrativo; consulta protegida por dono autorizado ou administrador.
- Ajuste NPC gradual e limitado de preços, sem reajustar referências administrativas do Mercado Nacional.
- Preservadas as alíquotas de consumo 15,99%, vendas empresariais 28,16% e transferência 4,75%. As funções consultam as regras legais aplicáveis.

## Indicadores nacionais e contas públicas

- População nacional consistente no denominador macroeconômico.
- Preços atualizados pelo tempo RP efetivamente transcorrido, com limite por execução e atraso remanescente preservado; repetição do job não multiplica inflação.
- CPI por cesta comparável; inflação anual indisponível até existir histórico suficiente. Preços brutos de bens/unidades diferentes não são comparados diretamente.
- Mercado de trabalho suavizado e limitado por atualização para reduzir saltos de amostra pequena.
- Recessão/recuperação dependem de sequência persistente de períodos fechados; recuperação exige contração seguida de expansão. Backlog usa o período correspondente.
- Fluxos monetários observados na mesma unidade para jogadores/população, corrigindo venda à população sem multiplicador versus custo humano multiplicado. Pesos explícitos de classificação permanecem; produção sintética nacional e sinais amostrais ficam separados. Mudança somente prospectiva.
- Pesos nacionais configurados de participação simulada/jogadores preservados. Não se afirma que correspondam à proporção nominal das transações da plataforma.
- Modelo fiscal nacional separado do banco; receita simulada não credita trilhões no Tesouro operacional.
- Histórico legal, capturas fiscais e estimativa sobre produção sintética excluindo firmas transacionais, com cobertura/limitações explícitas.
- Receitas operacionais conciliadas sem duplicidade; estabilizadores simulados identificados. Desembolso do programa autorizado vincula despesa à transferência real.
- Dívida e ativos evoluem por receita, despesa, juros, déficit/superávit. Superávit amortiza dívida antes de acumular ativos; dívida anual usa o último trimestre.
- Investimento privado deixa de ser classificado como público. A classificação detalhada de investimento público operacional ainda precisa ser completada; zero nesse campo não comprova ausência de investimento real.
- Crescimento indisponível entre bases não comparáveis; revisão contábil não aparece como crescimento novo.

## Interface, Realtime e segurança

- Integração aos painéis administrativo, público, governamental, empresarial e Mercado Nacional, preservando o estilo visual.
- Administração recebe diagnóstico de cadeias/períodos, fontes fiscais, viabilidade, revisão histórica e controle do piloto NPC.
- Empresas recebem custos/ponto de equilíbrio; Mercado recebe autorização e encerramento do programa finito.
- Governo mostra fontes, cobertura, ativos e separação entre modelo nacional e banco.
- Público usa PIB trimestral de períodos fechados, sem misturar totais anuais; histórico cambial separado do contábil e câmbio histórico preservado.
- Dados ausentes aparecem como indisponíveis, sem conversão silenciosa em zero.
- Proteções contra respostas antigas após troca de usuário/solicitação; estados de bloqueio, falha de sincronização e nova tentativa.
- Tabelas necessárias adicionadas à publicação Realtime mediante verificação de RLS; transporte compartilhado e agrupamento de invalidações preservados.
- Helpers/tabelas privadas sem acesso direto de usuários comuns, RLS adicional e RPCs protegidas. Verificação administrativa nula nega acesso.
- Idempotência, decisões auditadas e locks nos caminhos financeiros críticos.
- Testes criam bancos descartáveis próprios e rejeitam host remoto para execução destrutiva. Não foram executados testes sobre dados de produção.
- CI preparada com PostgreSQL 17.12, testes estruturais, concorrência, carga e ensaio prolongado. Execução local não equivale a CI remoto aprovado.
- Dependências de teste fixadas: PGlite 0.3.14 e pg 8.16.3, preservando o restante do grafo do lockfile.

## Verificações realizadas

| Verificação | Resultado | Limite |
| --- | --- | --- |
| Períodos/integridade/liquidação | 83 aprovadas | Cotações e fronteiras externas selecionadas usam fixtures |
| Catálogo/viabilidade | 22 aprovadas; 68 tipos | Catálogo/regras reais, registros sintéticos |
| Macro | 14 aprovadas | Relógio e políticas controlados |
| Fiscal | 19 aprovadas | Registros isolados sintéticos |
| Fechamentos | 41 aprovadas; 12 meses, 4 trimestres, 1 ano | Contabilidade real; fronteiras de apresentação/atividade substituídas |
| Competência/unidade monetária | 20 aprovadas | Conversão/eventos reais; resolvedor setorial substituído |
| Circulação/controle NPC | 25 aprovadas | Funções financeiras reais; autenticação de teste |
| Transporte compartilhado | 21 aprovadas | Transporte simulado, não duas sessões Supabase |
| Concorrência nativa | 10 aprovadas; 20 conexões, 60 tentativas | Banco isolado; lote concorrente em 335 ms |
| Carga de captura/revisão | 3 aprovadas; 50 mil eventos | Captura 1.963 ms, varredura 73 ms; não é benchmark integral |
| Ensaio prolongado | 183 verificações contábeis; 56 dias, 0/5/30 humanos | Condições sintéticas; não comprova sustentabilidade geral |
| Regressões existentes | Integridade/realtime e empresa/Mercado aprovadas | Testes de contrato existentes |
| Frontend | Build aprovado em 25,28 s, PWA gerada | Avisos de chunks grandes permanecem |
| ESLint da interface alterada | 0 erros, 1 aviso preexistente | Ref no cleanup de NationalProductionMarket |
| Visual desktop/mobile | 1.365 e 390 px; sem erros capturados/overflow de página | Componentes reais, RPC/Auth/transporte simulados |

São 245 verificações na suíte principal, além de concorrência, carga e ensaios prolongados, em escopos diferentes. Não cobrem todos os triggers/constraints/Auth/RLS do Supabase real. Logs e capturas acompanham o pacote. Resultados prolongados/carga já concluídos foram reaproveitados. A correção final de unidade monetária passou na suíte de competência e fechamentos; o ensaio prolongado cobre o motor operacional sem acionar todos os triggers macroeconômicos.

### Resultados do ensaio de 56 dias

Condições: carteira populacional inicial sintética de R$ 100.000; capital das empresas humanas incluído no total inicial; Mercado com R$ 36,13; Tesouro inicialmente sem caixa. Autorização sintética de até R$ 10.000/dia, limitada à arrecadação efetiva e teto total de R$ 560.000. Sem aportes no meio do ensaio, compras manuais ou anúncios de marketplace. Confiança reduzida e depois elevada. Empresas humanas de dez setores, sem gestão corretiva durante o ensaio.

| Humanos | Dinheiro inicial = final | Pagamentos acumulados do programa | Salários devidos ao final | Resultado operacional acumulado | Encerradas | Negociações B2B |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | R$ 100.036,13 | R$ 144.272,32 | R$ 7.463,70 | −R$ 40.718,72 | 5 | 61 |
| 5 | R$ 111.700,23 | R$ 185.267,52 | R$ 15.211,28 | −R$ 128.024,43 | 5 | 227 |
| 30 | R$ 177.796,19 | R$ 235.384,18 | R$ 204.092,49 | −R$ 488.710,78 | 22 | 415 |

Pagamentos acumulados podem superar o estoque monetário porque o mesmo dinheiro circula várias vezes. Houve produção, salários, tributos e comércio sem compras humanas, com total de dinheiro constante. Também houve insolvência/passivos, sobretudo com mais concorrência. **Não se pode afirmar que toda a economia ficou autossustentável.** Falta demonstrar persistência das cadeias essenciais nas condições reais, sem garantir lucro.

### Comparação verificável com a produção

Fotografia anterior à aplicação: 22 empresas humanas ativas, nenhuma NPC ativa; população R$ 16.158,49; Mercado R$ 36,13; 69 preços manuais. Dívida macro aproximada R$ 1,271 bilhão; PIB mensal-base aproximado R$ 1,025 trilhão. Em 2028/T4: publicado R$ 1.053.693.350.784,24 versus soma posterior R$ 1.583.377.632.864,54, diferença R$ 529.684.282.080,29. Essa diferença não deve ser simplesmente sobrescrita.

No recorte consultado de oito datas civis inclusivas: receitas R$ 13.409,37; folha R$ 23.143,06; insumos R$ 1.227,10; despesas operacionais R$ 4.368,00. Não é o mesmo recorte dos sete dias citados no prompt.

**Não existe “depois em produção” desta reforma.** A comparação verificável é de comportamento: completude dos períodos testada, saldos/estoques protegidos sob concorrência e Tesouro bancário inalterado pelos fechamentos fiscais simulados. Valores dos ensaios não são previsões ou melhorias medidas em produção.

## O que ainda falta

1. Homologação Supabase isolada com schema/triggers/constraints completos; aplicar migrations e verificar compatibilidade. O usuário não sabe se esse ambiente existe; produção não foi usada como substituto.
2. Testar Auth, RLS, permissões, jobs e duas sessões reais com reconexão/falha parcial; executar advisors após aplicação em homologação.
3. Comprovar sustentabilidade das cadeias essenciais, distribuição regional/renda e respostas políticas. Os ensaios têm perdas/salários pendentes: integridade contábil não basta para aceitação econômica.
4. Completar cobertura fiscal não modelada e investimento público operacional; integrar preços transacionais normalizados ao CPI e validar composição nacional/câmbio.
5. Verificar reposição contínua de anúncios e sustentabilidade da revenda do Mercado com preços manuais/tributação vigentes. Não há autorização para alterar essas decisões por conta própria.
6. Conferir CI remoto e dependências. Auditoria anterior identificou 20 avisos (2 baixos, 8 moderados, 8 altos, 2 críticos), não corrigidos neste escopo nem considerados resolvidos. Bundles grandes permanecem.
7. Backup, revisão final, aplicação das migrations, publicação do frontend e conferências posteriores. Não houve merge, aplicação ou deploy até a preparação desta entrega.
8. Ativar piloto NPC e eventual programa financeiro somente por decisão administrativa. Recuperação histórica exige prévia, plano e aprovação específica, conforme o prompt.

Consulte [situação por ordem do prompt](economy-structural-progress.md) e [roteiro de aplicação](economy-structural-deployment.md). O inventário abaixo identifica os arquivos e funções incluídos.


## Inventário completo de arquivos

### Frontend

- `src/components/business/CompanyManagement.jsx`
- `src/features/economy/components/AutonomousEconomyControl.jsx`
- `src/features/economy/components/BusinessViability.jsx`
- `src/features/economy/components/EconomicPeriodReview.jsx`
- `src/features/economy/components/EmbeddedEconomyPanel.jsx`
- `src/features/economy/components/NationalProductionMarket.jsx`
- `src/features/economy/components/PopulationCirculationControl.jsx`
- `src/features/economy/components/StructuralEconomyStatus.jsx`
- `src/features/economy/pages/AdminEconomyPanel.jsx`
- `src/features/economy/pages/BusinessEconomyPanel.jsx`
- `src/features/economy/pages/GovernmentEconomyPanel.jsx`
- `src/features/economy/pages/PublicEconomyPanel.jsx`
- `src/lib/countryRpEconomy.js`
- `src/lib/economy/api.js`
- `src/lib/economy/format.js`
- `src/lib/economy/period-status.js`
- `src/lib/economy/realtime-tables.js`

### Migrations (ordem de aplicação)

- `supabase/migrations/20261121224038_structural_economy_period_integrity.sql`
- `supabase/migrations/20261121224125_structural_economy_supply_diagnostics.sql`
- `supabase/migrations/20261121224214_structural_economy_autonomous_enterprises.sql`
- `supabase/migrations/20261121224803_structural_economy_settlement_guards.sql`
- `supabase/migrations/20261121225034_structural_economy_realtime.sql`
- `supabase/migrations/20261122071544_structural_economy_national_market.sql`
- `supabase/migrations/20261122071714_structural_economy_macro_stability.sql`
- `supabase/migrations/20261122072103_structural_economy_fiscal_reconciliation.sql`
- `supabase/migrations/20261122072643_structural_economy_dashboard_sources.sql`
- `supabase/migrations/20261122112211_structural_economy_population_income.sql`
- `supabase/migrations/20261122165541_structural_economy_period_transition.sql`
- `supabase/migrations/20261122170123_structural_economy_accrual_calendar.sql`
- `supabase/migrations/20261122170701_structural_economy_sector_viability.sql`
- `supabase/migrations/20261122171707_structural_economy_authorized_circulation.sql`
- `supabase/migrations/20261123084838_structural_economy_pilot_control.sql`
- `supabase/migrations/20261123150116_structural_economy_monetary_basis.sql`

### Testes e fixtures

- `tools/fixtures/structural-economy-catalog.json`
- `tools/fixtures/structural-economy-close-runtime.sql`
- `tools/fixtures/structural-economy-close-schema.sql`
- `tools/fixtures/structural-economy-existing-runtime.sql`
- `tools/fixtures/structural-economy-extra-schema.sql`
- `tools/fixtures/structural-economy-legal-runtime.sql`
- `tools/fixtures/structural-economy-lifecycle-runtime.sql`
- `tools/fixtures/structural-economy-lifecycle-schema.sql`
- `tools/fixtures/structural-economy-macro-runtime.sql`
- `tools/fixtures/structural-economy-schema.sql`
- `tools/structural-test-clock.mjs`
- `tools/structural-test-db.mjs`
- `tools/test-structural-accrual.mjs`
- `tools/test-structural-catalog.mjs`
- `tools/test-structural-circulation.mjs`
- `tools/test-structural-closes.mjs`
- `tools/test-structural-concurrency.mjs`
- `tools/test-structural-economy.mjs`
- `tools/test-structural-fiscal.mjs`
- `tools/test-structural-load.mjs`
- `tools/test-structural-long-run.mjs`
- `tools/test-structural-macro.mjs`
- `tools/test-structural-realtime.mjs`

### Documentação e automação

- `.github/workflows/economy-integrity.yml`
- `docs/economy-structural-changelog.md`
- `docs/economy-structural-deployment.md`
- `docs/economy-structural-progress.md`
- `package-lock.json`
- `package.json`

### Funções/RPCs criadas ou substituídas por migration

- `20261121224038_structural_economy_period_integrity.sql`: `economy_private.period_bounds`, `economy_private.period_close_readiness`, `economy_private.track_period_revision`, `economy_private.ensure_periods`, `economy_private.close_month`, `economy_private.close_quarter`, `economy_private.close_year`.
- `20261121224125_structural_economy_supply_diagnostics.sql`: `private.unreserved_company_stock`, `private.economy_supply_diagnostics`, `public.get_economic_structural_diagnostics`.
- `20261121224214_structural_economy_autonomous_enterprises.sql`: `private.autonomous_entry_candidates`, `private.manage_autonomous_enterprises`, `public.get_autonomous_economy_preview`.
- `20261121224803_structural_economy_settlement_guards.sql`: `private.household_category`, `private.household_resource_weights`, `private.trade_company_resource`, `private.simulate_company_day`, `private.simulate_population_demand`, `private.run_company_economy`.
- `20261121225034_structural_economy_realtime.sql`: .
- `20261122071544_structural_economy_national_market.sql`: `private.buy_national_production`, `private.consume_national_market`, `private.sync_population_marketplace`.
- `20261122071714_structural_economy_macro_stability.sql`: `economy_private.national_population`, `economy_private.process_operational_prices`, `economy_private.calculate_cpi`, `economy_private.calculate_labor_market`, `economy_private.detect_cycle`, `economy_private.generate_simulated_base`.
- `20261122072103_structural_economy_fiscal_reconciliation.sql`: `economy_private.capture_period_inputs`, `economy_private.period_input_events`, `economy_private.period_input_revenues`, `economy_private.period_input_expenditures`, `economy_private.queue_missing_period_events`, `economy_private.track_fiscal_rule_history`, `economy_private.capture_national_fiscal_month`, `economy_private.national_debt_rollforward`, `economy_private.national_fiscal_quarter`, `economy_private.close_month`, `economy_private.close_quarter`, `economy_private.close_year`, `economy_private.run_operational_engine`, `public.process_automatic_stabilizers`.
- `20261122072643_structural_economy_dashboard_sources.sql`: `public.get_public_economic_dashboard`, `public.get_economic_structural_diagnostics`.
- `20261122112211_structural_economy_population_income.sql`: `private.return_population_earnings`, `private.close_company_fiscal_cycle`.
- `20261122165541_structural_economy_period_transition.sql`: `economy_private.period_close_readiness`, `public.get_economic_period_review`.
- `20261122170123_structural_economy_accrual_calendar.sql`: `economy_private.daily_accrual_parts`, `economy_private.on_business_transaction_insert`.
- `20261122170701_structural_economy_sector_viability.sql`: `private.economy_sector_viability`, `public.get_economic_sector_viability`, `private.autonomous_entry_candidates`, `private.manage_autonomous_enterprises`, `private.adjust_population_company`, `public.get_autonomous_economy_preview`.
- `20261122171707_structural_economy_authorized_circulation.sql`: `public.approve_population_circulation`, `public.stop_population_circulation`, `public.get_population_circulation_status`, `private.process_population_circulation`, `private.run_company_economy`.
- `20261123084838_structural_economy_pilot_control.sql`: `public.configure_autonomous_economy`.
- `20261123150116_structural_economy_monetary_basis.sql`: `economy_private.record_event`, `economy_private.on_business_transaction_insert`.
