# Collation ICU: procedimento de manutenção (GOVRP)

**Status em 09/11/2026:** banco `postgres`, PostgreSQL 17.11,
collation padrão ICU registrada como `153.120` e versão disponível `153.121`.
Esses números são provenientes de consulta em produção. **NÃO executar
correção automática durante o tráfego de jogadores.**

O aviso de collation gera grande volume de logs, mas mudar somente a
versão registrada **não reconstrói os índices** e pode esconder risco de
resultados de consultas inconsistentes. Consulte
https://www.postgresql.org/docs/current/sql-altercollation.html

## Antes de qualquer intervenção

1. Confirmar projeto `ACTIVE_HEALTHY` e verificar último backup concluído em
   Database → Backups. Testar possibilidade de restauração.
2. Confirmar que não existem resets, eleições, faturamentos, operações bancárias
   e atualizações concorrentes sensíveis durante a manutenção.
3. Tirar um inventário de índices afetados pela collation padrão ICU e dos
   objetos que dela dependem (inclusive restrições UNIQUE). Considerar que
   dependências de collation padrão podem ser implícitas.
4. Planejar janela de manutenção e rollback com base nos índices afetados,
   tamanho de cada índice, bloqueios, sessões e atividade em produção.
5. Verificar com o suporte Supabase o procedimento suportado para o
   ambiente gerenciado, incluindo eventuais índices de sistema e extensões.
6. Reconstruir os índices afetados usando o método compatível, preferindo
   métodos concorrentes onde suportados, evitando reconstrução global
   bloqueante durante a operação.
7. Validar integridade, índices, consultas textuais, unicidade e desempenho
   antes de registrar a nova versão com:
   `ALTER DATABASE postgres REFRESH COLLATION VERSION;`
8. Verificar que a versão registrada corresponde à real e que os avisos cessaram.

## Consulta de diagnóstico (somente leitura)

```sql
SELECT d.datname,
       d.datcollversion AS recorded,
       pg_database_collation_actual_version(d.oid) AS actual,
       d.datlocprovider
FROM pg_database AS d
WHERE d.datname = current_database();
```

**Não executar** `REINDEX DATABASE postgres` automaticamente: a instrução
pode bloquear operações e interferir no GOVRP. Uma divergência na collation
não autoriza apagar dados, flexibilizar RLS ou alterar tabelas de finanças.

Após eventual upgrade do PostgreSQL 17.11, a documentação Supabase também
recomenda verificar especificamente índices `ltree`:
https://supabase.com/docs/guides/platform/upgrading
Na inspeção de 09/11/2026 não havia colunas `ltree` no projeto.
