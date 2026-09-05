# Changelog do GOV.RP

## 5 de setembro de 2026

- Administração ganhou reset individual, de cidadãos selecionados, de todos os cidadãos e do RP completo.
- Cada reset exige motivo, prévia e confirmação escrita; o histórico registra responsável e alcance.
- Cidadãos resetados recriam identidade, documentos e conta bancária, mantendo o login e os dados privados da conta.
- Reset completo limpa a temporada e reinicia os países ativos a partir dos indicadores reais, preservando a evolução posterior pelo RP.
- Operações de reset são atômicas e não duplicam o efeito em uma tentativa repetida.

## 30 de agosto de 2026

- Eleições, votações parlamentares e posses ficaram mais seguras e passam a respeitar resultados reais.
- Justiça agora acompanha todo o caso, da ocorrência até sentença, recurso e soltura.
- Leis sancionadas produzem efeitos reais sobre regras, indicadores, popularidade e Diário Oficial.
- Empresas, compras, impostos, estoque, Tesouro e histórico financeiro foram integrados.
- Acontecimentos nacionais, grupos da população, imprensa e câmbio passam a evoluir em conjunto.
- Cadastro cidadão, avatares, Constituição, objetivos, documentos e seletores de usuário foram aprimorados.
- Corrigidos os contadores públicos, o total de transações, a busca administrativa de usuários e a exibição de documentos do DIC.
- Faturas ganharam paginação e alternância entre Visa e Mastercard; decisões bancárias agora aparecem em tempo real.
- Changelog completo para jogadores: `docs/CHANGELOG_JOGADORES_2026-08-30.md`.

## 26 de agosto de 2026

- Nova Central de Suporte com protocolos, acompanhamento e conversa dentro do GOV.RP.
- Câmbio ampliado para seis moedas, com variação diária, histórico e cotações ligadas à economia do país.
- Objetivos do cidadão, grupos da população e acontecimentos nacionais passam a integrar a evolução do RP.
- Página do País renovada, Constituição com leitura completa e histórico parlamentar enriquecido.
- Notícias, faturas, documentos, ícones, seletores de usuário, contadores públicos e administração receberam correções e melhorias.
- Changelog completo para jogadores: `docs/CHANGELOG_JOGADORES_2026-08-26.md`.

## 17 de agosto de 2026

### Conta, personagem e cidadania

- Conta real (OOC), personagem (IC) e cidadania institucional agora possuem responsabilidades e dados separados.
- Nome, nascimento, e-mail e telefone reais foram isolados em estrutura privada e deixaram de ser publicados no perfil do cidadão.
- Cadastro passou a criar somente a conta; CPF, RG e username público são definidos no Registro Nacional de Cidadania.
- Nova rota imersiva `/registro-cidadania`, com sete etapas persistentes, retomada após reload e cerimônia de concessão.
- Google, Facebook e Discord também seguem o onboarding e precisam completar dados privados mínimos.
- Origem e residência usam UF, município e código IBGE separados.
- CPF, RG, Título de Eleitor e CTD são emitidos no backend, de forma única e idempotente, usando o DIC existente.
- Conta bancária é criada ou preservada sem duplicidade; o saldo inicial vem da configuração econômica e gera transação de origem.
- Conclusão do onboarding passou a ser validada exclusivamente no backend.
- Tutorial, Dashboard, Configurações e Admin foram adaptados à aspiração e à separação OOC/IC.
- Migração legada preserva documentos, saldo, partido, cargos, Rede X, Justiça e histórico.
- RLS, grants e triggers foram reforçados para proteger dados reais e campos oficiais do cidadão.

### Interface, estabilidade e experiência

- Corrigidas notificações duplicadas e a tela escura que podia permanecer após login ou restauração de sessão.
- Textos visíveis foram revisados para PT-BR e atos oficiais passaram a exibir data e hora completas.
- Parlamento ganhou histórico cronológico da tramitação e abas adaptadas para celulares.
- PDFs do DIC receberam correções para nomes, datas e caracteres acentuados que apareciam cortados.
- Modais e tabs do Painel de Administração foram refinados para telas pequenas, com nomes completos e cabeçalho estável.
- Câmbio ganhou gráfico histórico e a Home passou a exibir as três notícias mais recentes em carrossel.
- Gestão Bancária foi separada entre cartões e empréstimos, com paginação, atualizações dinâmicas e preservação do scroll.
- Changelog completo para jogadores: `docs/CHANGELOG_JOGADORES_2026-08-17.md`.

## 15 de agosto de 2026

### Governo e simulação nacional

- Nova popularidade nacional baseada em acontecimentos do jogo, com peso igual entre a participação dos jogadores e a simulação do país.
- Histórico de variações e gráficos para acompanhar a evolução de indicadores nacionais.
- Ministérios agora podem ser criados, editados, desativados e ter atribuições e orçamentos próprios.
- Ministros passaram a ter reputação, desempenho e histórico de nomeações, exonerações e acontecimentos.
- Portal de imprensa ampliado com veículos governistas, de oposição, neutros e sensacionalistas, cada um com enquadramento editorial próprio.
- Publicidade institucional agora registra finalidade, custo e risco de favorecimento.
- Casos de integridade pública seguem etapas separadas: suspeita, investigação, processo e decisão.

### Parlamento e partidos

- Projetos agora respeitam automaticamente a Casa do mandato: Deputados usam a Câmara e Senadores usam o Senado.
- Sugestões cidadãs podem ser direcionadas a uma Casa, parlamentar ou partido, com notificações aos destinatários corretos.
- Sugestões aprovadas são convertidas em projetos com registro de quem as adotou.
- Histórico de Projetos ampliado para mostrar a tramitação relevante ao cidadão.
- Eleições internas e mandatos das presidências da Câmara e do Senado foram preservados e integrados ao Diário Oficial.
- Hierarquia partidária revisada para Dono, Presidente, Vice-Presidente e Membro, respeitando os limites de cada cargo.
- O fundador do partido permanece como registro histórico mesmo após transferência de propriedade ou desfiliação.

### Segurança, Justiça e prisão

- Nova central cidadã para registrar e acompanhar ocorrências, inclusive denúncias anônimas.
- Consulta segura de mandados em nome do próprio cidadão e de investigações que possam ser legalmente reveladas.
- Pedidos formais de investigação e liberação de bens agora possuem protocolo, triagem, decisão e histórico.
- Atestado de antecedentes passou a ser emitido como documento oficial no DIC.
- Lista pública de procurados considera apenas mandados válidos e ativos.
- Estatísticas policiais agora são calculadas a partir de ocorrências e investigações reais do RP.
- Campanhas de direitos, deveres, prevenção e segurança podem ser administradas pelas autoridades.
- Multas receberam número amigável e permanente, detalhes, pontos, pagamento bancário, comprovante, recurso e audiência.
- Pagamentos de multa são protegidos contra duplicidade e saldo insuficiente.
- Contagem e situação das penas agora usam o horário oficial do servidor e voltam a refletir corretamente penas futuras, ativas e encerradas.
- Atividades de estudo, leitura e trabalho na prisão mantêm registro do motivo, regra aplicada e impacto na pena.

### Economia, banco e comércio

- Investimentos agora formam um portfólio real com quantidade, preço médio, preço atual, valor de mercado, lucro/prejuízo e rentabilidade.
- Compra e venda de ativos possuem histórico, gráfico patrimonial e proteção contra cliques duplicados, saldo negativo e venda acima da posição.
- Produtos de empresas exibem nome fantasia e CNPJ do vendedor.
- Comprovantes preservam o local da compra e uma fotografia histórica dos dados do vendedor.
- Doações por cartão e PIX ganharam confirmação segura, acompanhamento, tratamento de cancelamento/erro e proteção contra cobrança duplicada.

### Conta, documentos e experiência

- hCaptcha integrado ao login e ao cadastro, com suporte a expiração, erro, acessibilidade e telas menores.
- Primeiro acesso obrigatório agora salva o progresso, confirma Brasil e estado e orienta a emissão do Título de Eleitor e da Carteira de Trabalho.
- Seleção do Brasil ganhou representação territorial com a bandeira nacional.
- Administradores podem reiniciar o primeiro acesso em casos excepcionais.
- PDFs do DIC foram corrigidos para impedir cortes em textos, nomes longos, acentos e documentos com várias páginas.
- O selo dos documentos agora utiliza a identidade visual oficial do GOV.RP.
- Decretos presidenciais mostram data, hora, minuto e segundo oficiais da publicação.
- Documentação interna ampliada para Parlamento, Eleições, Notícias, Diário Oficial, Economia, Empreendedorismo, Segurança/Justiça e Prisão.
- Navegação e telas novas seguem o visual responsivo da plataforma e recebem atualizações sem recarregar a página.
