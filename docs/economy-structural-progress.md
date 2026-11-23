# Reforma estrutural — situação por ordem do prompt

Atualizado em 23/11/2026. Base: `936ba5dd65f38e32e6d536cf16ca39eb74e689df`. Consulte [changelog completo](economy-structural-changelog.md) e [aplicação](economy-structural-deployment.md).

**Implementação testada em ambiente isolado; não aplicada em produção. Aceitação integral ainda pendente.**

| Item | Implementado/verificado | Ainda falta |
| --- | --- | --- |
| 1. Integração | Backend incremental e painéis existentes. | Homologação integrada, aceitação econômica e aplicação. |
| 2. Investigação/preservação | Código/Supabase reais consultados; saldos, leis e históricos preservados. | Conferência final do ambiente de implantação. |
| 3. Tempo | UTC, completude, capturas, idempotência, fila, competência RP, transição e prévia histórica. | Plano/aprovação para recuperar períodos antigos. |
| 4. NPCs | Capital finito, reserva, CNPJ, pessoal, operação/saída, limites e controle auditado. Piloto desativado. | Aceitar/ativar piloto e comprovar sustentabilidade de cadeias. |
| 5. Abastecimento | Diagnóstico, estoque livre, reservas, locks, fornecedores e produção adaptativa. | Recuperação persistente de todas as cadeias essenciais. |
| 6. Consumo | Categorias, carteira finita, salários, lucros e programa autorizado limitado. | Distribuição regional/renda e circulação real suficiente. |
| 7. Mercado | Orçamento/estoque reais, consumo parcial, tributos e preços manuais preservados. | Reposição e revenda sustentável sob decisões vigentes. |
| 8. Viabilidade | 68 tipos, custos/tributos, sugestão limitada por setor e interface. | Demanda e margem efetiva; potencial não garante lucro. |
| 9. Fiscal | Modelo nacional separado do banco, histórico, capturas, dívida/ativos e conciliação. | Cobertura fiscal e investimento público operacional detalhado. |
| 10. Política | Alíquotas/poderes preservados; novos controles administrativos auditados. | Cenários integrados de decisões e permissões reais. |
| 11. Indicadores | População, preços no tempo, CPI comparável, desemprego, ciclos persistentes e unidade monetária coerente. | Preços transacionais normalizados, composição nacional e validação cambial. |
| 12. Frontend | Admin/governo/público/empresa/mercado; visual desktop/mobile verificado. | Sessões reais e deploy. |
| 13. Realtime | Transporte compartilhado, publicação, reconexão/erro; 21 verificações simuladas. | Duas sessões reais Supabase com RLS e reconexão. |
| 14. Integridade | Conservação, idempotência, proteção RPC, RLS privado e 20 conexões concorrentes. | Schema/triggers/Auth completos e auditoria pós-aplicação. |
| 15. A–J | 0/5/30 humanos por 56 dias, confiança baixa/alta, escassez, períodos e 50 mil eventos. | A–F: sustentabilidade incompleta; H: sessões reais; J: carga integral. |
| 16. Aceitação | Resultados/limites explicitados; nenhuma alegação de produção atualizada. | Resolver pendências antes de declarar conclusão integral. |
| 17. Entrega | Changelog acumulado, inventário, evidências e roteiro de aplicação. | Evidências posteriores de produção ainda inexistentes. |
