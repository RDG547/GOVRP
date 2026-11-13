# GOVRP — banimentos administrativos por conta e identificadores (2026-11-13)

## Situação técnica

O gerenciamento de usuários possui ação de **banir / revogar banimento**, com motivo obrigatório, histórico e escopos individuais para e-mail, username, nome civil do personagem, IPs registrados e identificadores de instalações de navegador.

**O que é seguro prometer:**
- O banimento da conta usa a API administrativa Supabase Auth (\`ban_duration\`) e barra novos logins de maneira nativa.
- O e-mail é bloqueado também por trigger em \`auth.users\`; e-mail e IP de novos cadastros são barrados pelo hook oficial **Before User Created** (precisa ser ativado no Dashboard).
- Nomes de usuário e cidadão são verificáveis no momento em que são definidos no cadastro do personagem, porque o cadastro inicial do Auth só possui e-mail e dados reais da conta.
- A aplicação registra um identificador aleatório por **instalação de navegador**, via cookie essencial \`HttpOnly\` / \`Secure\` e salva somente o hash SHA-256 no Supabase. Histórico preexistente não identifica aparelhos retroativamente.
- Usuários em IPs compartilhados podem receber bloqueio injusto. O painel permite desativar IPs e navegadores individualmente e registrar a justificativa.
- **Não é possível identificar ou bloquear hardware físico de forma confiável em um site web.** Limpar dados do navegador, usar outro navegador, outra conexão ou VPN pode contornar um identificador.
- **Senhas nunca são comparadas ou armazenadas como identificador de banimento.** Hashes de senha são específicos da conta e devem continuar protegidos.
- Quem já tinha sessão ativa pode manter o token por um curto período; o frontend verifica restrições periodicamente, além da limitação de autenticação na API.

## Etapa obrigatória no Supabase Dashboard

**Esta etapa não pode ser ativada apenas com SQL:** Supabase Dashboard → Authentication → Hooks → **Before User Created** → Postgres Function → selecionar \`public.govrp_before_user_created_hook\` → Enable / Save. Em seguida, verificar com um e-mail/IP de teste controlado, sem cadastrar usuários reais desnecessariamente.

A função do hook foi testada em transação de rollback e só consulta banimentos ativos. É essencial para que cadastro via OAuth ou chamada direta à API Supabase também seja verificado por IP. Sem ativar o hook, a verificação de IP/navegador no formulário GOVRP pode ser contornada por chamadas diretas ao Auth; o bloqueio de e-mail continua protegido pelo trigger em \`auth.users\`.

## Uso no painel

1. Abra **Administração → Usuários**, localize a conta e clique no ícone de escudo.
2. Leia os identificadores existentes. IPs são derivados de sessões Auth e acessos registrados pelo site. Navegadores passam a ser reconhecidos apenas após autenticações realizadas depois desta atualização.
3. Escolha os escopos, informe uma razão de no mínimo 10 caracteres e aplique o banimento.
4. O status será mostrado como **Banido**, e a conta será suspensa no Supabase Auth.
5. Para reverter, abra o escudo novamente e use **Revogar banimento**. O histórico permanece consultável.

Banimento OOC não apaga registro de personagem, votos, mandatos ou ações históricas do RP. Administradores não podem banir a própria conta nem outras contas administradoras por este fluxo.

## Fluxos

- \`POST /api/auth/access\` com \`{action:"preflight",email}\` verifica IP/navegador/e-mail antes do cadastro ou login. Não recebe nem deve receber senha.
- \`POST /api/auth/access\` com \`{action:"attest"}\` e bearer token autentica, registra IP/navegador associado ao usuário e recusa acesso banido. Chamado na hidratação de sessão e periodicamente.
- \`POST /api/admin/ban-user\` exige bearer token de admin real, respeita pré-visualização, verifica a conta e aplica/remova restrições e o bloqueio do Supabase Auth.
- \`public.govrp_admin_ban_context\` e \`public.govrp_admin_list_bans\` mostram dados somente a admins. Tabelas reais estão em schema \`private\`, sem acesso às roles \`anon\` e \`authenticated\`.

## Privacidade, atendimento e limitações

- Retenha os dados apenas pelo tempo necessário às finalidades de moderação. Reavalie registros antigos e permita solicitações de exclusão, correção e revisão conforme a LGPD e as políticas do GOVRP.
- O motivo administrativo privado é acessível ao administrador e ao proprietário autenticado da conta; cadastros bloqueados por IP ou dispositivo compartilhado recebem mensagem genérica para não revelar sanções de terceiros.
- Identificadores são sinais de abuso, não prova conclusiva de identidade. Ofereça revisão do CDA e alternativa para usuários que compartilham rede ou equipamento.
- Nunca aplique bans com base em user-agent isolado, comparação de senha, fingerprint oculto ou estimativas de localização.
- Quando o hook for ativado, teste cadastro com e-mail permitido, cadastro por provedor social permitido, cadastro bloqueado por e-mail e cadastro bloqueado por IP. Configure alerta para aumento inesperado em erros de signup.

## Validações realizadas

- Migração SQL validada usando \`BEGIN\` / \`ROLLBACK\` no banco GOVRP, sem alterar contas.
- Verificações transacionais de correspondências por e-mail, username, nome de cidadão, IP e browser hash.
- Teste direto de aceitação/rejeição do hook e API RPC de preflight.
- A compilação Vercel e os testes de frontend devem passar antes da publicação definitiva.
