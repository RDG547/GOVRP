# Auditoria e implementação do prompt mestre — 15/08/2026

## 1. Funcionalidades reaproveitadas

Foram preservadas e ampliadas as estruturas existentes de CPI/CPMI, eleições das Mesas Diretoras, tramitação parlamentar, ocorrências, investigações, processos, mandados, execução penal, DIC, notificações, contas bancárias, economia nacional, perfil do cidadão, partidos, marketplace, PWA e aplicativo Capacitor. Nenhum segundo sistema concorrente foi criado para esses domínios.

## 2. Correções principais

- Hora do Diário Oficial transferida para a fonte autoritativa do PostgreSQL.
- Status e contadores prisionais sincronizados com o relógio do servidor.
- Hierarquia partidária e imutabilidade do fundador protegidas em RPCs.
- Casa legislativa de projetos validada pelo mandato no backend.
- Pagamentos de multas e investimentos tornados transacionais e idempotentes.
- Confirmação Stripe transferida para webhook assinado; identidade do doador deriva da sessão.
- PDF e selo do DIC corrigidos.
- Funções legadas inválidas encontradas pelo linter do banco foram corrigidas ou removidas quando comprovadamente obsoletas.
- Escritas diretas em tabelas sensíveis foram revogadas em favor de funções com autorização.

## 3. Funcionalidades criadas ou completadas

- Popularidade nacional auditável e séries históricas de indicadores.
- Ministérios dinâmicos, histórico e reputação de ministros.
- Veículos de imprensa, enquadramento editorial e contratos de publicidade com risco.
- Fluxo de integridade pública sem condenação automática.
- Ciclo completo de multas, recursos e audiências.
- Pedidos cidadãos de investigação/liberação de bens, campanhas, procurados, antecedentes e métricas policiais.
- Portfólio de investimentos e histórico patrimonial.
- Doações seguras por Stripe e PIX.
- Onboarding persistente com documentos reais e reset administrativo.
- hCaptcha no cadastro e login.

## 4. Banco de dados alterado

As migrations adicionaram ou ampliaram: `party_history`, `fine_appeals`, `fine_hearing_requests`, `investigation_subjects`, `citizen_justice_requests`, `public_safety_campaigns`, `investment_operations`, `investment_portfolio_snapshots`, `donations`, `donation_webhook_events`, `government_ministries`, `minister_history`, `government_popularity_state`, `government_popularity_events`, `national_indicator_points`, `media_outlets`, `government_media_contracts`, `public_integrity_cases` e `public_integrity_case_events`. Tabelas existentes receberam colunas de snapshot, auditoria, estado e integração sem descartar registros antigos.

## 5. Migrations adicionadas

- `20260815100000_core_identity_parties_and_server_time.sql`
- `20260815103000_justice_fines_and_citizen_services.sql`
- `20260815110000_atomic_investment_portfolio.sql`
- `20260815113000_secure_donations.sql`
- `20260815120000_dynamic_government_media_and_integrity.sql`
- `20260815123000_parliament_proposals_and_suggestions.sql`
- `20260815124500_commerce_receipt_snapshots.sql`
- `20260815130000_operational_hardening.sql`
- `20260815131500_justice_privacy_and_subjects.sql`
- `20260815133000_party_rpc_hardening.sql`
- `20260815134500_government_impact_integrations.sql`
- `20260815140000_government_project_impact_statuses.sql`

Todas constam como aplicadas no projeto Supabase vinculado.

## 6. RPCs, functions e triggers

Foram adicionadas ou substituídas funções para: relógio oficial, onboarding, hierarquia/fundador partidário, emissão/pagamento/recurso/audiência de multa, pedidos cidadãos, campanhas, antecedentes, procurados, métricas, negociação de investimentos, popularidade, ministérios, ministros, imprensa, contratos, integridade, propostas/sugestões parlamentares, comprovantes comerciais e rotinas legadas. Triggers garantem horário oficial, número imutável de multa, snapshots, histórico e atualização em tempo real.

## 7. RLS e segurança

Leitura pública foi limitada ao que é institucionalmente público; cidadãos veem seus próprios registros; investigações sigilosas não são reveladas; autoridades dependem de competência real; e tabelas financeiras/políticas sensíveis não aceitam alteração direta do cliente. Operações críticas usam bloqueio de linha, constraints e chaves idempotentes.

## 8. Funções HTTP/servidor

O backend Vercel de doações foi atualizado e ganhou endpoint `api/donations/stripe-webhook.js`. A assinatura do webhook é validada antes da confirmação e eventos repetidos são ignorados de forma segura.

## 9. Variáveis e secrets manuais

Configurar nos ambientes adequados:

- Frontend/Vercel: `VITE_HCAPTCHA_SITE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Somente servidor Vercel: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ABACATEPAY_API_KEY`.
- Supabase Auth: habilitar hCaptcha e cadastrar sua secret key.
- Stripe: criar uma nova chave secreta rotacionada e apontar o webhook para `/api/donations/stripe-webhook`.

Nunca usar a chave Stripe anteriormente exposta nem mover secrets para variáveis `VITE_*`.

## 10. Testes realizados

- `npm run lint`: aprovado.
- `npm run build`: aprovado, incluindo geração do PWA.
- `npm run test:functional`: valida migrations, segredos no frontend, hCaptcha, DIC, idempotência e smoke tests públicos.
- `supabase db lint --linked --level error`: zero erros.
- Smoke test remoto: relógio oficial, popularidade, ministérios, procurados e métricas policiais responderam corretamente.

As regras autenticadas/destrutivas foram verificadas por inspeção de RLS/RPC e constraints; não foram criadas multas, movimentados saldos ou alterados cargos de jogadores reais apenas para testar produção.

## 11. Problemas encontrados

O banco possuía funções antigas apontando para colunas/tabelas removidas, deleção de Storage inexistente, enum partidário antigo, cast de enum judicial incorreto e conflito parlamentar sem constraint compatível. Esses problemas foram eliminados; o lint remoto ficou limpo.

## 12. Pendências externas

As únicas pendências dependem de contas/segredos externos: ativar hCaptcha no Supabase, cadastrar o site key no Vercel, rotacionar/configurar Stripe, cadastrar o webhook e configurar AbacatePay caso o PIX seja usado. Sem esses secrets, as telas informam indisponibilidade sem expor credenciais.

## 13. Melhorias adicionais

- Correção de rotinas administrativas de senha, salário, comentários e sincronização parlamentar.
- Remoção de números aleatórios no painel administrativo.
- Ministérios criados pelo Presidente passam a aparecer na nomeação de ministros sem hardcode.
- Consultas bancárias e de Justiça atualizam por Realtime.

## 14. Riscos e monitoramento

- Monitorar falhas de entrega de webhook, eventos Stripe não conciliados e disponibilidade da AbacatePay.
- Revisar periodicamente o peso e os limites dos impactos de popularidade conforme o RP ganhar escala.
- Acompanhar tamanho das tabelas de auditoria, notificações, histórico de indicadores e snapshots de portfólio.
- A configuração CSP deve ser revisada quando novos gateways externos forem incorporados.
- O bundle principal permanece grande e merece divisão adicional em rotas numa otimização futura.
