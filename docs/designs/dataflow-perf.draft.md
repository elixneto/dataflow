# dataflow.perf: cenários de performance do engine

*   **Author:** Élix Neto
*   **Status:** Draft
*   **Date:** 2026-11-05

--------------------------------------------------------------------------------

## Overview

`dataflow.perf` é um pacote do monorepo que roda cenários de performance do engine do dataflow com `bun run perf`. Cada cenário é um ou mais flows em JSON, com dados gerados de forma determinística, executados pelo `flowRunner` do core num processo Bun novo, contra MongoDB, SQL Server e uma API HTTP fake que ficam em containers próprios com limite de CPU e RAM. O relatório sai em texto no terminal: para cada run, os números de tempo, memória, CPU e envelopes por segundo contra as réguas do cenário. Os resultados ficam num arquivo local, fora do git.

O pacote nunca vai para o deploy do app e não toca no server, no Postgres nem nas portas que o editor usa. Quem clona o repositório tem tudo para rodar.

## The Problem

Não há hoje um jeito de ver como o engine se comporta com volume e lentidão. Os testes automáticos usam poucos envelopes e respondem na hora, e um flow real contra um banco de verdade só mostra um problema quando ele já está na frente do usuário. Um commit que dobra o uso de memória do Mapper ou deixa o SQL Server Query serializar mais devagar passa pelo `bun run test` sem nenhum sinal.

Não existe incidente conhecido. O objetivo é prevenção: ter cenários reproduzíveis que qualquer pessoa roda na própria máquina para olhar os números de uma mudança antes de ela entrar.

A solução é um conjunto de cenários versionados no repositório, com um comando único que sobe o que falta, gera os dados, roda cada cenário várias vezes e imprime os números. As metas (réguas) por cenário são configuráveis e vão ser calibradas com as primeiras execuções.

## Goals

*   `bun run perf` roda todos os cenários; `bun run perf <cenário>` roda um. Ambos sobem só os containers que o cenário precisa, geram os dados uma vez por seed e tamanho, e zeram os destinos entre iterações.
*   Cada cenário roda N vezes (padrão 5) depois de 1 run de aquecimento descartada, cada run num processo Bun novo.
*   Por run, o relatório mostra: `durationMs` do engine, CPU, memória no início, pico amostrado durante a run e memória no fim (a régua usa pico menos início), envelopes por segundo, e tempo ativo e de espera por componente. No fim, mediana e dispersão das N runs.
*   Réguas configuráveis por cenário, cada uma com direção (menor ou maior é melhor). Uma régua cuja métrica não existe aparece como "indisponível", nunca como erro.
*   Cada execução grava uma linha JSON (com `schemaVersion`, commit, flag de alterações não commitadas, chave da máquina, impressão digital do cenário, digests das imagens e todas as amostras) em `dataflow.perf/results/`, fora do git.
*   Código de saída 0 por padrão; `--strict` sai com erro quando uma régua estoura. `--quick` roda com N menor e sem aquecimento.
*   Os flows de cenário são validados pelo `bun run test` normal com o `validateFlowFile` do core, para que uma mudança de formato quebre no dia a dia, não meses depois.
*   O engine roda isolado: o server, o Postgres e as portas 5180, 5190 e 5432 do ambiente de dev não são tocados.

## Non-Goals

*   Comparar com execuções anteriores e alertar regressão entre commits. Os resultados já guardam o que é preciso para isso, mas a comparação fica para uma versão seguinte.
*   Medir API, fila, supervisor e workers. O engine roda no processo do perf.
*   Carga na API ou no editor (muitos usuários), carga distribuída em várias máquinas, ou comparar resultados entre máquinas diferentes.
*   Bloquear merge ou rodar no CI.
*   Simular falhas reais de rede. A lentidão e os erros vêm só da API fake.
*   Réguas de Fire and Forget e de workers múltiplos, até essas funções existirem.
*   Relatório em HTML ou no editor. Só texto no terminal por enquanto.
*   Monitorar produção.

## Open Questions

*   **Conversão de versões antigas do flow**: `validateFlowFile` recusa qualquer versão diferente de 1 e ainda não existe conversão. Isso precisa existir no core antes de a versão 2 do formato aparecer, ou os cenários quebram. Fora do escopo deste design, mas é uma dependência.
*   **Métricas de memória por componente**: `ComponentRun.memory.peakBytes` existe no core. Falta confirmar se ele serve como régua ou só como informação, dado que mede amostras de envelopes e não o processo.

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
