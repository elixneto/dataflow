# Página de Runs: dados reais

*   **Author:** Élix Neto
*   **Status:** Implemented
*   **Date:** 2026-11-05

--------------------------------------------------------------------------------

## Overview

A página `/runs` do editor lista os runs de verdade da organização (Run for real, schedules, webhooks, API e os lotes de fire and forget), cada run de topo com a árvore dos runs que lançou, a faixa de números no topo, a timeline do fan-out, os problemas, Stop e o link para os logs no OpenObserve. Nasceu como mock; este documento foi o levantamento do que mudava no server e no editor para ligá-la aos dados reais, e está implementado como descrito abaixo (migration `8_runs_list.sql`, `features/runs/list-runs`, `GET /runs/events`, `data/runs/runs-api.ts` e `use-runs.ts` no editor).

O que já existe e a página aproveita sem mudança:

*   A tabela `runs` com `parent_id`, `root_id`, `parent_node_id` e `call_chain` (migration 7), e os índices `runs_by_org (org_id, queued_at DESC)`, `runs_by_parent` e `runs_by_root`.
*   `POST /runs/:id/cancel` (o Stop do editor), que já serve um run em fila (cancelado na hora) e um a correr (pára no próximo passo).
*   `GET /runs/:id`, com `parentId`, `rootId`, `parentNodeId` e `calledRuns`.
*   O NOTIFY `run_events` que o supervisor manda a cada mudança de um run, que a api já ouve (`followRunEvents`), e o SSE por run (`GET /runs/:id/events`), lido no editor com `fetch` porque o `EventSource` não manda os headers `X-Org-Id` e `X-User-Id`.
*   Os logs do supervisor com `run_id`, `root_run_id` e `parent_run_id` no OpenObserve, que o botão Logs filtra por `root_run_id`.

Test runs ficam fora: estão em `test_runs`, são do editor e somem em um dia.

## O que muda

### 1. Banco (uma migration, esforço P)

A lista não pode ler `record`, `progress` nem `definition`: são jsonb grandes (o record traz amostras de envelopes, a definition é o draft inteiro) e extrair um campo deles (`record->>'error'`, `definition->>'name'`) obriga o Postgres a descompactar o valor inteiro de cada linha. As colunas abaixo guardam o que a página mostra, preenchidas quando o run é criado ou termina:

| Coluna | Quando é preenchida | Para quê |
|---|---|---|
| `flow_name text` | na criação (`StartRunHandler`, `queueCalledRun`) | nome do flow como era no run, mesmo que ele seja renomeado depois; pesquisa por nome |
| `started_by text` | na criação, só no `manual` (o `ctx.userId`) | "Run for real by Ana" (o nome vem de `users`, como no `withUpdatedByName`) |
| `parent_node_label text` | em `queueCalledRun` (`request.nodeLabel`) | "via Enrich in batches" sem ler a definition do pai |
| `error text` | em `finishRun`, `failLost` e no cancel | a mensagem de erro na lista e em Problems |
| `envelopes_in int`, `envelopes_out int` | em `finishRun` (do record: saídas do Start, entradas do End) | "340 → 340" e o tamanho do lote (o `envelopes_in` de um filho é o tamanho do lote) |

Índices novos:

*   `runs (org_id, status) WHERE status IN ('queued', 'running')`: a faixa de números e o badge da sidebar contam os runs em andamento a cada mudança.
*   `runs (root_id, status) WHERE root_id IS NOT NULL`: filtros como "Problems" mantêm um run de topo quando um run abaixo dele bate, e a barra de lotes de cada cartão agrega por raiz.

Os runs antigos ficam com as colunas novas vazias. Um backfill opcional as preenche a partir do `record`, em lotes, fora do horário de uso.

### 2. Endpoints (esforço M)

| Rota | O que responde |
|---|---|
| `GET /runs?status=&project=&trigger=&q=&before=&limit=20` | os runs de topo (`parent_id IS NULL`), do mais novo para o mais antigo, paginados por cursor (`queued_at, id` do último). Cada um vem com os runs da sua árvore (os primeiros 200 por ordem de criação, `row_number()` por `root_id`) e `treeSizes` com o total de cada árvore, para a barra de lotes e a timeline. O filtro vale para o run ou para qualquer run da árvore (`EXISTS` em `root_id`). |
| `GET /runs/overview` | os cinco números do topo: runs de topo nas últimas 24 h, em andamento, em fila com a espera do mais antigo (`min(queued_at)`), problemas e concluídos nas últimas 24 h. Quatro `count` em índice, sem jsonb. |
| `GET /runs/:id/tree` | a árvore inteira de qualquer run dela (o de topo primeiro, os primeiros 200 abaixo). A página não a usa: um link para um run é `/runs?q=<id>`, que filtra a lista até à árvore desse run (ou a deixa vazia, se o id não existir) e o escolhe. |
| `GET /runs/events` (SSE) | ver o item 3. |
| `POST /runs/:id/cancel` | já existe. O "Stop N below" chama a rota uma vez por run; uma rota `POST /runs/:id/cancel-below` (um `UPDATE ... WHERE root_id = $1 AND status IN (...)`) fica para quando as árvores forem grandes. |

A pesquisa por id usa `id::text LIKE '7f3c%'`, que não usa o índice da chave. Com o filtro de organização e período isso basta. Se a tabela crescer muito, a pesquisa passa a aceitar só o id inteiro.

### 3. Atualização ao vivo por SSE (esforço M)

Hoje o mock é consultado a cada 5 s (polling). O real usa SSE, como o run do editor:

*   **Aviso com mais dados.** O `notifyRunEvent` passa a mandar `{id, orgId, rootId, type, status}` e ganha o tipo `status`, enviado quando o run é criado (queued), pego por um worker (`claimRun`, que hoje não avisa), termina ou é cancelado. Os avisos de `progress`, que chegam várias vezes por segundo por run, ficam fora deste stream.
*   **Filtro sem consulta.** A api filtra por organização com o `orgId` do aviso e manda ao browser só `{id, rootId, status}`.
*   **Recarga localizada.** O browser recarrega a árvore aberta (`GET /runs/:id/tree`) quando o `rootId` é o dela, e a página da lista e o overview no máximo uma vez a cada 2 s, para juntar rajadas de avisos.
*   **O que segue igual.** A duração de quem está a correr segue contando no browser a partir do `started_at`, sem pedir nada ao server. O badge da sidebar usa o mesmo stream.
*   **Fallback.** Se a conexão cair, o editor volta ao polling até reconectar.

WebSocket não compensa: o fluxo é só do server para o browser, e as ações (Stop) já são requisições HTTP.

### 4. Editor (esforço P)

*   Trocar `mock-runs-api.ts` por `runs-api.ts` com as rotas acima (as mesmas formas de dados: `RunSummary` e `RunNode`). As funções de `run-history.ts` (`runTree`, `filterTree`, `overview`) passam a montar só a árvore aberta; filtro e contagens vêm do server.
*   `use-runs.ts`: SSE no lugar do `setInterval`, com o leitor de stream de `data/flows/run-events.ts`.
*   `/runs/:runId?tab=errors|logs|metrics|data`: a página de um run para o utilizador (o OpenObserve fica para quem opera a plataforma), com as mesmas abas do painel de run do editor (`RunDetails`), sem Pin output. Tudo vem do `record` do run. Lê o `GET /runs/:id` (que passa a trazer `flowName`, `projectId`, `trigger` e os tempos, das colunas da linha) e segue o run ao vivo pelo `GET /runs/:id/events` enquanto está em fila ou a correr. Um erro clicado abre os Logs do componente; um componente clicado em Metrics abre o seu Data. Os runs de fire and forget são runs próprios: cada um é um link para a sua página, como o run que o lançou. O botão Details do detalhe abre esta página; `/runs/:runId/logs` redireciona para `?tab=logs`.
*   Os testes de `tests/runs.test.tsx` que dependem do relógio do mock passam a usar respostas fixas.

### 5. Envelopes in flight (opcional, esforço P)

O número "1,850 envelopes in flight" soma os envelopes de entrada dos runs a correr. Ler isso do `progress` (jsonb, reescrito várias vezes por segundo) a cada atualização da página não compensa. Mas o `saveProgress` já faz um `UPDATE` por progresso: gravar junto um `envelopes_in` (as saídas do Start até agora, que o supervisor já tem em mãos) custa uma coluna inteira no mesmo `UPDATE`, sem escrita nova. O overview soma esse campo só nas linhas `status = 'running'` (no máximo uma por worker), pelo índice parcial do item 1.

Custo: perto de zero no banco e algumas linhas no supervisor. Fica em uma versão seguinte só se o item 1 não entrar. Sem a coluna, o cartão mostra só a contagem de runs a correr.

### 6. Limite de runs de fire and forget por Flow Invoker

Um Flow Invoker em fire and forget cria no máximo ``4 × WORKERS`` runs por execução (``FIRE_AND_FORGET_PER_WORKER`` no supervisor, passado ao engine como ``maxFireAndForgetRuns``). Com lotes de 5 e 1000 envelopes num supervisor de 1 worker, saem 4 runs: os lotes deixam de fechar pelo tamanho quando o próximo não deixaria espaço, e o último leva o resto. Nenhum envelope se perde, e uma linha de aviso no log do componente diz que o limite foi atingido. Valores de parâmetros que precisariam de um lote novo depois do limite param o run (o On error de fire and forget é sempre Throw). Um test run segue o mesmo limite.

## Riscos e limites

*   **Árvores grandes.** O limite do item 6 segura cada Flow Invoker em `4 × WORKERS` runs, mas runs aninhados multiplicam (cada filho pode lançar os seus). A lista e a árvore trazem os primeiros 200 runs de cada árvore, e a timeline diz "the first 200 of N runs". A barra do cartão passa a ser proporcional por status (um segmento por status, largura pela contagem) quando a árvore tiver mais de 40 runs.
*   **Crescimento da tabela.** A tabela `runs` cresce sem limite e guarda `record`, `progress` e `definition` de cada run. Uma política de retenção (por exemplo, limpar o `record` e a `definition` de runs com mais de 30 dias e manter as colunas da lista) é necessária antes de produção, mas fica fora desta página.
*   **Concorrência no Stop.** Um Stop num run que acabou de terminar responde "already ended" (o `CancelRunHandler` já trata isso). Na árvore, o "Stop N below" pode encontrar runs que terminaram no meio; o diálogo mostra a primeira falha e a lista se atualiza.
*   **Logs.** O log de um run vem do `record` (as linhas de cada componente, guardadas com o run), não do OpenObserve. Linhas da plataforma (supervisor, api) ficam só no OpenObserve.

## Ordem sugerida

1. Migration (colunas, índices) e preencher as colunas na criação, no `finishRun` e no cancel.
2. `GET /runs`, `GET /runs/overview` e `GET /runs/:id/tree`, com testes de integração (filtros que mantêm a árvore, paginação, organização).
3. Editor lendo as rotas com polling (troca do mock).
4. Aviso `status` no NOTIFY e `GET /runs/events`; o editor passa a SSE.
5. Envelopes in flight no `saveProgress` (opcional).

Os itens 1 a 3 já entregam a página com dados reais; o 4 tira o polling.
