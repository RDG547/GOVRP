# GOV.RP — roteiro de aplicação da reforma econômica

23/11/2026. **Não executado em produção.** O pacote é uma proposta verificável, não uma atualização já instalada. As pendências econômicas/integração estão no changelog.

## Homologação

1. Usar base `936ba5dd65f38e32e6d536cf16ca39eb74e689df` ou reconciliar mudanças posteriores. Instalar dependências pelo lockfile. No pacote, aplicar o patch dos arquivos existentes e copiar os novos preservando caminhos; alternativamente revisar os arquivos completos incluídos.
2. Obter projeto Supabase isolado com schema completo e dados de teste sem dados pessoais. Conferir migrations existentes. Não usar reset/seed destrutivo/scripts de teste no projeto Roleplay.
3. Aplicar **somente as 16 migrations estruturais novas**, em ordem de nome. Não reaplicar migrations antigas. Cada arquivo usa transação; investigar qualquer falha antes de continuar.
4. Rodar suites estruturais, concorrência, carga e cenários prolongados. Os scripts locais criam bancos descartáveis próprios; não são instaladores para Supabase.
5. Auditar `SECURITY DEFINER`, ACL/RLS, Realtime e jobs com schema completo. Testar público, cidadão, dono e administrador, duas sessões, logout/troca de usuário, falha/reconexão de rede e atualização dos painéis.
6. Ensaiar meses/trimestres/ano, atrasos e revisões; comparar capturas/ledger. Conferir transição ao próximo período completo sem reescrita histórica.
7. Aprovar sustentabilidade econômica. Os ensaios de 56 dias incluídos apresentam perdas/salários pendentes e não satisfazem sozinhos a aceitação integral.

## Produção, depois da aceitação em homologação

1. Backup/snapshot e registro de versão, parâmetros, saldos, estoque, dívida e períodos. Conferir jobs/janela com a administração.
2. Aplicar as 16 novas migrations em ordem e conferir histórico/sucesso. Não modificar leis, preços manuais ou saldos para fazer a implantação passar.
3. Publicar frontend da mesma revisão. `prebuild` regenera catálogo de modais; arquivos gerados não foram incluídos como alteração manual da reforma.
4. Conferir RPCs, painéis, permissões, Realtime, saldos/estoques, duplicidades, fila de revisão e erros. Registrar indicadores posteriores no mesmo recorte da linha de base.
5. Piloto NPC inicialmente desativado. Administrador pode ativar no painel, com justificativa, após aceitar resultados. Acompanhar primeiras entradas/ciclos sem forçar repetição de pagamentos.
6. Programa financeiro somente com decisão administrativa/orçamentária válida, referência, prazo e tetos. Não é requisito automático de instalação; não cria dinheiro ou dívida para cobrir insuficiência.
7. Recuperação histórica: abrir prévia, elaborar plano com insumos verificáveis e efeitos nos períodos seguintes, obter aprovação específica. O pacote não aplica correção histórica.

## Interrupção

Não executar migrations reversas improvisadas nem apagar transações. Em falha do piloto, desativar novas entradas e encerrar pagamentos futuros do programa, quando existente; isso não apaga empresas/passivos. Preservar evidências e preparar correção incremental. Rollback de frontend/restauração de banco dependem da compatibilidade e do plano de recuperação. Não há rollback destrutivo automático.

## Verificação local

Node/npm e PostgreSQL isolado, com permissão para criar bancos descartáveis. **Nunca configurar conexão de produção.**

```sh
npm ci
# GOVRP_TEST_DATABASE_URL: PostgreSQL local isolado.
npm run test:structural-economy
npm run test:structural-concurrency
npm run test:structural-load
# GOVRP_TEST_SCENARIO=diversified; GOVRP_TEST_CIRCULATION=true;
# GOVRP_TEST_DAYS=56; GOVRP_TEST_RESULTS_PATH=caminho-do-resultado.json
npm run test:structural-long-run
node tools/test-economy-live-integrity.mjs
node tools/test-company-national-market-balance.mjs
npm run build
```

Sem conexão configurada, algumas suites usam PGlite; concorrência requer PostgreSQL nativo. CI preparada usa PostgreSQL 17.12 e ensaio de 28 dias. Testes locais não substituem a homologação Supabase de sessões/autorização/Realtime.
