# dataflow.perf: cenários de performance do engine

*   **Author:** Élix Neto
*   **Status:** Proposed
*   **Date:** 2026-11-05

--------------------------------------------------------------------------------

## Overview

`dataflow.perf` (daqui em diante, *o perf*) é um pacote do monorepo que roda cenários de performance do engine do dataflow com `bun run perf`. Cada cenário é um ou mais flows em arquivo (o YAML que o Download do editor gera), com dados gerados de forma determinística, executados pelo `flowRunner` do core num processo Bun novo, contra MongoDB, SQL Server e uma API HTTP fake que ficam em containers dedicados, cada um com limite de CPU e RAM. O relatório sai em texto no terminal: para cada run, as métricas de tempo, memória, CPU e envelopes por segundo contra as réguas do cenário. Os resultados ficam num arquivo local, fora do git.

Um *envelope* é a unidade que o engine processa: um registro (um objeto `DATA` com os campos do dado) que atravessa os componentes do flow um a um. Uma linha do SQL Server, um documento do MongoDB ou um item de um array de entrada viram um envelope cada. Todas as métricas de volume deste documento contam envelopes.

O pacote nunca vai para o deploy do app e não toca no server, no Postgres nem nas portas que o editor usa. Além do Bun e do Docker Desktop (pelo menos 6 GB para containers, ver Riscos e limites), não há nada a instalar: cenários, compose e API fake estão no repositório.

## The Problem

Não há hoje um jeito de ver como o engine se comporta com volume e lentidão. Os testes automáticos usam poucos envelopes e respondem em milissegundos, e um flow real contra um banco real só mostra um problema em produção. Um commit que dobra o uso de memória do Mapper ou deixa o SQL Server Query serializar mais devagar passa pelo `bun run test`.

Não existe incidente conhecido. O objetivo é prevenção: ter cenários reproduzíveis que rodam na máquina de quem desenvolve, para olhar as métricas de uma mudança antes de ela entrar. Nesta versão a ferramenta é de observação: ela imprime as métricas e guarda os resultados; quem compara é a pessoa, com o relatório anterior ao lado (a comparação automática é um Non-Goal).

A solução é um conjunto de cenários versionados no repositório, com um comando único que sobe o que falta, gera os dados, roda cada cenário várias vezes e imprime as métricas. As réguas por cenário são configuráveis; seus limites vão ser calibrados com as primeiras execuções.

## Goals

*   `bun run perf` roda todos os cenários; `bun run perf <cenário...>` roda os indicados. Ambos sobem só os containers que o cenário precisa, carregam os dados de origem uma vez por cenário e seed, e zeram os destinos entre iterações.
*   Cada cenário roda N vezes (padrão 5) depois de 1 run de aquecimento descartada, cada run num processo Bun novo, com os drivers e os scripts pré-aquecidos antes de o relógio começar.
*   Por run, o relatório mostra: `durationMs` do engine, CPU, memória no início, pico amostrado durante a run e memória no fim (a régua usa pico menos início), envelopes por segundo, e tempo ativo e de espera por componente. No fim, mediana e dispersão das N runs, e a mediana da última execução do mesmo cenário nesta máquina ao lado, quando existir.
*   Réguas configuráveis por cenário, cada uma com direção (menor ou maior é melhor) e um limite opcional. Uma régua cuja métrica não existe aparece como "indisponível", não como erro.
*   Cada execução grava uma linha JSON (com `schemaVersion`, commit, flag de alterações não commitadas, chave da máquina, impressão digital (`fingerprint`) do cenário, digests das imagens e todas as amostras) em `dataflow.perf/results/`, fora do git.
*   Código de saída 0 por padrão; `--strict` sai com erro quando um run falha ou uma régua com limite estoura. `--quick` roda com N menor e sem aquecimento.
*   A ferramenta só serve se o ruído for menor que o que ela quer mostrar: a dispersão (máximo menos mínimo sobre a mediana) do `in-memory-pipeline` com N = 5 deve ficar abaixo de 10 % na máquina de referência do autor; se não ficar, o relatório diz "ruído alto" e o passo seguinte é aumentar N ou fixar a CPU, antes de calibrar qualquer limite.
*   Os flows de cenário são validados pelo `bun run test` normal com o `validateFlowFile` do core, para que uma mudança de formato quebre no dia a dia, não meses depois.
*   O engine roda isolado: o server, o Postgres e as portas 5180, 5190 e 5432 do ambiente de dev não são tocados.

## Non-Goals

*   Comparar com execuções anteriores e alertar regressão entre commits. Os resultados já guardam o que é preciso para isso, mas a comparação fica para uma versão seguinte.
*   Medir API, fila, supervisor e workers. O engine roda no processo do perf.
*   Carga na API ou no editor (muitos usuários), carga distribuída em várias máquinas, ou comparar resultados entre máquinas diferentes.
*   Bloquear merge ou rodar no CI.
*   Simular falhas reais de rede. A lentidão e os erros vêm só da API fake.
*   Réguas de Fire and Forget (disparar um flow sem esperar o resultado) e de workers múltiplos (vários processos de execução em paralelo), até essas funções existirem.
*   Relatório em HTML ou no editor. Só texto no terminal.
*   Abrir as runs do perf no editor ou apontar "o componente que mais mudou": as runs não passam pelo server (não existem lá) e não há comparação nesta versão.
*   Monitorar produção.

## Open Questions

*   **Métricas de memória por componente**: `ComponentRun.memory.peakBytes` existe no core. Falta confirmar se ele serve como régua ou só como informação, dado que mede amostras de envelopes e não o processo.
*   **Cortes de escopo sugeridos pela revisão, pendentes de decisão do autor**: (a) tirar `limit`/`--strict` até existir um limite real; (b) guardar só campos brutos da máquina em vez de hashes (`fingerprint`, digests); (c) API fake como processo local, sem container; (d) expor `runJob` do server por `exports` e chamá-lo em vez de copiar a montagem do `RunOptions`. Este documento mantém as decisões anteriores do autor até ele decidir.

Dependência fora do escopo: `validateFlowFile` recusa qualquer versão diferente de 1 e ainda não existe conversão de versões antigas. Ela precisa existir no core antes de a versão 2 do formato aparecer; a CUJ 3 é o que avisa.

## Critical User Journeys (CUJs)

### CUJ 1: Primeira execução num clone novo

*   **Given**: Repositório clonado, `bun install` feito, Docker Desktop rodando com pelo menos 6 GB para containers, nenhuma imagem do perf baixada.
*   **When**: `bun run perf sqlserver-to-mongodb`.
*   **Then**: O comando confere Docker e memória, sobe só `mssql` e `mongodb` do `docker-compose.perf.yml` (baixando as imagens) e espera os healthchecks. Carrega os dados de origem do cenário uma vez; nas próximas execuções a carga é pulada porque o marcador dos dados confere. Roda 1 aquecimento e 5 runs em processos Bun novos, zerando a coleção de destino antes de cada um, e imprime a tabela de métricas contra as réguas, com mediana e dispersão. Uma linha vai para `dataflow.perf/results/<máquina>.jsonl`. Sai com código 0. Os containers continuam em execução; o ambiente de dev (`bun run dev`, :5180, :5190, :5432) não foi tocado.

### CUJ 2: Checar uma mudança no engine enquanto desenvolve

*   **Given**: Containers do perf já em execução de uma execução anterior; uma alteração local no Mapper do core, ainda sem commit.
*   **When**: `bun run perf in-memory-pipeline --quick`.
*   **Then**: Nenhum container é tocado (o cenário não precisa de nenhum). Rodam 2 runs sem aquecimento num tamanho menor. O relatório sai em menos de um minuto, com a linha de resultado marcada como `<sha>-dirty` e a mediana da última execução deste cenário e tamanho nesta máquina ao lado da atual. A pessoa compara as duas colunas.

### CUJ 3: Mudança no formato do flow

*   **Given**: Um commit no core muda `FLOW_FILE_VERSION` para 2 sem conversão da versão 1.
*   **When**: `bun run test` na raiz.
*   **Then**: O teste `dataflow.perf/tests/flows.test.ts` falha para cada flow de cenário, dizendo qual arquivo e qual erro `validateFlowFile` devolveu. A quebra aparece no dia a dia, não numa execução de perf meses depois.

## Technical Plan (Architecture)

### Visão geral

Como o server executa um flow hoje: a API grava a run no Postgres e avisa por NOTIFY; o supervisor (`dataflow.server/supervisor/`) pega a run (ou a vê no poll de 5 s), monta um `RunJob` com o flow, os perfis de conexão, os segredos e os flows chamados (`features/runs/run-job.ts`), e a entrega a um worker (processo filho reutilizado por até 100 runs), que chama `flowRunner` do core com os drivers de `dataflow.server/shared/runner/` e devolve o `RunRecord` (status, `durationMs`, um `ComponentRun` por componente com `activeTimeMs`, `waitingMs`, contagens de envelopes por porta e, nos acumuladores, `memory.peakBytes`). O worker amostra o RSS do próprio processo a cada 100 ms durante a run.

O perf é um workspace Bun (`@dataflow/perf`) com três partes: um **orquestrador** (`src/cli.ts`), um **processo de medição** por run (`src/run-once.ts`) e uma **API HTTP fake** (`fake-api/`) que vive num container. O orquestrador nunca roda um flow: ele sobe containers, carrega dados, zera destinos, dispara o processo de medição N+1 vezes, agrega e imprime. O processo de medição é o único lugar onde o `flowRunner` executa, e morre no fim de cada run, por isso cada run começa sem heap herdado de runs anteriores.

```text
bun run perf [cenário...] [--runs N] [--quick] [--strict] [--size S] [--list]
        │
        ▼
┌──────────────────────── dataflow.perf/src/cli.ts (orquestrador) ─────────────────────────┐
│ 1. lê o registro de cenários (scenarios/*/scenario.ts)                                   │
│ 2. confere `docker info` e a memória do Docker contra os limites dos serviços do cenário │
│ 3. `docker compose -f docker-compose.perf.yml up -d --wait <serviços do cenário>`        │
│ 4. carga dos dados de origem (uma vez por cenário e seed), pulada se o marcador confere  │
│ 5. para cada run (1 aquecimento + N):                                                    │
│      zera destinos ─► Bun.spawn(run-once.ts, cenário, size, seed) ─► lê JSON do stdout   │
│ 6. mediana e dispersão ─► réguas ─► relatório no terminal ─► linha no results/*.jsonl    │
└───────────────┬──────────────────────────────────────────┬───────────────────────────────┘
                │ processo Bun novo por run                 │ docker compose (projeto dataflow-perf)
                ▼                                           ▼
┌──── src/run-once.ts (medição) ─────┐     ┌──────────────────────────────────────────────┐
│ flows YAML ─► flowFromYaml         │     │ mssql     :14330  2 CPU / 2,5 GB  vol. mssql │
│          ─► toExecutableFlow       │ ──► │ mongodb   :27018  1 CPU / 1 GB    vol. mongo │
│ RunOptions: evaluate, prepareScript│     │ fake-api  :5195   1 CPU / 512 MB (Bun)       │
│   drivers de dataflow.server/      │     └──────────────────────────────────────────────┘
│   shared/runner, connections,      │
│   flows (Flow Invoker), secrets    │
│ pré-aquece drivers e scripts       │
│ Worker amostra RSS do processo;    │
│ process.cpuUsage() antes/depois    │
│ flowRunner(...) ─► RunRecord       │
│ stdout: 1 JSON {record, memory,    │
│   cpu} e sai                       │
└────────────────────────────────────┘
```

### O orquestrador (`src/cli.ts`)

Lê os argumentos da linha de comando. Sem cenário, roda todos na ordem do registro. Flags: `--runs N` (padrão: o `runs` do cenário, senão 5), `--quick` (N = 2, sem aquecimento, tamanho `quickSize` do cenário), `--strict` (código de saída 1 quando um run falha ou uma régua com limite estoura), `--size S` (substitui o tamanho do cenário), `--list` (imprime os cenários, seus serviços e réguas e sai). `bun run perf` na raiz executa `bun dataflow.perf/src/cli.ts` com o diretório de trabalho na raiz; todo caminho do perf (compose, cenários, `results/`, o script do processo de medição) é resolvido a partir da pasta do pacote, nunca do diretório de trabalho.

Antes de cada cenário, imprime o que vai fazer (serviços, tamanho, N) e, se existir, a mediana da última execução do mesmo cenário e tamanho no arquivo JSONL desta máquina, usada como estimativa de tempo e repetida na tabela de réguas como coluna "anterior". Isso só lê o arquivo; não há veredito de regressão.

`Ctrl+C` encerra o processo de medição em andamento (no Windows, pela árvore de processos, como o `scripts/dev.ts`), grava a linha JSONL com `partial: true` e as amostras que já tem, e sai. Os containers continuam em execução.

### O processo de medição (`src/run-once.ts`)

Recebe por argumentos o id do cenário, o tamanho, a seed e o número da iteração. Monta tudo o que o engine precisa, pré-aquece, e só então começa a medir:

*   **Flows**: cada `scenarios/<id>/flows/*.yaml` passa por `flowFromYaml` (uma falha encerra o processo com o caminho e os erros devolvidos) e `toExecutableFlow(file, 'perf')` (o segundo argumento é o nome do projeto que aparece no `RunRecord`), com o `id` do arquivo mantido. O flow com `id` igual ao id do cenário é o principal; os outros entram no mapa `flows` do `RunOptions` para o Flow Invoker (`config.flowId` de cada nó aponta para esses ids fixos).
*   **Conexões**: o mapa `connections` tem dois perfis fixos, `perf-sqlserver` (tipo `sqlserver`: host `127.0.0.1`, porta 14330, banco `perf`, usuário `sa`, `encrypt` off, `trustServerCertificate` on, senha pelo segredo `PERF_SA_PASSWORD`) e `perf-mongodb` (tipo `mongodb`: `connectionString` pelo segredo `PERF_MONGO_URL`, campo `database` = `perf`). Os valores dos segredos são constantes em `src/stack.ts` e só valem para os containers locais do perf. Os nós dos flows usam `connection: 'perf-sqlserver'` ou `'perf-mongodb'`.
*   **Drivers**: os mesmos que o worker usa, importados do pacote `@dataflow/server` por caminho de arquivo (`@dataflow/server/shared/runner/sqlserver-driver.ts` etc.): `querySqlServer`, `aggregateMongoDb`, `upsertMongoDb`, `deleteMongoDb`, `sendHttp`, `evaluate`, `prepareScript`. Isso funciona porque o `package.json` do server não tem `exports` nem `main`; se um dia tiver, o perf passa a importar do que ele exportar. O `RunOptions` fica igual ao do `runJob` do server, sem `onProgress` (ele copia o estado várias vezes por segundo e isso mediria o editor, não o engine), com `mode: 'execution'`, `parameterValues: {size: String(size)}` (os flows que não declaram o parâmetro o ignoram) e `timeoutMs` igual ao `timeoutMs` do cenário.
*   **Entrada**: o cenário pode dar um `input` (array gerado por `data.ts`) quando o Start aceita entrada; é assim que os cenários sem container alimentam o flow.
*   **Pré-aquecimento**: num processo novo, o primeiro uso de cada driver paga o `import` do pacote, a conexão (login e TLS no SQL Server, seleção de servidor no MongoDB) e, no TypeScript, o bundle do script; em produção um worker amortiza isso em até 100 runs. Antes de ligar o relógio, o processo faz uma consulta trivial por cada driver que o cenário usa (`SELECT 1` por `querySqlServer`, `ping` por `aggregateMongoDb` com um pipeline vazio numa coleção vazia, `GET /health` por `sendHttp`) e um `prepareScript` por script do flow, pelas mesmas funções que o engine vai chamar. O que sobra dentro de `durationMs` é o engine.

A medição em si:

1. `Bun.gc(true)` e `process.memoryUsage()` uma vez (início: `rss`, `heapUsed`).
2. Um `Worker` do Bun (`new Worker(new URL('./memory-sampler.ts', import.meta.url))`) que lê `process.memoryUsage.rss()` a cada 10 ms e guarda o máximo. O RSS é do processo inteiro, então o worker vê a memória do thread principal; e como ele tem o próprio event loop, continua amostrando enquanto o engine ocupa o thread principal. Isso importa: o engine passa envelopes por promessas (microtasks), sem ceder a timers, então um `setInterval` no thread principal só dispararia quando o flow terminasse. Ao fim, o worker devolve o pico e o número de amostras por `postMessage`.
3. `process.cpuUsage()` antes e depois (user + system).
4. `await flowRunner(...)`.
5. Encerra o worker, mais uma leitura de RSS (o fim) e de `heapUsed`.
6. Fecha pools e clients (`closeSqlServerPools`, `closeMongoClients`) e escreve no stdout **uma linha JSON** com o `RunRecord` inteiro, a memória (início, pico, fim, amostras) e a CPU, com os mesmos nomes que o worker do server usa (`startRssBytes`, `peakRssBytes`, `cpuMs`). Logs do engine e erros vão para o stderr. Código de saída 0 se o run terminou (mesmo `failed`: o orquestrador decide), 2 se o processo em si quebrou.

O orquestrador encerra o processo de medição à força em `timeoutMs` mais 30 s: o timeout do engine é um timer e, por isso, também não dispara num flow sem I/O.

### Cenários (`scenarios/<id>/`)

Cada cenário é uma pasta com:

*   `scenario.ts`: exporta um `Scenario` com `id`, `description`, `services` (subconjunto de `['mssql', 'mongodb', 'fake-api']`), `size` e `quickSize`, `seed`, `runs` (opcional; o padrão é 5 e `--runs` sobrepõe), `timeoutMs`, `dataVersion` (reexportado de `data.ts`), `throughputNode` (o `label` do componente cujas saídas contam como envelopes processados), `rulers`, e funções `load(ctx)` (carga inicial dos dados de origem), `reset(ctx)` (zera os destinos antes de cada run) e `input(size, seed)` (opcional, a entrada do Start).
*   `flows/*.yaml`: um ou mais flows no formato do Download. O flow principal tem `id` igual ao id do cenário.
*   `data.ts`: o gerador determinístico (um PRNG `mulberry32` pela seed; nunca `Math.random`) e a constante `DATA_VERSION`, que entra no marcador dos dados.

Os cinco cenários iniciais (componentes do core: Mapper calcula campos; Filter descarta por condição; Router separa em saídas por condição; TypeScript roda um `process` do usuário; Flow Invoker chama outro flow por envelope; Aggregate junta N envelopes num lote; Sort e Limit ordenam e cortam; os de banco e HTTP falam com fora):

| Cenário | Serviços | O que mede | Tamanho (quick) |
|---|---|---|---|
| `in-memory-pipeline` | nenhum | Start com entrada → Mapper → Filter → Router → TypeScript → End. CPU e alocação do engine puro. | 300 000 (30 000) envelopes |
| `flow-invoker-fanout` | nenhum | Start com entrada → Flow Invoker (flow filho com Mapper) → End. Custo de um `flowRunner` por envelope. | 20 000 (2 000) envelopes |
| `sqlserver-to-mongodb` | mssql, mongodb | SQL Server Query (stream com backpressure) → Mapper → MongoDB Upsert (lote 500). Origem SQL, destino Mongo. | 100 000 (10 000) linhas |
| `mongodb-pipeline-aggregate` | mongodb | MongoDB Pipeline (com `$group` no banco) → Filter → Aggregate (lotes de 500) → TypeScript (soma do lote) → Sort → Limit → End. Acumuladores e a memória que eles seguram. | 200 000 (20 000) documentos |
| `http-slow-api` | fake-api | Start com entrada (ids) → HTTP Request (8 ao mesmo tempo, 20 ms ± 10 ms, 2 % de falhas desviadas pela porta de erro) → Mapper → End. Espera externa e tratamento de erro. | 2 000 (200) requisições |

Os dois primeiros não precisam de Docker e servem de smoke test em máquinas sem Docker.

### Dados e destinos

A carga é feita pelo orquestrador, nunca pelo dataflow, e só nos cenários com `mssql` ou `mongodb` em `services`. É feita **uma vez por cenário e seed, no `size` máximo do cenário**: os flows leem o subconjunto que a run pede por parâmetro (`WHERE id <= @size` no SQL Server, `$limit` no pipeline), então `--quick`, `--size` e o tamanho completo compartilham os mesmos dados e não recarregam nada. Um `--size` maior que o `size` do cenário recarrega nesse tamanho.

`load(ctx)` começa apagando os objetos de origem que vai criar (tabela, coleção), carrega em lote pelo cliente do banco, e só no fim o orquestrador grava o marcador (`dbo._perf_meta` no SQL Server, coleção `_perf_meta` no MongoDB): a chave é o id do cenário e o valor é o hash de `dataVersion`, seed e tamanho carregado, mais a data. Marcador ausente ou diferente significa carga incompleta ou dados de outra versão, e a carga roda de novo do zero. Os volumes nomeados do compose guardam os dados entre execuções e entre reinícios do Docker.

`reset(ctx)` zera só os destinos: a coleção que o Upsert escreve; `POST /_reset` na API fake. As origens não são tocadas.

### A API fake (`fake-api/`)

Um servidor `Bun.serve` numa imagem própria (`oven/bun`, mesma versão do `Dockerfile` do server), subido pelo compose com 1 CPU e 512 MB. Sem dependências e sem `package.json` na imagem, então os três arquivos dela importam uns aos outros por caminho relativo. Rotas:

*   `GET /items/:id` e `GET /items?page=&size=`: devolve itens gerados pela seed; com `delayMs`, `jitterMs`, `failRate` e `seed` na query string. O jitter e a decisão de falhar saem de um PRNG alimentado por `seed` e pelo **id do item** (ou, na lista, pelo número da página), não pela ordem de chegada: com 8 requisições em voo a ordem muda a cada run, e o resultado para um mesmo item precisa ser o mesmo.
*   `POST /items`: ecoa o corpo depois do mesmo atraso.
*   `GET /_stats`: contadores (requisições, falhas devolvidas, latência p50 e p95 medida dentro do servidor) desde o último reset; `POST /_reset` zera. `GET /health` para o healthcheck.

Os parâmetros da query string são um tipo `FakeApiParams` em `fake-api/params.ts`, com `parseParams(url)` do lado do servidor e `fakeApiUrl(base, path, params)` do lado dos cenários. A URL fica literal no YAML do flow (o arquivo é estático); o teste `flows.test.ts` lê essa URL com `parseParams` e a compara com o `FakeApiParams` que o `scenario.ts` exporta, para que um nome errado quebre no `bun run test`. O relatório inclui o `/_stats` de cada run, para se ver quando a API, e não o engine, é o gargalo.

### Métricas, réguas e relatório

Uma **amostra** é o JSON de um run. Um **registro de extratores** (`src/metrics.ts`) transforma a amostra em métricas nomeadas, cada uma `number | undefined`:

| Métrica | De onde vem |
|---|---|
| `durationMs` | `record.durationMs` (o relógio do engine) |
| `envelopesPerSecond` | soma dos `outputs` do componente `throughputNode` do cenário ÷ `durationMs` × 1000 |
| `cpuMs` | `cpuUsage` user + system |
| `cpuPercent` | `cpuMs` ÷ `durationMs` × 100 |
| `memoryStartBytes`, `memoryPeakBytes`, `memoryEndBytes` | amostragem de RSS |
| `memoryDeltaBytes` | pico menos início (a régua de memória) |
| `component.<label>.activeMs`, `component.<label>.waitingMs` | `ComponentRun.activeTimeMs`, `waitingMs` do componente com esse `label` |
| `component.<label>.peakBytes` | `ComponentRun.memory.peakBytes` (ver Open Questions) |
| `fakeApi.requests`, `fakeApi.failures`, `fakeApi.p50Ms`, `fakeApi.p95Ms` | `/_stats`, só quando o cenário usa a API fake |

Uma **régua** é `{metric, direction: 'lower-is-better' | 'higher-is-better', limit?: number}`; o *limite* é o valor que, ultrapassado na direção errada, estoura a régua. O julgamento usa a **mediana** das N runs medidas (o aquecimento e os runs com `status === 'failed'` ficam fora; sem nenhum run válido, tudo é "indisponível"). Todos os cenários iniciais vêm sem `limit`: a linha mostra mediana, mínimo, máximo e a coluna "anterior", e o veredito é "sem limite". Os limites são preenchidos depois das primeiras execuções na máquina de referência; até lá `--strict` só falha por run `failed`. Métrica `undefined` mostra "indisponível" e não conta como estouro.

O relatório é texto puro: cabeçalho do cenário (commit, dirty, máquina, serviços, tamanho, N), uma tabela com as réguas (métrica, mediana, mín, máx, anterior, limite, veredito), uma tabela dos componentes (mediana de `activeMs` e `waitingMs` por componente, ordenada por `activeMs`), a linha da API fake quando houver, e o status de cada run. No fim de tudo, um resumo por cenário.

### Resultados (`results/<chave-da-máquina>.jsonl`)

Uma linha por cenário executado, `schemaVersion: 1`:

```text
{ schemaVersion, at, scenario, size, seed, runs, quick, partial,
  git: { sha, dirty },
  machine: { key, cpuModel, cores, totalMemBytes, platform, release, bunVersion, dockerVersion, limits },
  fingerprint: { scenario, data, flows, compose },
  images: { mssql: digest, mongodb: digest, 'fake-api': hash das fontes },
  warmup: amostra | null,
  samples: [ amostra, ... ],
  rulers: [ { metric, direction, limit, median, min, max, previous, verdict } ] }
```

A chave da máquina (`machine.key`) é um hash de modelo de CPU, núcleos, RAM total, sistema e versão e versão do Bun; a versão do Docker e os limites do compose ficam gravados na linha, mas fora da chave, para uma atualização do Docker Desktop não abrir um arquivo novo. A impressão digital (`fingerprint`) do cenário é um hash dos YAML dos flows (ordenados por nome), de `dataVersion`, seed, tamanho, réguas e serviços; a dos dados é a do marcador; a dos flows é só dos YAML; a do compose é do arquivo inteiro. Os digests saem de `docker image inspect`. Nada disso é comparado nesta versão; a revisão sugeriu guardar só os campos brutos (Open Questions).

### Containers (`docker-compose.perf.yml`)

Projeto `name: dataflow-perf`, arquivo próprio dentro de `dataflow.perf/`. Três serviços, cada um com `deploy.resources.limits` (o `docker compose` v2 aplica `cpus` e `memory` sem Swarm), healthcheck e volume nomeado. As imagens têm tag fixa e digest `@sha256:` anotado no compose; o digest é preenchido na implementação a partir de `docker image inspect` e conferido pelo teste `stack.test.ts` (nada de `latest`):

*   `mssql`: `mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04` com `ACCEPT_EULA=Y`, `MSSQL_PID=Express`, `MSSQL_SA_PASSWORD` fixa (cumpre a complexidade que o SQL Server exige), porta `14330:1433`, 2 CPUs, 2,5 GB; healthcheck `/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT 1"` (o `sqlcmd` não está no PATH da imagem; se a tag escolhida não trouxer o `mssql-tools18`, o healthcheck vira um probe TCP na 1433 com `bash -c '</dev/tcp/127.0.0.1/1433'`). O Express exige os mesmos 2 GB para subir; o limite fica acima disso.
*   `mongodb`: `mongo:8.0.9`, porta `27018:27017`, 1 CPU, 1 GB; healthcheck `mongosh --quiet --eval "db.runCommand({ping:1}).ok"`.
*   `fake-api`: `build: ./fake-api`, porta `5195:5195`, 1 CPU, 512 MB; healthcheck por `bun -e "fetch('http://localhost:5195/health')..."`, o mesmo padrão do server no `docker-compose.yml` da raiz.

`docker compose up -d --wait <serviços>` sobe só os que o cenário lista e volta quando os healthchecks passam. O orquestrador imprime, antes, quanto de memória os serviços pedem e quanto o Docker tem, e para com uma mensagem de correção quando não cabe. O SQL Server não tem imagem ARM64: em Apple Silicon o orquestrador avisa que roda emulado e que os resultados não se comparam com os de outras máquinas, e continua.

### Fronteira com o resto do monorepo

O perf é um workspace novo. Fora dele mudam o `package.json` da raiz (workspace e scripts), o `Dockerfile` do server e o `.dockerignore` (o `bun install --frozen-lockfile` dentro da imagem exige o `package.json` de todos os workspaces do lockfile; o resto do perf fica fora da imagem), e o `.gitignore`. A lista arquivo a arquivo está no plano de implementação.

O repositório instala com o linker isolado do Bun (nada é içado para o `node_modules` da raiz), então o perf declara tudo o que importa: `@dataflow/core`, `@dataflow/server`, e também `mssql`, `mongodb` e `yaml`, que o orquestrador usa na carga e nos testes. Nenhum pacote de terceiros novo entra no lockfile. Nada no core nem no server muda; o único acoplamento é a importação dos drivers, coberta pelo `bun run typecheck`.

### Riscos e limites

| Risco | Tratamento |
|---|---|
| Ruído de 10 a 30 % run a run num notebook com Docker Desktop | Aquecimento descartado, N = 5, mediana e dispersão sempre visíveis; "ruído alto" quando a dispersão passa de 10 %; critério de aceitação nos Goals |
| Cold-start do processo novo (drivers, conexões, bundle) dentro do `durationMs` | Pré-aquecimento antes do relógio (seção do processo de medição) |
| Flow sem I/O não cede a timers: amostragem e timeout do engine não disparam | Amostragem num `Worker`; kill pelo orquestrador em `timeoutMs` + 30 s |
| SQL Server Express exige 2 GB; o stack pede até 4 GB; sem imagem ARM64 | Checagem de `docker info` antes de subir, com a correção; aviso de emulação em Apple Silicon |
| Docker parado, ou portas 14330, 27018, 5195 ocupadas | Mensagem com a causa e o comando para liberar; código de saída 2 |
| `up --wait` sem fim se um healthcheck nunca passa (SQL Server > 60 s para subir) | `--wait-timeout 180` e mensagem com `docker compose logs <serviço>` |
| Carga interrompida deixa dados parciais | Marcador gravado só no fim; origem apagada antes de cada carga |
| Volumes e `results/*.jsonl` crescem sem limite | `docker compose -p dataflow-perf down -v` documentado no README; `results/` é local e apagável |
| Processo de medição travado ou morto no meio | Linha com `partial: true`; o `Ctrl+C` grava o que já tem |
| Formato do flow muda sem conversão | CUJ 3: `flows.test.ts` quebra no `bun run test` |

## Alternatives Considered

### Alternative A: Rodar os cenários pelo servidor (API → fila → supervisor → worker)

*   **Pros**: Mede o caminho que a produção usa; é o único jeito de ver fila, workers e, no futuro, Fire and Forget.
*   **Cons**: Soma à medida o NOTIFY e o poll de 5 s do supervisor (um NOTIFY perdido são 5 s a mais), a reutilização do worker por até 100 runs (memória de runs anteriores no pico) e a cópia do progresso para o Postgres. Exige um server e um Postgres de perf em execução, e os flows no banco, com ids que mudam a cada seed.
*   **Reason for Rejection**: Rejected by author: o ruído da fila e do worker atrapalha justamente a comparação que o perf quer permitir. Fila e workers ficam para quando houver o que medir neles (Non-Goals).

### Alternative B: v0 mínima com Testcontainers, sem pacote nem compose

*   **Pros**: Reaproveita `tests/integration/database-drivers.test.ts`; sem workspace novo, sem compose, sem Dockerfile alterado; menos arquivos.
*   **Cons**: Testcontainers sobe e derruba os containers a cada execução: o SQL Server leva 30 a 60 s para subir e os dados teriam de ser recarregados sempre (ou depender do modo de reutilização do Testcontainers, que não é padrão e não isola portas). Um script dentro de `dataflow.server/tests` entraria no `bun test` do server ou precisaria de uma exclusão. Sem lugar para o `results/` fora do git nem para a API fake.
*   **Reason for Rejection**: Rejected by author: os containers precisam continuar em execução entre execuções e os dados precisam sobreviver, e isso é o que um compose próprio dá. A parte boa da proposta (engine no próprio processo, N runs, uma linha JSON) foi adotada.

### Alternative C: Perfil `perf` dentro do `docker-compose.yml` atual

*   **Pros**: Um arquivo de compose só; `docker compose --profile perf up`.
*   **Cons**: Divide o projeto `dataflow`, a rede e o `docker compose down` com o ambiente de dev; qualquer `down -v` apaga o volume do Postgres do dev. Portas e volumes teriam de ser nomeados para não colidir mesmo assim.
*   **Reason for Rejection**: Rejected by author: o perf não pode tocar no Postgres nem nas portas do dev. Um projeto compose separado (`name: dataflow-perf`) garante que um `docker compose down` do perf não alcança volumes nem rede do dev.

### Alternative D: Flows de cenário criados no banco pelo seed de dev (projeto "Lab")

*   **Pros**: Os flows aparecem no editor para serem editados.
*   **Cons**: Dependem do server e do Postgres; não ficam no git; uma mudança de formato os deixa ilegíveis sem ninguém notar; os ids de conexão e de flow mudam a cada seed.
*   **Reason for Rejection**: Rejected by author: os flows ficam em arquivos versionados dentro do perf, com ids fixos, e nunca vão para o banco. Quem quiser editar um no editor pode fazer Upload do YAML e Download de volta.

### Alternative E: Flows de cenário montados em TypeScript (objetos `ExecutableFlow`), não em arquivos

*   **Pros**: Typecheck dos configs; sem parse.
*   **Cons**: Não passa por `validateFlowFile`, então uma mudança de formato de arquivo não quebraria o teste do dia a dia (um dos Goals); não se edita no editor; posições e grupos teriam de ser inventados para um Upload.
*   **Reason for Rejection**: Rejected by author: o perf lê flows só pelas funções do core, e o YAML do Download é o formato que o core lê e que o teste `flows.test.ts` valida.

### Alternative F: Ler as métricas do Postgres do server

*   **Pros**: Reaproveita o que o server já grava por run.
*   **Cons**: Acopla o perf ao esquema (já na migração 6) e exige o server rodando.
*   **Reason for Rejection**: Rejected by author: com o engine no processo, o `RunRecord` vem direto do `flowRunner`, sem banco.

### Alternative G: Comparar com o commit anterior e alertar regressão

*   **Pros**: Dá um veredito automático.
*   **Cons**: Variação de 10 a 30 % na mesma máquina gera alarme por ruído; deriva lenta passa; exige base por máquina, tolerância por dispersão e marcação de dirty, isto é, um subsistema inteiro.
*   **Reason for Rejection**: Rejected by author: adiado, não descartado. O JSONL guarda chave da máquina, impressão digital, digests e todas as amostras para que a versão seguinte compare sem mudar o formato. A coluna "anterior" do relatório não é um veredito: é o último valor, lado a lado.

### Alternative H: k6, hyperfine ou mitata

*   **Pros**: Ferramentas prontas. O k6 gera carga HTTP com relatório; o hyperfine roda um comando N vezes e dá mediana; o mitata faz micro benchmarks.
*   **Cons**: O k6 mede uma API sob muitos usuários, fora do escopo. O hyperfine só vê o tempo de relógio do processo inteiro (subida do Bun, carga dos drivers), não o `durationMs` do engine, e não lê o `RunRecord`. O mitata mede funções isoladas, não um flow com bancos. Nenhum sobe containers, carrega dados ou grava o histórico por máquina.
*   **Reason for Rejection**: Rejected by author: o que elas dariam (N runs e mediana) cabe em poucas dezenas de linhas no orquestrador; o resto do problema elas não cobrem.

### Alternative I: Amostrar a memória do processo de medição a partir do orquestrador, ou por `setInterval` no próprio processo

*   **Pros**: Do orquestrador: não depende do processo medido. Por `setInterval` no próprio processo: é o que o worker do server faz hoje (a cada 100 ms), sem código novo.
*   **Cons**: Do orquestrador: não há API portátil para ler o RSS de outro processo (`/proc/<pid>/status` no Linux, `ps` no macOS, `Get-Process` ou WMI no Windows, cada um com custo e atraso maiores que o intervalo). Por `setInterval`: o engine não cede a timers (envelopes passam por microtasks), então num flow sem I/O o timer só dispara no fim e o pico some; no worker do server isso fica escondido porque todo flow de produção tem I/O.
*   **Reason for Rejection**: Rejected by author: um `Worker` do Bun dentro do processo de medição lê `process.memoryUsage.rss()` (do processo inteiro) no próprio event loop, a cada 10 ms, portátil e sem shell.

### Alternative J: API fake como processo Bun na máquina, fora do Docker

*   **Pros**: Sem imagem para construir; sobe em milissegundos; sem o port-forwarding do Docker Desktop na latência medida.
*   **Cons**: Disputa CPU com o processo de medição e sem limite; o cenário `http-slow-api` mediria a API fake tanto quanto o engine.
*   **Reason for Rejection**: Rejected by author: a API fake precisa de um limite de CPU separado do processo medido, e o compose já está lá para dar isso. A revisão contestou o peso desse argumento (a API é um servidor de `sleep` a ~400 req/s) e a decisão está listada em Open Questions.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**: Nenhum dado real. As senhas do SQL Server e a URL do MongoDB dos containers do perf são constantes no código e só valem para `127.0.0.1` nas portas do perf. Nada do perf entra na imagem do server (`.dockerignore`), e o server nunca o importa.
*   **Performance & Latency**: O próprio perf não pode distorcer o que mede: o orquestrador não faz nada enquanto o filho roda (só espera o processo); a amostragem de RSS é uma chamada a `process.memoryUsage.rss()` a cada 10 ms num worker; sem `onProgress`. O tempo total do `bun run perf` completo deve ficar abaixo de 15 minutos numa máquina com os containers já em execução; cada cenário diz quanto demorou e o `--quick` fica abaixo de 2 minutos.
*   **Rollout & Rollback**: Nada muda em produção. As únicas alterações em entradas do build do server são a linha `COPY dataflow.perf/package.json` no `Dockerfile` e as duas linhas do `.dockerignore`, exigidas pelo `--frozen-lockfile`; `docker compose --profile server build` tem de continuar passando. Reverter é apagar a pasta e as alterações listadas em "Fronteira com o resto do monorepo".

--------------------------------------------------------------------------------

### Additional Resources

*   O documento de conceito anterior (mesmo caminho, commit `d036f09`), com a análise dos seis revisores e as decisões 1 a 12 do autor. Este documento o substitui.
*   [run-job.ts](../../dataflow.server/features/runs/run-job.ts): o `RunOptions` que o worker monta, copiado pelo processo de medição.
*   [worker.ts](../../dataflow.server/supervisor/workers/worker.ts): a amostragem de memória de hoje (100 ms, RSS do worker) e os nomes de uso (`startRssBytes`, `peakRssBytes`, `cpuMs`).
*   [database-drivers.test.ts](../../dataflow.server/tests/integration/database-drivers.test.ts): os drivers contra containers, a referência para as strings de conexão.
*   [flow-file.ts](../../dataflow.core/src/flows/flow-file.ts): `flowFromYaml`, `validateFlowFile`, `toExecutableFlow`.
*   [flow-runner.ts](../../dataflow.core/src/engine/flow-runner.ts), [run-options.type.ts](../../dataflow.core/src/types/run-options.type.ts), [run-record.type.ts](../../dataflow.core/src/types/run-record.type.ts), [component-run.type.ts](../../dataflow.core/src/types/component-run.type.ts): o engine e o que ele devolve.
*   [connection-access.ts](../../dataflow.core/src/connections/connection-access.ts) e [connection-types.ts](../../dataflow.core/src/connections/connection-types.ts): os perfis de conexão.

### Future Improvements

*   **Comparação com execuções anteriores**: mediana das últimas K execuções com a mesma chave de máquina e impressão digital, tolerância `max(X %, k × dispersão)`, "ruído alto demais para julgar", `--baseline`.
*   **Mais cenários**: Lookup com duas origens, Mongo Delete, TypeScript que chama a API fake, flows aninhados em profundidade.
*   **Réguas de fila e workers**: quando Fire and Forget e workers múltiplos existirem, um modo que passe pelo server.
*   **Relatório em HTML ou no editor**.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Sem código aqui: assinaturas, formas de dado e comportamento. Caminhos relativos à raiz do repositório. Estilo dos arquivos novos igual ao do server: `imports` com `#`, um comentário de bloco no topo de cada módulo descrevendo a responsabilidade dele, sem comentários inline. Todo caminho de arquivo em tempo de execução é resolvido a partir de `PACKAGE_ROOT = dirname(import.meta.dir)` de `src/`, nunca do diretório de trabalho.

### Target Files to Create/Modify

#### Fora do pacote

##### 1. `./package.json` (Modify)

*   **Type / Scope**: Manifesto do workspace raiz.
*   **Proposed Changes**: `"dataflow.perf"` no fim de `workspaces`. Scripts, linhas finais:
    *   `"perf": "bun dataflow.perf/src/cli.ts"` (o Bun repassa ao script os argumentos depois do nome: `bun run perf in-memory-pipeline --quick`, sem `--`).
    *   `"test": "bun test --cwd=dataflow.core && bun test --cwd=dataflow.server && bun test --cwd=dataflow.editor && bun test --cwd=dataflow.perf"`.
    *   `"typecheck": "bun run --cwd=dataflow.core typecheck && bun run --cwd=dataflow.server typecheck && bun run --cwd=dataflow.editor typecheck && bun run --cwd=dataflow.perf typecheck"`.
    *   `"description": "Visual data flows: core (TS engine), server (Bun: api, supervisor, workers) and perf (engine performance scenarios, bun run perf). POC_v0/ is the proof of concept, kept for reference."`

##### 2. `./bun.lock` (Modify)

*   **Type / Scope**: Lockfile.
*   **Proposed Changes**: Regenerado por `bun install`. Ganha o workspace `dataflow.perf` e suas dependências (item 6); nenhum pacote de terceiros que já não esteja no lockfile.

##### 3. `./.dockerignore` (Modify)

*   **Type / Scope**: Build da imagem do server.
*   **Proposed Changes**: Logo após `dataflow.editor/*` / `!dataflow.editor/package.json`, três linhas: `# only the manifest: bun install --frozen-lockfile needs every workspace's package.json`, `dataflow.perf/*`, `!dataflow.perf/package.json`.

##### 4. `./dataflow.server/Dockerfile` (Modify)

*   **Type / Scope**: Build da imagem do server.
*   **Proposed Changes**: `COPY dataflow.perf/package.json dataflow.perf/` imediatamente após `COPY dataflow.editor/package.json dataflow.editor/`. O comentário `(.dockerignore keeps out node_modules, .env files, tests and the editor)` passa a terminar em `tests, the editor and the perf package)`. O `--filter '@dataflow/server'` já deixa o perf fora do `node_modules` da imagem.

##### 5. `./.gitignore` (Modify)

*   **Type / Scope**: Arquivos locais ignorados.
*   **Proposed Changes**: `dataflow.perf/results/*` e `!dataflow.perf/results/.gitkeep`.

#### O pacote

##### 6. `./dataflow.perf/package.json` (Create)

*   **Type / Scope**: Manifesto do workspace.
*   **Proposed Changes**:
    *   `"name": "@dataflow/perf"`, `"private": true`, `"version": "0.1.0"`, `"type": "module"`; sem `engines` (como o server).
    *   `"imports"`: `"#perf/*": "./src/*.ts"`, `"#scenarios/*": "./scenarios/*.ts"`, `"#fake-api/*": "./fake-api/*.ts"` (só para consumidores do lado do host; os arquivos de `fake-api/` usam caminhos relativos entre si, item 15).
    *   `"scripts"`: `"perf": "bun src/cli.ts"`, `"test": "bun test"`, `"typecheck": "tsc --noEmit"`, `"fake-api": "bun fake-api/server.ts"`.
    *   `"dependencies"`: `"@dataflow/core": "workspace:*"`, `"@dataflow/server": "workspace:*"`, `"mongodb": "^7.8.0"`, `"mssql": "^12.7.13"`, `"yaml": "^2.9.1"`.
    *   `"devDependencies"`: `"@types/bun": "^1.4.4"`, `"@types/mssql": "^12.3.0"`, `"typescript": "~7.0.2"`.

##### 7. `./dataflow.perf/tsconfig.json` (Create)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: As mesmas opções do `dataflow.server/tsconfig.json` (`ES2022`, `ESNext`, `bundler`, `strict`, `noEmit`, `skipLibCheck`, `isolatedModules`, `noUnusedLocals`, `noUnusedParameters`, `types: ["bun"]`) mais `allowImportingTsExtensions: true` (legal com `noEmit`), porque as importações `@dataflow/server/shared/runner/*.ts` levam a extensão. Sem `preserveSymlinks`: o `tsc` segue o link do workspace e type-checa os cinco arquivos do server dentro do programa do perf, com estas opções; por isso elas têm de continuar iguais às do server. `include`: `src`, `scenarios`, `fake-api`, `tests`.

##### 8. `./dataflow.perf/README.md` (Create)

*   **Type / Scope**: Documentação do pacote.
*   **Proposed Changes**: Como rodar (`bun run perf`, as cinco flags, flags sempre depois do nome do script), o que precisa (Docker Desktop com 6 GB para containers, portas 14330/27018/5195 livres), onde ficam os resultados, como limpar (`docker compose -p dataflow-perf down -v`, apagar `results/`), como criar um cenário (pasta, `scenario.ts`, YAML pelo Download do editor usando `connection: 'perf-sqlserver'` ou `'perf-mongodb'`, `data.ts` com `DATA_VERSION`), como desenvolver a API fake (`bun run fake-api`), e os avisos (Apple Silicon emulado, memória).

##### 9. `./dataflow.perf/results/.gitkeep` (Create)

*   **Type / Scope**: Pasta dos resultados.
*   **Proposed Changes**: Arquivo vazio para a pasta existir no clone.

##### 10. `./dataflow.perf/docker-compose.perf.yml` (Create)

*   **Type / Scope**: Containers do perf.
*   **Proposed Changes**: `name: dataflow-perf`. Serviços `mssql`, `mongodb`, `fake-api` como na seção Containers: imagens `mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04@sha256:<digest>` e `mongo:8.0.9@sha256:<digest>` (digests preenchidos na implementação por `docker image inspect`), `deploy.resources.limits` (`cpus: "2"`, `memory: 2560M`; `"1"`, `1024M`; `"1"`, `512M`), portas `14330:1433`, `27018:27017`, `5195:5195`, volumes nomeados `mssql` e `mongodb`, healthchecks com os comandos da seção Containers (`interval: 5s`, `retries: 36` para o `mssql`), `restart: unless-stopped`. Variáveis do SQL Server: `ACCEPT_EULA: "Y"`, `MSSQL_PID: Express`, `MSSQL_SA_PASSWORD: Perf-Passw0rd!` (a mesma constante `SA_PASSWORD` de `src/stack.ts`; o teste `stack.test.ts` confere que são iguais). Comentário no topo dizendo que é independente do `docker-compose.yml` da raiz.

#### A API fake

##### 11. `./dataflow.perf/fake-api/params.ts` (Create)

*   **Type / Scope**: Tipo compartilhado.
*   **Proposed Changes**: `type FakeApiParams = {delayMs: number; jitterMs: number; failRate: number; seed: number; page: number; size: number}` e `DEFAULT_PARAMS = {delayMs: 0, jitterMs: 0, failRate: 0, seed: 1, page: 1, size: 100}`. `parseParams(url: URL): FakeApiParams`: cada chave lida da query string, número inválido ou ausente vira o padrão, `failRate` limitado a `[0, 1]`, milissegundos negativos viram 0. `fakeApiUrl(base: string, path: string, params: Partial<FakeApiParams>): string`: escreve só as chaves passadas, em ordem alfabética (assim `parseParams(new URL(fakeApiUrl(...)))` devolve os mesmos valores com os padrões preenchidos). Importações relativas.

##### 12. `./dataflow.perf/fake-api/random.ts` (Create)

*   **Type / Scope**: PRNG determinístico.
*   **Proposed Changes**: `mulberry32(seed: number): () => number` e `hashSeed(...parts: (number | string)[]): number` (FNV-1a de 32 bits sobre os textos). Usado pela API fake (atraso e falha do item `id` saem de `mulberry32(hashSeed(seed, id))`) e, pelo alias `#fake-api/random`, pelos `data.ts` dos cenários. Sem importações.

##### 13. `./dataflow.perf/fake-api/server.ts` (Create)

*   **Type / Scope**: Servidor HTTP (Bun).
*   **Proposed Changes**: `createFakeApi(port: number): {port: number; stop(): void}` com `Bun.serve` (porta 0 escolhe uma livre; `port` devolvido é a efetiva); quando executado diretamente, usa `PORT` (padrão 5195). Rotas: `GET /health` → `200 {ok: true}`; `GET /items/:id` → `200 {id, name, price, updatedAt}` gerado por `mulberry32(hashSeed(seed, id))`; `GET /items` → `200 {page, size, items: [...]}` com a página gerada por `hashSeed(seed, page)`; `POST /items` → `200` com o corpo recebido; `GET /_stats` → `{requests, failures, p50Ms, p95Ms}`; `POST /_reset` → `204`. Em todas as rotas de `/items`: espera `delayMs + jitter`, com `jitter` em `[-jitterMs, +jitterMs]` do mesmo PRNG; com probabilidade `failRate` (do mesmo PRNG) devolve `503 {error: 'injected failure'}` e conta em `failures`. Latências medidas por `performance.now()` em volta da espera, guardadas num array zerado pelo `/_reset`. Importações relativas (`./params.ts`, `./random.ts`).

##### 14. `./dataflow.perf/fake-api/Dockerfile` (Create)

*   **Type / Scope**: Imagem da API fake.
*   **Proposed Changes**: `FROM oven/bun:1.4.4-slim` (a mesma do server), `WORKDIR /app`, `COPY params.ts random.ts server.ts ./`, `USER bun`, `EXPOSE 5195`, `CMD ["bun", "server.ts"]`. Sem `package.json` e sem `bun install`.

#### O orquestrador e a medição

##### 15. `./dataflow.perf/src/scenario.ts` (Create)

*   **Type / Scope**: Tipos do pacote.
*   **Proposed Changes**:
    *   `type ServiceName = 'mssql' | 'mongodb' | 'fake-api'`; `type Direction = 'lower-is-better' | 'higher-is-better'`; `type Ruler = {metric: string; direction: Direction; limit?: number}`.
    *   `type LoadContext = {size: number; seed: number; log(line: string): void; sqlserver?: {query(sql: string, parameters?: Record<string, unknown>): Promise<Record<string, unknown>[]>; bulk(table: string, columns: {name: string; type: import('mssql').ISqlType; nullable?: boolean}[], rows: unknown[][]): Promise<void>}; mongo?: import('mongodb').Db; fakeApi?: {reset(): Promise<void>; stats(): Promise<FakeApiStats>}}` (só os serviços do cenário vêm preenchidos; `sqlserver.query` já roda no banco `perf`).
    *   `type Scenario = {id: string; description: string; services: ServiceName[]; size: number; quickSize: number; seed: number; runs?: number; timeoutMs: number; dataVersion: number; throughputNode: string; rulers: Ruler[]; load(ctx: LoadContext): Promise<void>; reset(ctx: LoadContext): Promise<void>; input?(size: number, seed: number): unknown}`.
    *   `type FakeApiStats = {requests: number; failures: number; p50Ms: number; p95Ms: number}`.
    *   `type Sample = {iteration: number; warmup: boolean; record: RunRecord; memory: {startRssBytes: number; peakRssBytes: number; endRssBytes: number; heapStartBytes: number; heapEndBytes: number; samples: number}; cpu: {cpuMs: number; userMs: number; systemMs: number}; fakeApi?: FakeApiStats}` (o filho escreve tudo menos `warmup` e `fakeApi`, que o orquestrador anexa).
    *   `type RulerResult = {metric: string; direction: Direction; limit?: number; median?: number; min?: number; max?: number; previous?: number; verdict: 'within' | 'exceeded' | 'no-limit' | 'unavailable'}`.

##### 16. `./dataflow.perf/src/scenarios.ts` (Create)

*   **Type / Scope**: Registro.
*   **Proposed Changes**: Importa os cinco `scenario.ts` e exporta `SCENARIOS: Scenario[]` na ordem de execução (os sem container primeiro) e `scenarioById(id: string): Scenario | undefined`. Não imprime nem sai.

##### 17. `./dataflow.perf/src/cli.ts` (Create)

*   **Type / Scope**: Ponto de entrada.
*   **Proposed Changes**: `util.parseArgs` com `allowPositionals` e as opções `runs` (string → inteiro), `quick`, `strict`, `size`, `list` (booleanas). Id desconhecido ou flag inválida: lista os ids válidos no stderr e sai com 2. Uma vez: `gitInfo()` e `checkDocker()` (só se algum cenário escolhido tem serviços), `machineKey(docker)`. Por cenário, nesta ordem: `warnIfEmulated(docker)` → `ensureServices(services)` → `imageDigests(services)` → `openLoadContext(scenario)` → `ensureData(ctx, scenario, size, seed)` → `printPlan(scenario, options, lastResult(machineKey, id, size)?.median)` → para cada run (aquecimento, depois 1..N): `resetTargets(ctx, scenario)` → `measureOnce(...)` → `judge(rulers, samples sem o aquecimento e sem `status === 'failed'`, previous)` → `scenarioFingerprint(...)` → `appendResult(line)` → `printScenario(line)` → `ctx.close()`. No fim, `printSummary(lines)`. `SIGINT`/`SIGTERM`/`SIGBREAK` como o `scripts/dev.ts`: encerra o filho (`taskkill /T /F` no Windows), grava a linha com `partial: true`, sai com 130. Código de saída: 0; 1 com `--strict` e régua `exceeded` ou run `failed`; 2 em erro de infraestrutura (Docker ausente, memória insuficiente, carga falhou, filho morreu com 2).

##### 18. `./dataflow.perf/src/stack.ts` (Create)

*   **Type / Scope**: Docker.
*   **Proposed Changes**: Constantes `PACKAGE_ROOT`, `COMPOSE_FILE`, `PERF_PORTS = {mssql: 14330, mongodb: 27018, fakeApi: 5195}`, `SA_PASSWORD = 'Perf-Passw0rd!'`, `MONGO_URL = 'mongodb://127.0.0.1:27018'`, `FAKE_API_URL = 'http://127.0.0.1:5195'`, `SERVICE_LIMITS: Record<ServiceName, {cpus: number; memoryBytes: number}>` (iguais ao compose). `checkDocker(): Promise<{memTotalBytes: number; arch: string; version: string}>` via `docker info --format json` (campos `MemTotal`, `Architecture`, `ServerVersion`); lança com a correção quando o Docker não responde ou quando a soma dos `memoryBytes` dos serviços passa de `MemTotal` (quanto falta e onde mudar no Docker Desktop). `ensureServices(services)`: `docker compose -f COMPOSE_FILE up -d --wait --wait-timeout 180 <serviços>` com a saída repassada; falha vira erro com `docker compose -p dataflow-perf logs <serviço>` sugerido. `imageDigests(services): Record<string, string>` por `docker image inspect --format '{{index .RepoDigests 0}}'`; para `fake-api`, sha256 de `params.ts`, `random.ts`, `server.ts` e `Dockerfile`. `warnIfEmulated(docker)` avisa quando `arch` é `aarch64`/`arm64` e `mssql` está nos serviços. Tudo com `Bun.spawn`, `stdout: 'pipe'`.

##### 19. `./dataflow.perf/src/load.ts` (Create)

*   **Type / Scope**: Carga e reset dos dados (o `data.ts` de cada cenário é o gerador; este módulo é quem o chama).
*   **Proposed Changes**: `openLoadContext(scenario, size, seed): Promise<LoadContext & {close(): Promise<void>}>`: para `mssql`, um `ConnectionPool` do `mssql` em `master` (`Server=127.0.0.1,14330;Database=master;User Id=sa;Password=...;Encrypt=false;TrustServerCertificate=true`), `IF DB_ID('perf') IS NULL CREATE DATABASE perf`, e depois `sqlserver.query`/`sqlserver.bulk` ligados a `perf` (um segundo pool, ou `USE perf` por request); `bulk` usa `sql.Table` + `request.bulk` em blocos de 10 000 linhas. Para `mongodb`, `new MongoClient(MONGO_URL).db('perf')`. Para `fake-api`, `fetch` em `/_reset` e `/_stats`. `dataFingerprint(scenario, size, seed): string` = sha256 de `${dataVersion}:${seed}:${size}`. `ensureData(ctx, scenario, size, seed)`: sem `mssql`/`mongodb` nos serviços, não faz nada; senão lê o marcador (`SELECT fingerprint FROM dbo._perf_meta WHERE scenario = @id` / `db.collection('_perf_meta').findOne({_id: id})`), e se for igual ao hash do `max(size, scenario.size)` imprime "dados conferem, carga pulada" e volta; senão chama `scenario.load(ctx)` com `ctx.size = max(size, scenario.size)` e grava o marcador por último (`dbo._perf_meta(scenario nvarchar(64) PRIMARY KEY, fingerprint char(64), at datetime2)` / `{_id, fingerprint, at}`). `resetTargets(ctx, scenario)`: `scenario.reset(ctx)`.

##### 20. `./dataflow.perf/src/measure.ts` (Create)

*   **Type / Scope**: O lado do orquestrador da medição.
*   **Proposed Changes**: `measureOnce(scenario, {size, seed, iteration, warmup, fakeApi?}): Promise<Sample>`: `Bun.spawn([process.execPath, join(import.meta.dir, 'run-once.ts'), id, String(size), String(seed), String(iteration)], {cwd: PACKAGE_ROOT, stdout: 'pipe', stderr: 'inherit'})`; espera o fim com um timer de `scenario.timeoutMs + 30_000` que mata o filho e lança; lê o stdout inteiro, faz `JSON.parse` da última linha não vazia, define `warmup`, anexa `fakeApi` de `ctx.fakeApi.stats()` quando o cenário usa a API fake. Expõe `currentChild` para o `cli.ts` encerrar no Ctrl+C. Código de saída 2 do filho vira erro com a mensagem do stderr.

##### 21. `./dataflow.perf/src/memory-sampler.ts` (Create)

*   **Type / Scope**: Worker de amostragem.
*   **Proposed Changes**: Corpo de um `Worker` do Bun: ao receber `{type: 'start', intervalMs}` liga um `setInterval` que guarda `Math.max(peak, process.memoryUsage.rss())` e conta as amostras; ao receber `{type: 'stop'}` responde `{peakRssBytes, samples}` e encerra. Um módulo à parte porque o `Worker` precisa de um arquivo próprio.

##### 22. `./dataflow.perf/src/run-once.ts` (Create)

*   **Type / Scope**: O processo de medição.
*   **Proposed Changes**: Lê `id, size, seed, iteration` de `process.argv`. `loadFlowFiles(id)` e `executableFlows(files, id)` de `flows.ts`. Monta o `RunOptions`: `mode: 'execution'`, `id: crypto.randomUUID()`, `parameterValues: {size: String(size)}`, `input: scenario.input?.(size, seed)`, `evaluate`, `prepareScript: (code, globals) => prepareScript(code, globals, {}, {})`, `http: sendHttp`, `databases: {sqlserver: querySqlServer}`, `documentQueries: {mongodb: aggregateMongoDb}`, `documentStores: {mongodb: upsertMongoDb}`, `documentDeletes: {mongodb: deleteMongoDb}`, `secrets: PERF_SECRETS`, `connections: PERF_CONNECTIONS`, `flows`, `timeoutMs: scenario.timeoutMs`. Pré-aquecimento conforme a seção do processo de medição, por serviço do cenário e por nó `typescript` do flow principal. Depois: `Bun.gc(true)`; `memoryUsage()` inicial; `Worker` de `memory-sampler.ts` com `intervalMs: 10`; `process.cpuUsage()`; `await flowRunner(main, options)` dentro de `try` (uma exceção vira um `RunRecord` `failed` com a mensagem, como `failedRecord` faz no server); `cpuUsage(start)`; `stop` no worker e leitura final de RSS e heap; `closeSqlServerPools()` e `closeMongoClients()` (de `@dataflow/server/shared/runner/*-driver.ts`); `console.log(JSON.stringify(sample))`; `process.exit(0)`. Qualquer exceção fora do `flowRunner`: mensagem no stderr e `exit(2)`.

##### 23. `./dataflow.perf/src/flows.ts` (Create)

*   **Type / Scope**: Flows e conexões.
*   **Proposed Changes**: `loadFlowFiles(scenarioId): {path: string; text: string; file: FlowFile}[]` (lê `scenarios/<id>/flows/*.yaml` em ordem de nome, `flowFromYaml`, lança com o caminho e os erros se `ok: false` ou se o arquivo não tem `id`); `executableFlows(files, scenarioId): {main: ExecutableFlow; flows: Record<string, ExecutableFlow>}` (`toExecutableFlow(file, 'perf')`; `main` é o de `id === scenarioId`, erro se não houver; `flows` tem todos, inclusive o principal); `PERF_CONNECTIONS: Record<string, ConnectionProfileData>` e `PERF_SECRETS: Record<string, string>` com os valores de `stack.ts`. Usado pelo `run-once.ts` e pelo teste.

##### 24. `./dataflow.perf/src/metrics.ts` (Create)

*   **Type / Scope**: Extratores.
*   **Proposed Changes**: `type Extractor = (sample: Sample, scenario: Scenario) => number | undefined`; `metricOf(name: string, sample: Sample, scenario: Scenario): number | undefined`: as métricas fixas da tabela do Technical Plan; `envelopesPerSecond` soma os `outputs` do componente cujo `label` é `scenario.throughputNode` (`undefined` se não houver ou se `durationMs` for 0); `component.<label>.<activeMs|waitingMs|peakBytes>` resolvido por `record.components` (o `label` é o que fica entre o primeiro e o último `.`; `undefined` se não houver componente ou campo); `fakeApi.<requests|failures|p50Ms|p95Ms>` de `sample.fakeApi`.

##### 25. `./dataflow.perf/src/rulers.ts` (Create)

*   **Type / Scope**: Julgamento.
*   **Proposed Changes**: `median(values: number[]): number`, `spread(values): {min: number; max: number}`; `judge(rulers: Ruler[], samples: Sample[], scenario: Scenario, previous?: ResultLine): RulerResult[]`: o chamador já tirou o aquecimento e os runs `failed`; com `samples` vazio ou alguma amostra `undefined` para a métrica, `verdict: 'unavailable'`; sem `limit`, `'no-limit'`; `'exceeded'` quando a mediana passa do `limit` na direção errada (`lower-is-better`: mediana > limit; `higher-is-better`: mediana < limit); `previous` é a mediana da mesma métrica em `previous.rulers`.

##### 26. `./dataflow.perf/src/report.ts` (Create)

*   **Type / Scope**: Texto no terminal.
*   **Proposed Changes**: `printPlan(scenario: Scenario, options: {runs: number; quick: boolean; size: number}, estimateMs?: number)`, `printScenario(line: ResultLine)` (cabeçalho; tabela das réguas com métrica, mediana, mín, máx, anterior, limite, veredito; tabela dos componentes por mediana de `component.<label>.activeMs` e `waitingMs`, ordenada por `activeMs`; linha da API fake; status por run com o número de amostras de memória), `printSummary(lines: ResultLine[])`. Colunas alinhadas com `padEnd`, bytes em MB com uma casa, tempos em ms abaixo de 10 s e em s acima. Sem cores por padrão; cores só com `FORCE_COLOR`, como o `scripts/dev.ts`.

##### 27. `./dataflow.perf/src/results.ts` (Create)

*   **Type / Scope**: JSONL.
*   **Proposed Changes**: `type ResultLine` com a forma da seção Resultados e `SCHEMA_VERSION = 1`; `resultsPath(machineKey: string, dir = join(PACKAGE_ROOT, 'results')): string`; `appendResult(line: ResultLine, dir?)`; `lastResult(machineKey: string, scenarioId: string, size: number, dir?): ResultLine | undefined` (última linha do arquivo com esse cenário e tamanho e `partial: false`).

##### 28. `./dataflow.perf/src/fingerprint.ts` (Create)

*   **Type / Scope**: Identidade.
*   **Proposed Changes**: `gitInfo(): {sha: string; dirty: boolean}` (`git rev-parse HEAD`, `git status --porcelain`); `machineKey(docker: {version: string}): ResultLine['machine']` com `key` = sha256 de `cpuModel|cores|totalMemBytes|platform|release|bunVersion` (os 12 primeiros hex) e os demais campos (`dockerVersion`, `limits = SERVICE_LIMITS`) só gravados; `scenarioFingerprint(scenario, flows: {path: string; text: string}[], composeText: string, size: number, seed: number): ResultLine['fingerprint']` = `{scenario: sha256(JSON.stringify({id, services, size, seed, rulers, dataVersion}) + flowsHash), data: dataFingerprint(...), flows: flowsHash, compose: sha256(composeText)}`, com `flowsHash` = sha256 dos `text` ordenados por `path`. `node:crypto`.

#### Cenários

##### 29. `./dataflow.perf/scenarios/in-memory-pipeline/scenario.ts`, `flows/in-memory-pipeline.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário sem container.
*   **Proposed Changes**: `services: []`, `size: 300_000`, `quickSize: 30_000`, `seed: 1`, `timeoutMs: 120_000`, `throughputNode: 'Start'`, `input(size, seed)` devolve o array de `data.ts`: `{id: number; name: string; amount: number; category: 'a' | 'b'; createdAt: string}` (`DATA_VERSION = 1`). Flow: Start (`acceptsInput: true`) → Mapper (`fields: [{target: 'total', value: '$amount * 1.1', expression: true}, {target: 'year', value: '$createdAt.slice(0, 4)', expression: true}]`; itens de lista com `spread: true` são planos, `{target, value, expression}`, como em `dataflow.core/tests/helpers.ts`) → Filter (`condition: '$amount > 0'`) → Router (`cases: [{label: 'a', condition: "$category === 'a'"}]`, saída `a` e saída `else`, as duas ligadas ao mesmo TypeScript) → TypeScript (`override: true`, `code`: `function process(input) { return { ...input, total: Math.round(input.total) }; }`; sem Override o retorno iria para `DATA.result`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `cpuPercent` (lower); todas sem `limit`. `load` e `reset` vazios. As chaves de config são as de `dataflow.core/src/components/{mapper,filter,router,typescript}.ts`.

##### 30. `./dataflow.perf/scenarios/flow-invoker-fanout/scenario.ts`, `flows/flow-invoker-fanout.yaml`, `flows/perf-child-mapper.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário sem container, dois flows.
*   **Proposed Changes**: `services: []`, `size: 20_000`, `quickSize: 2_000`, `seed: 1`, `timeoutMs: 180_000`, `throughputNode: 'Start'`, `input` = array de `{id: number; amount: number}` (`DATA_VERSION = 1`). Principal: Start (`acceptsInput: true`) → Flow Invoker (`config: {flowId: 'perf-child-mapper', parameters: [], sendEnvelope: true}`) → End. Filho (`id: perf-child-mapper`): Start (`acceptsInput: true`) → Mapper (`fields: [{target: 'double', value: '$amount * 2', expression: true}]`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `component.Flow Invoker.waitingMs` (lower).

##### 31. `./dataflow.perf/scenarios/sqlserver-to-mongodb/scenario.ts`, `flows/sqlserver-to-mongodb.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com dois bancos.
*   **Proposed Changes**: `services: ['mssql', 'mongodb']`, `size: 100_000`, `quickSize: 10_000`, `seed: 1`, `timeoutMs: 300_000`, `throughputNode: 'SQL Server Query'`. `data.ts`: linhas `{id: number; name: string; email: string; balance: number; since: Date}` (`DATA_VERSION = 1`). `load`: `DROP TABLE IF EXISTS dbo.Customer`, `CREATE TABLE dbo.Customer (id int PRIMARY KEY, name nvarchar(80), email nvarchar(120), balance decimal(12,2), since datetime2)`, `ctx.sqlserver.bulk('dbo.Customer', colunas, linhas)`. `reset`: `ctx.mongo.collection('customers').deleteMany({})`. Flow: Start (`parameters: [{name: 'size', type: 'number', default: '100000'}]`; o `default` é texto, como `startConfig` lê, e o tipo `number` faz `$PARAMETERS.size` chegar como número) → SQL Server Query (`connection: 'perf-sqlserver'`, `sql: 'SELECT id, name, email, balance, since FROM dbo.Customer WHERE id <= @size ORDER BY id'`, `parameters: [{name: 'size', value: '$PARAMETERS.size', expression: true}]`) → Mapper (`fields: [{target: 'fullName', value: '$name.toUpperCase()', expression: true}, {target: 'balanceCents', value: 'Math.round($balance * 100)', expression: true}]`) → MongoDB Upsert (`connection: 'perf-mongodb'`, `database: ''`, `collection: 'customers'`, `filter: [{field: 'id', value: '$id', expression: true}]`, `source: 'data'`, `batchSize: 500`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `component.SQL Server Query.waitingMs` (lower), `component.MongoDB Upsert.waitingMs` (lower).

##### 32. `./dataflow.perf/scenarios/mongodb-pipeline-aggregate/scenario.ts`, `flows/mongodb-pipeline-aggregate.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com MongoDB.
*   **Proposed Changes**: `services: ['mongodb']`, `size: 200_000`, `quickSize: 20_000`, `seed: 1`, `timeoutMs: 300_000`, `throughputNode: 'MongoDB Pipeline'`. `data.ts`: documentos `{orderId: number; customerId: number; status: 'paid' | 'cancelled'; total: number; items: {sku: string; qty: number}[]; placedAt: Date}` com `placedAt` entre 2025-01-01 e 2025-12-31 e `customerId` em `[1, size / 20]` (`DATA_VERSION = 1`). `load`: `drop()` da coleção `orders`, `insertMany` em blocos de 10 000 (`ordered: false`), índice em `{placedAt: 1}`. `reset` vazio (só leitura). Flow: Start (`parameters: [{name: 'size', type: 'number', default: '200000'}]`) → MongoDB Pipeline (`connection: 'perf-mongodb'`, `database: ''`, `collection: 'orders'`, pipeline: `[{$match: {placedAt: {$gte: {$date: '2025-01-01T00:00:00Z'}}}}, {$sort: {orderId: 1}}, {$limit: $PARAMETERS.size}, {$group: {_id: '$customerId', total: {$sum: '$total'}, orders: {$sum: 1}, cancelled: {$sum: {$cond: [{$eq: ['$status', 'cancelled']}, 1, 0]}}}}]`; o texto do pipeline é uma expressão JS avaliada por envelope (`pipelineExpression` de `mongodb-pipeline.ts`), por isso `$PARAMETERS.size` entra direto) → Filter (`condition: '$cancelled < $orders'`) → Aggregate (`size: 500`, `field: 'items'`) → TypeScript (`override: true`, `function process(input) { return { count: input.items.length, total: input.items.reduce((s, i) => s + i.total, 0) }; }`) → Sort (`keys: [{value: '$total', direction: 'desc'}]`) → Limit (`mode: 'top'`, `count: 100`) → End. O `throughputNode` conta os grupos que saem do pipeline (≈ `size` ÷ 20), não os documentos lidos; a coluna de tamanho da tabela de cenários é o que o banco lê. Réguas: `durationMs` (lower), `memoryDeltaBytes` (lower), `component.Aggregate.peakBytes` (lower), `component.Sort.peakBytes` (lower), `component.MongoDB Pipeline.waitingMs` (lower).

##### 33. `./dataflow.perf/scenarios/http-slow-api/scenario.ts`, `flows/http-slow-api.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com a API fake.
*   **Proposed Changes**: `services: ['fake-api']`, `size: 2_000`, `quickSize: 200`, `seed: 7`, `timeoutMs: 180_000`, `throughputNode: 'Start'`, `input` = array de `{id: number}` (`DATA_VERSION = 1`). `scenario.ts` exporta `FAKE_API_PARAMS: Partial<FakeApiParams> = {delayMs: 20, jitterMs: 10, failRate: 0.02, seed: 7}`. `load` vazio; `reset`: `ctx.fakeApi.reset()`. Flow: Start (`acceptsInput: true`) → HTTP Request (`method: 'GET'`, `url: {value: '`http://127.0.0.1:5195/items/${$id}?delayMs=20&failRate=0.02&jitterMs=10&seed=7`', expression: true}` (um template literal avaliado por envelope; com `expression: false` o `$id` iria literal na URL), `concurrency: 8`, `failOnError: true`, `onError: 'divert'`, porta de erro ligada a um Discard) → Mapper (`fields: [{target: 'price', value: '$response.body.price', expression: true}]`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `component.HTTP Request.waitingMs` (lower), `fakeApi.p95Ms` (lower), `fakeApi.failures` (lower).

#### Testes (rodam no `bun run test` da raiz, sem Docker)

##### 34. `./dataflow.perf/tests/flows.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Para cada cenário de `SCENARIOS`: todos os YAML passam por `flowFromYaml` com `ok: true` (falha com o caminho e os erros); existe um flow com `id` igual ao id do cenário; cada `config.flowId` de um Flow Invoker aponta para um `id` presente na pasta; cada `config.connection` não vazio está em `PERF_CONNECTIONS`; `componentIssues(type, config)` do core não devolve problema para nenhum nó; todo item de lista com `spread` (campos do Mapper, parâmetros do SQL Server, filtro do Upsert, parâmetros do Flow Invoker) é plano, com `expression` booleano no próprio item (o `componentIssues` não pega a forma aninhada, e ela faria o engine tratar o objeto como valor literal); existe um componente com `label === throughputNode`; no `http-slow-api`, `parseParams(new URL(url do nó HTTP Request com '${$id}' trocado por '1'))` é igual a `{...DEFAULT_PARAMS, ...FAKE_API_PARAMS}`; `flowRunner(toExecutableFlow(file, 'perf'), {mode: 'execution', id, evaluate, signal: já abortado})` resolve com `status === 'failed'` sem lançar (o engine aceita o flow e falha de forma controlada por falta de drivers e pelo sinal).

##### 35. `./dataflow.perf/tests/metrics.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Uma `Sample` fabricada com dois componentes: `envelopesPerSecond` usa o `throughputNode`; `memoryDeltaBytes` é pico menos início; `component.X.activeMs` de um label inexistente é `undefined`; `fakeApi.*` é `undefined` sem `fakeApi`; label com ponto no nome resolve.

##### 36. `./dataflow.perf/tests/rulers.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Mediana de N par e ímpar; `within`/`exceeded` nas duas direções; `no-limit` sem `limit`; `unavailable` quando uma amostra não tem a métrica, mesmo com `limit`, e quando `samples` está vazio; `previous` preenchido a partir de uma `ResultLine` anterior.

##### 37. `./dataflow.perf/tests/fake-api.test.ts` (Create)

*   **Type / Scope**: Teste de integração local (sem Docker).
*   **Proposed Changes**: `const api = createFakeApi(0)`; o mesmo `id` com a mesma `seed` dá o mesmo atraso e a mesma decisão de falha em duas rodadas após `/_reset`, mesmo com as requisições disparadas em ordem diferente; `failRate: 0` nunca falha; `/_stats` conta requisições e falhas; `parseParams` ignora valores inválidos e limita `failRate`; `parseParams(new URL(fakeApiUrl(base, path, p)))` devolve `{...DEFAULT_PARAMS, ...p}`. `api.stop()` no fim.

##### 38. `./dataflow.perf/tests/results.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Com `dir` numa pasta temporária: `appendResult` escreve uma linha JSON por chamada com `schemaVersion: 1`; `lastResult` devolve a última do cenário e tamanho pedidos e ignora `partial: true`; `scenarioFingerprint` muda quando o texto de um YAML muda e não muda quando só a ordem da lista muda; `machineKey` não muda quando só `dockerVersion` muda.

##### 39. `./dataflow.perf/tests/stack.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Lê o `docker-compose.perf.yml` com `yaml` e confere: `name: dataflow-perf`; nenhuma porta publicada igual a 5180, 5190 ou 5432, e as publicadas são as de `PERF_PORTS`; `MSSQL_SA_PASSWORD` igual a `SA_PASSWORD`; `deploy.resources.limits.memory` de cada serviço, convertido de `M`/`G` para bytes, igual a `SERVICE_LIMITS[serviço].memoryBytes`; toda `image` tem tag fixa e `@sha256:` (nada de `latest`).

### Verification Plan

*   **Compilation/Build**: `bun install` (lockfile só com o workspace novo); `bun run typecheck` na raiz, incluindo o perf (as importações de `@dataflow/server/shared/runner/*.ts` resolvem); `docker compose --profile server build` continua passando com o Dockerfile alterado.
*   **Unit Tests**: `bun run test` na raiz roda os testes do perf sem Docker; `bun test --cwd=dataflow.perf` isolado.
*   **Static Analysis & Linting**: Não há linter na raiz hoje; o typecheck com `noUnusedLocals` e `noUnusedParameters` é o que existe.
*   **Test Coverage Requirement**: Nenhuma meta numérica. O que precisa estar coberto: validação dos flows de todos os cenários, extratores, julgamento das réguas, determinismo da API fake, formato do JSONL, invariantes do compose.
*   **E2E/Integration (manual, com Docker)**:
    1. `bun run perf --list` lista cinco cenários.
    2. `bun run perf in-memory-pipeline --quick` termina em menos de 1 minuto sem tocar no Docker, grava uma linha em `results/` e mostra o pico de memória acima do início com mais de 100 amostras (o `Worker` amostrou durante o flow).
    3. `bun run perf sqlserver-to-mongodb` sobe só `mssql` e `mongodb` (`docker ps` não mostra `fake-api`), carrega os dados uma vez (a segunda execução, e também `--quick`, imprimem "dados conferem, carga pulada"), e `docker compose -p dataflow ps` do dev fica como estava.
    4. `bun run perf` completo com os containers já em execução: tempo total anotado no relatório (meta: abaixo de 15 minutos; informativo).
    5. `Ctrl+C` no meio de um cenário deixa uma linha com `partial: true` e os containers em execução.
    6. Em `scenarios/in-memory-pipeline/scenario.ts`, pôr `limit: 1` na régua `durationMs`; `bun run perf in-memory-pipeline --quick --strict` sai com código 1 e o veredito `exceeded`; reverter.
    7. Com `bun run dev` rodando ao mesmo tempo, o editor em :5180 continua funcionando durante o passo 3.
    8. `bun run perf http-slow-api --quick` duas vezes: `fakeApi.failures` igual nas duas.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
