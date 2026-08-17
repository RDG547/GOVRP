# Auditoria e implementação — Identidade, Cidadão e Primeiro Acesso

Data: 17 de agosto de 2026  
Migração principal: `20260817120000_citizen_identity_onboarding_v2.sql`  
Versão do onboarding: `2`

> Estado de entrega: código e migration preparados e validados. A migration principal de cidadania já havia sido aplicada ao ambiente pelo responsável do projeto antes desta rodada.

## 1. Estrutura anterior encontrada

- `profiles.full_name` era usado extensivamente como nome público em DIC, Rede X, Parlamento, eleições, partidos, Banco, Justiça, dashboards, notificações e relacionamentos.
- `profiles.date_of_birth` alimentava os documentos e a idade do cidadão; portanto, seu significado prático já era IC.
- E-mail e telefone OOC estavam em `profiles`, cuja policy permitia leitura pública de todas as linhas.
- O trigger de `auth.users` copiava nome, e-mail, telefone, nascimento, CPF e RG para o perfil público.
- O cadastro gerava CPF e RG no navegador e misturava conta, personagem e cidadania.
- `ResidencyOnboarding` era um modal curto: residência, CTD, Título e conclusão direta pelo cliente.
- CPF/RG também existiam como cache em `profiles`; o sistema oficial de documentos já usava `documents`.
- A conta bancária podia ser criada durante o fluxo anterior com saldo inicial de R$ 1.000,00.
- O banco auditado continha 161 perfis, 160 CPFs legados, 159 RGs/nascimentos, 153 onboardings concluídos e 81 contas bancárias sem duplicidade por usuário.
- Foram encontrados 31 usuários Google e 3 Discord; metadados OAuth frequentemente não continham nascimento ou telefone.

## 2. O que foi reaproveitado

- `profiles.full_name`, `profiles.username` e `profiles.date_of_birth` foram preservados como identidade IC para evitar uma quebra ampla de integrações.
- `documents` continua sendo a fonte de verdade dos documentos; os campos de `profiles` permanecem apenas como cache de compatibilidade.
- O bucket `avatars` e as validações de upload existentes foram reutilizados.
- O mapa do Brasil com a bandeira foi extraído do onboarding antigo para `BrazilFlag` e reutilizado nas novas telas, sem manter duas implementações.
- O componente visual `OfficialDocument` do DIC é usado na emissão e visualização do onboarding.
- `accounts`, `transactions`, `notifications`, as configurações econômicas, os cargos, partidos, saldos e históricos existentes foram preservados.
- `WelcomeTutorial` foi ampliado; não foi criado um segundo tutorial geral.
- O reset administrativo e o painel de usuários foram adaptados ao novo modelo.

## 3. Como Conta e Personagem foram separados

- Conta OOC: `private.account_identities`, inacessível diretamente a `anon` e `authenticated`, guarda nome real, nascimento real, e-mail e telefone.
- Personagem IC: `profiles.full_name`, `date_of_birth`, `username`, avatar, biografia, origem, residência e aspiração.
- Cidadania: `citizen_id`, `citizenship_created_at`, documentos em `documents`, conta em `accounts` e eventos em `citizen_lifecycle_events`.
- O nome real só chega ao frontend autenticado pela RPC `get_my_account_identity`; ele não é persistido novamente no perfil público.
- O login da conta é feito por e-mail. O `@username` é exclusivamente público/IC, eliminando um resolvedor anônimo que poderia expor a associação entre handle e e-mail privado.
- `x_handle`/`x_username` foram mantidos como identificadores próprios da Rede X nesta versão para preservar posts, seguidores e URLs existentes; nenhuma unificação destrutiva foi feita.

## 4. Campos e tabelas alterados

### Nova tabela privada

`private.account_identities`:

- `user_id`, `real_full_name`, `real_date_of_birth`, `email`, `phone`, `phone_country_code`, timestamps.

### Novos campos em `profiles`

- `citizen_id`, `character_bio`;
- origem: país, UF, código IBGE e nome do município;
- residência: país, UF, código IBGE e nome do município;
- `initial_aspiration`;
- `onboarding_step`, `onboarding_version`, `onboarding_mode`, `onboarding_updated_at`;
- `citizenship_created_at`, `citizen_profile_confirmed_at`, `username_is_generated`.

### Novos objetos públicos

- View segura `public_citizen_profiles`, contendo apenas dados IC de cidadãos concluídos.
- Tabela `citizen_lifecycle_events`, com deduplicação e leitura pelo titular ou Admin.
- Configuração `system_settings.citizen_onboarding`, que preserva o saldo inicial já adotado e deixa idade/versão administráveis.

## 5. Migrations

- `supabase/migrations/20260817120000_citizen_identity_onboarding_v2.sql` concentra a separação OOC/IC, backfill, constraints, índices, RPCs, permissões, trigger de Auth e fluxo legado.
- A migration migra dados OOC de Auth/perfil para o schema privado e então limpa `profiles.email` e `profiles.phone`.
- Valores antigos não são inventados: o nome atual é preservado como IC e, quando necessário, também copiado como candidato OOC; o usuário legado precisa confirmar o personagem.
- CPF, RG, Título e CTD antigos são copiados para `documents` somente quando não existe documento válido equivalente.
- Índices parciais garantem número único para documentos válidos e uma única conta por usuário.

## 6. RPCs

- Conta: `get_my_account_identity`, `update_my_account_identity`.
- Estado: `get_my_citizen_onboarding`, `start_citizen_onboarding`.
- Personagem: `save_citizen_identity`, `save_citizen_origin`, `save_citizen_aspiration`, `update_my_citizen_profile`.
- Emissão: `issue_citizen_onboarding_document` e wrapper compatível `issue_onboarding_document`.
- Banco: `ensure_citizen_bank_account` e wrapper compatível `create_bank_account`.
- Conclusão: `finalize_citizen_onboarding`.
- Administração: `admin_get_all_users`, `admin_update_citizen_identity`, `admin_reset_citizen_onboarding`.
- Geradores internos de CPF/documentos não possuem `EXECUTE` para o cliente.

## 7. RLS e segurança

- Schema e tabela OOC não concedem acesso direto a usuários comuns.
- A view pública omite nome real, e-mail, telefone e metadados de autenticação.
- A leitura da tabela base só publica cidadãos concluídos; titular e Admin mantêm acesso autorizado. Assim, o `full_name` legado ambíguo não fica público antes de ser confirmado como nome do personagem.
- Inserção/alteração/exclusão direta de `documents` foi revogada para `anon` e `authenticated`.
- Inserção direta em `profiles` foi revogada; o trigger de Auth é a origem do perfil inicial.
- Trigger protege campos oficiais: identidade civil, documentos, origem, residência, onboarding, cidadania, filiação, reputação e pontos políticos.
- Conclusão, emissão e abertura de conta usam funções `SECURITY DEFINER`, validação de `auth.uid()` e locks transacionais.
- O reset Admin é auditado e não invalida documentos nem apaga conta, saldo, partido, cargo ou histórico.

## 8. Alterações no Auth

- Cadastro tradicional envia apenas metadados OOC: nome real, nascimento real e telefone.
- O trigger cria um username técnico temporário, deixa identidade IC vazia e inicia `welcome`/v2.
- Google, Facebook e Discord criam somente a conta; dados OOC obrigatórios ausentes são solicitados na primeira tela do Registro Nacional.
- `AuthContext` anexa a identidade privada apenas ao objeto em memória do próprio usuário.
- Login por e-mail separa autenticação OOC do username público do cidadão.

## 9. Alterações no onboarding

- Rota protegida em tela cheia: `/registro-cidadania`.
- Guard global bloqueia serviços enquanto `onboarding_completed = false`, com exceções para logout, suporte, termos, privacidade, configurações básicas e Admin.
- Etapas persistidas: boas-vindas, identidade, origem, perfil, documentos civis, documentos obrigatórios, situação inicial e cidadania.
- Origem e residência são separadas e usam municípios oficiais obtidos da API do IBGE, com cache local e códigos estruturados.
- Aspiração personaliza tutorial e dashboard, sem classe, atributo, dinheiro, cargo ou bloqueio de conteúdo.
- A cerimônia usa horário do servidor e mostra avatar, identidade, residência e quatro documentos.
- Erros preservam o progresso; botões ficam bloqueados durante RPC; reload retoma a etapa gravada.
- O guard prisional permite a rota de cidadania, evitando loop para usuários legados com pena ativa.

## 10. Alterações em documentos

- CPF/RG deixaram o cadastro e são emitidos no backend durante o Registro Nacional.
- CPF, RG, Título e CTD usam o mesmo fluxo idempotente e a mesma tabela `documents`.
- Locks por usuário/tipo evitam emissão dupla em cliques concorrentes.
- Os documentos são exibidos com o componente do DIC e também sincronizados nos campos legados de `profiles`.
- DIC e perfil do cidadão deixaram de mostrar e-mail/telefone OOC.

## 11. Tratamento de usuários antigos

- Todos entram em `legacy_migration`, com campos IC existentes pré-preenchidos.
- Documentos, conta bancária, saldo, transações, partido, cargos, Rede X, Justiça e histórico permanecem intactos.
- Documentos e conta já existentes são reconhecidos; as funções não geram duplicatas.
- São solicitados apenas confirmação da identidade e os novos dados ausentes, principalmente município estruturado e aspiração.
- Admin pode corrigir identidade/etapa ou reiniciar o fluxo sem apagar ativos institucionais.

## 12. Testes realizados

- Migration completa executada contra o esquema real dentro de `BEGIN/ROLLBACK`.
- Smoke test transacional com usuário sintético criado pelo trigger de Auth.
- Verificados: separação real/IC, perfil público sem e-mail/telefone, identidade/origem/aspiração, CPF duplicado, quatro documentos, conta duplicada, transação de saldo inicial, conclusão duplicada, timestamp e evento de cidadania.
- Teste transacional completo repetido após os ajustes finais de OAuth, telefone, ordem de documentos, conta e privacidade.
- `node tools/verify-citizen-onboarding.mjs`: 28 verificações de arquitetura concluídas.
- `node --check`: bibliotecas de localidades/onboarding e verificador sem erros de sintaxe.
- `git diff --check`: sem erros de whitespace.

## 13. Problemas encontrados

- O modelo anterior misturava PII real e identidade pública na mesma tabela.
- CPF/RG eram gerados no navegador.
- OAuth podia contornar os dados mínimos do onboarding.
- A conclusão antiga confiava em update do cliente.
- O reset antigo poderia invalidar documentos.
- Um resolvedor legado de username/telefone exigiria revelar o e-mail privado; foi substituído por login OOC via e-mail.
- O ambiente de trabalho não conseguiu instalar todas as dependências npm; por isso o build Vite e o lint completo não puderam ser executados localmente nesta sessão.

## 14. Pendências

- Executar `npm ci`, lint, build e a suíte E2E em um runner com acesso normal ao registry.
- Fazer QA visual real em desktop, Android e iOS, incluindo teclado, safe area, upload e conexão lenta.
- Testar OAuth real por provedor com as URLs de callback de produção.
- Definir futuramente idades mínimas por serviço/carreira; a criação do personagem apenas rejeita datas futuras ou acima de 120 anos, sem impor uma trava arbitrária geral.
- A lista de municípios depende da API oficial do IBGE no primeiro carregamento de cada UF; considerar espelho/versionamento local para operação totalmente offline.
- Planejar comunicação aos 161 perfis existentes antes de ativar o guard de migração.

## 15. Melhorias adicionais

- Criar testes E2E automatizados para interrupção/reload em cada etapa e concorrência real de RPC.
- Adicionar painel Admin de métricas do funil por etapa/versão e alerta de onboarding travado.
- Versionar um catálogo local oficial de municípios e validar código+nome contra tabela de referência no backend.
- Evoluir `citizen_lifecycle_events` para uma timeline unificada do cidadão no Dashboard.
- Criar procedimento institucional futuro para mudança de nome civil e correção documental, sem liberar edição direta.
- Adicionar rotinas de retenção/minimização LGPD e trilha específica de acesso administrativo a dados OOC.
