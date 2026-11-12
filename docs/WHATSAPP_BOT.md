# GOVRP Bot 1.0 — Whatsmeow / Oracle Cloud

Bot de WhatsApp para **https://govrp.vercel.app** com comandos, notícias, votações, eleições e comunicados. Usa o Supabase do GOVRP, mas roda continuamente na Oracle VPS. O Whatsmeow é uma biblioteca **não oficial**, com risco de desconexão e restrições da conta.

## O que já está integrado

- Painel **Administração → WhatsApp Bot**: conexão/QR, ligar/desligar, grupos e tipos de aviso, anúncios manuais, fila e logs.
- Grupos descobertos automaticamente depois de conectar o número; **desativados por padrão**.
- Eventos automáticos no Supabase (sem varrer tabelas de dados): publicação de notícias, agendamento e início/fim de votações, fases de eleições, decretos e promulgação de leis.
- Comandos: !ajuda, !noticias, !economia, !governo, !partidos, !eleicoes, !votacoes, !leis e !perfil.
- Vinculação da conta em **Configurações → WhatsApp**, com código aleatório de 12 caracteres, único, válido por 10 minutos. Enviar \`!vincular CÓDIGO\` **no privado** do bot. Para desvincular, utilize a seção WhatsApp em **Configurações** do GOVRP.
- Antispam (5 segundos por remetente), fila idempotente (máximo 3 tentativas e intervalo de reenvio), série de envios espaçada por 2 segundos, nenhuma resposta em grupos não autorizados.
- Os comandos de consulta funcionam **exclusivamente nos grupos autorizados no painel admin**. No privado, o único comando aceito é \`!vincular CÓDIGO\`; todos os demais são ignorados silenciosamente. O desligamento global desativa ambos.
- O serviço não abre portas de entrada. A comunicação é feita por conexões de saída TLS; o QR aparece apenas em uma tabela que só administradores conseguem consultar.

## O que o proprietário precisa fazer

**1. Criar a VM Oracle Always Free.** Criar uma instância Ampere A1 ARM64 com Ubuntu Server (sugestão inicial 1 OCPU / 2 GB). O limite gratuito depende da região, da disponibilidade de capacidade e das cotas da conta. É necessária uma conta Oracle ativa.

**2. Preparar a VM.** Instalar Docker Engine com Docker Compose v2 usando as instruções oficiais de https://docs.docker.com/engine/install/ubuntu/. Manter somente SSH liberado na entrada, configurar atualizações de segurança, fazer backup do volume \`govrp_bot_session\` e restringir o acesso SSH. O bot só realiza conexões externas.

**3. Obter o código.**

    git clone https://github.com/RDG547/GOVRP.git
    cd GOVRP/services/whatsapp-bot
    cp .env.example .env

**4. Configurar o arquivo .env na VM**, sem compartilhar chaves em conversas, GitHub, navegador ou frontend. O \`SUPABASE_URL\` é a URL HTTPS do projeto GOVRP e \`SUPABASE_SERVICE_ROLE_KEY\` é a chave de serviço do mesmo projeto. A chave de serviço ignora RLS e **nunca** deve ficar no Vercel client, commit, mensagem de WhatsApp ou página pública.

**5. Iniciar o serviço:**

    docker compose up -d --build
    docker compose logs --tail=80 -f

**6. Vincular o número.** Entre no GOVRP com a conta Admin e abra:

    https://govrp.vercel.app/admin-dashboard/whatsapp

Inicie o contêiner e atualize o painel. Se o número nunca tiver sido pareado, um QR temporário aparecerá. Num **número exclusivo para o bot**, entre em WhatsApp → Dispositivos conectados → Conectar dispositivo e escaneie o QR. A sessão fica no volume privado do Docker (SQLite); após reiniciar, não precisa escanear novamente enquanto a sessão continuar válida.

**7. Autorizar grupos.** Adicione o número do bot como membro de cada grupo autorizado. O serviço tenta descobrir os grupos existentes após conectar; para grupos recém-adicionados, envie uma mensagem normal no grupo e clique Atualizar no admin. Escolha as categorias que devem ser notificadas, marque **Autorizado**, salve cada grupo e só então ative o bot nas Configurações Gerais.

**8. Testar.** No grupo autorizado, envie \`!ajuda\`, \`!noticias\` e \`!economia\`. Publique uma notícia de teste no GOVRP; verifique a fila e as entregas no admin. Desative os avisos de testes, antes de liberar para grupos maiores.

## Operação e custos

### Deploy automático na Oracle

Em produção, o workflow **GOVRP WhatsApp Bot** valida as alterações da pasta `services/whatsapp-bot/` e do próprio workflow. Pull requests para `main` executam a validação. O deploy só executa depois da validação, em um push à `main` ou em uma execução manual selecionando `main`.

Na aba **Actions → GOVRP WhatsApp Bot**, abra a execução para conferir o commit, a hora e o resultado. Para implantar manualmente, selecione **Run workflow → main → Run workflow**. Se o mesmo commit já estiver saudável, a execução registra isso sem reiniciar o serviço.

O GitHub usa o ambiente `oracle-production`, restrito à branch `main`. O ambiente contém o segredo `GOVRP_ORACLE_DEPLOY_KEY` e as variáveis `GOVRP_ORACLE_SSH_HOST` e `GOVRP_ORACLE_KNOWN_HOSTS`. A variável de host contém o endereço da VPS. A segunda contém a entrada do `known_hosts`, verificada contra a chave pública do servidor por um acesso administrativo existente. O GitHub só acessa a conta `govrp-deploy`, que aceita `verify` ou `deploy <commit>` por comando forçado. Ela não pertence ao grupo Docker e só pode executar via sudo o programa de deploy, sem argumentos de linha de comando.

Na VPS, o programa verifica o commit contra `main`, arquiva o código em `/var/lib/govrp-whatsapp-deploy/releases/` e compila uma imagem identificada pelo commit antes de trocar o contêiner. A troca mantém o projeto Compose `whatsapp-bot`, o `.env` em `/opt/govrp/services/whatsapp-bot/` e o volume externo `whatsapp-bot_govrp_bot_session` em `/data`. O deploy só passa com o contêiner esperado estável e dois sinais novos no Supabase indicando WhatsApp conectado e pareado. Se a nova versão falhar após a troca, o programa restaura uma vez a imagem anterior e verifica sua saúde. O GitHub Actions registra a falha da versão nova mesmo quando a recuperação funciona.

O arquivo `/var/lib/govrp-whatsapp-deploy/current.json` indica a última versão confirmada e `deploy.log` registra o histórico de implantação. Acompanhe a execução também pelo GitHub Actions. A partir da configuração automática, use o workflow para atualizar o contêiner de produção. A seção de instalação manual se aplica a uma VPS nova. Os arquivos em `services/whatsapp-bot/deploy/` que controlam o acesso SSH e o deploy são instalados como root em `/usr/local/sbin` e em `/var/lib/govrp-whatsapp-deploy/`. Atualizações desses arquivos de controle precisam ser instaladas por um administrador da VPS antes de entrarem em uso.

- O Supabase armazena configurações, eventos e histórico de entrega; não há segundo banco remoto.
- O Whatsmeow armazena a sessão de criptografia em SQLite local, **não** no Supabase. A perda do volume exige novo pareamento.
- O bot se conecta de saída ao Supabase a cada ~20 segundos (configuração), 8 segundos (fila, apenas quando habilitado) e 25 segundos (saúde). Não faz consultas infinitas aos dados econômicos; os comandos usam RPCs com leitura pontual.
- Em uma instalação sem deploy automático, atualize com `git pull --ff-only && cd services/whatsapp-bot && docker compose up -d --build`.
- Reiniciar: \`docker compose restart\`. Ver logs: \`docker compose logs --tail=100\`.
- Se desconectar, o estado aparece no painel. Verifique a internet, o WhatsApp conectado e os logs. Em alguns casos será necessário parear novamente.
- **Não** use clientes não oficiais para spam, mensagens em massa ou automações indesejadas; há risco de restrição permanente do número.

## Segurança

**Não é permitido:** colocar service_role no navegador, expor QR no painel público, responder mensagens em grupos não autorizados, mandar credenciais por WhatsApp ou guardar mensagens de usuários.

Os RPCs de trabalho exigem a role \`service_role\`, e os de administração exigem autenticação com role Admin e bloqueiam ações simuladas. A fila mantém registro de entrega com controle de duplicação e timeout de 2 minutos. A primeira versão consulta apenas dados públicos do GOVRP, e \`!perfil\` mostra nome/usuário/cargo públicos de conta explicitamente vinculada.

## Arquivos

- \`services/whatsapp-bot/main.go\`: cliente Whatsmeow, processador, eventos, comandos, QR, segurança e logs.
- \`services/whatsapp-bot/Dockerfile\` e \`docker-compose.yml\`: execução ARM64 e persistência.
- \`supabase/migrations/20261111203000_whatsapp_bot_v1.sql\`: infraestrutura e RPCs.
- \`supabase/migrations/20261111204500_whatsapp_bot_claim_fix.sql\`: compatibilidade da fila com PostgreSQL.
- \`src/components/admin/WhatsAppBotManagement.jsx\`: painel admin.
- \`src/components/WhatsAppAccountLink.jsx\`: vinculação do usuário.

A implantação da VPS e o scan do QR precisam ser feitos pelo proprietário; não há acesso à conta Oracle ou ao telefone nesta integração.
