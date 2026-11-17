# GOVRP — Changelog de 17/11/2026

## Portal Eleitoral
- A aprovação de candidaturas pelo administrador ou autoridade eleitoral pode ser confirmada **sem fundamentação**.
- A justificativa passa a ser **opcional ao aprovar** e permanece obrigatória ao indeferir (mínimo de 20 caracteres).
- Permanecem as proteções de período eleitoral, impedimento de julgamento da própria candidatura e integridade da votação.

## Parlamento — Comissões mistas
- Nova modalidade **Comissão Mista**, diferente de CPMI, com participação da Câmara dos Deputados e do Senado.
- A instalação exige aprovação expressa da presidência/mesa de cada Casa; uma única Casa não instala a comissão sozinha.
- Após ambas as aprovações, a comissão fica ativa para composição parlamentar e relatórios.
- CPMI e comissões tradicionais conservam seus procedimentos originais.

## Partidos — Orientação de voto
- A direção de um partido ativo pode sugerir **a favor**, **contra**, **abstenção** ou **voto liberado** em um PL/PEC em tramitação/votação.
- Justificativa política opcional, limite de 2.500 caracteres.
- Orientações publicadas no gerenciamento partidário e junto aos projetos/votações dos parlamentares filiados.
- **Orientação não é voto:** nenhum voto é registrado automaticamente e os parlamentares podem divergir sem bloqueio.

## Responsividade
- **Ranking das Maiores Empresas:** cartões com altura dinâmica, nomes e valores quebrando corretamente, logo e posição alinhados e layout fluido em telas estreitas.
- **X no celular interno:** publicações, fotos e vídeos respeitam a largura útil; imagem usa proporção adequada e os botões ficam numa grade de quatro colunas, sem sobreposição entre posts.
- Ajustado o viewport do aplicativo embutido para evitar rolagem horizontal e extrapolação da moldura.

## Economia e população fictícia
- Mantida e verificada a simulação diária de demanda da população fictícia nas compras de empresas do RP, com estoque, saldo e operação idempotente.
- Compras do **Mercado Nacional** passaram a usar a cotação de tributos oficiais em vigor, tal como operações de consumo regulares, com transferência da parcela tributária para o Tesouro e registro de arrecadação.
- Continuidade da integração entre poder de compra, preços, estoque, demanda, saldo empresarial, orçamento e arrecadação. Não foram criados saldos fictícios gratuitos.
- Cada execução diária permanece registrada para não duplicar compras.

## Observações de integridade
- A orientação partidária **não pode alterar votos** registrados nem contornar a apuração.
- Comissões mistas **não alteram** CPIs/CPMIs ou resultados parlamentares anteriores.
- Histórico de aprovações e indeferimentos eleitorais mantém auditoria.
