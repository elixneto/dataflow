# dataflow.perf: cenários de performance do engine

*   **Author:** Élix Neto
*   **Status:** Proposed
*   **Date:** 2026-11-05

--------------------------------------------------------------------------------

## Overview

`dataflow.perf` é um pacote do monorepo que roda cenários de performance do engine do dataflow com `bun run perf`. Cada cenário é um ou mais flows em arquivo (o YAML que o Download do editor gera), com dados gerados de forma determinística, executados pelo `flowRunner` do core num processo Bun novo, contra MongoDB, SQL Server e uma API HTTP fake que ficam em containers próprios com limite de CPU e RAM. O relatório sai em texto no terminal: para cada run, os números de tempo, memória, CPU e envelopes por segundo contra as réguas do cenário. Os resultados ficam num arquivo local, fora do git.

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
*   Abrir as runs do perf no editor ou apontar "o componente que mais mudou": as runs não passam pelo server (não existem lá) e não há comparação nesta versão.
*   Monitorar produção.

## Open Questions

*   **Conversão de versões antigas do flow**: `validateFlowFile` recusa qualquer versão diferente de 1 e ainda não existe conversão. Isso precisa existir no core antes de a versão 2 do formato aparecer, ou os cenários quebram. Fora do escopo deste design, mas é uma dependência.
*   **Métricas de memória por componente**: `ComponentRun.memory.peakBytes` existe no core. Falta confirmar se ele serve como régua ou só como informação, dado que mede amostras de envelopes e não o processo.
*   **Formato dos flows de cenário**: o brief diz `flows/*.yaml` nos Goals e "JSON estáticos" nas Key Decisions. Este design usa YAML (o formato do Download, lido por `flowFromYaml`); "estático" aqui quer dizer versionado no repositório, nunca no banco. A confirmar com o autor.
*   **Tag fixa das imagens**: a tag exata do SQL Server 2022 (um CU específico) e do MongoDB 8.0 é escolhida na implementação, pelo digest do dia; o design só exige que seja fixa e que o digest fique gravado em cada resultado.

## Critical User Journeys (CUJs)

### CUJ 1: Primeira execução num clone novo

*   **Given**: Repositório clonado, `bun install` feito, Docker Desktop rodando com pelo menos 6 GB para containers, nenhuma imagem do perf baixada.
*   **When**: `bun run perf sqlserver-to-mongodb`.
*   **Then**: O comando confere Docker e memória, sobe só `mssql` e `mongodb` do `docker-compose.perf.yml` (baixando as imagens), espera os healthchecks, gera e carrega os dados do cenário (uma vez; nas próximas vezes a carga é pulada porque a impressão digital dos dados confere), roda 1 aquecimento e 5 runs em processos Bun novos, zerando a coleção de destino antes de cada um, e imprime a tabela de métricas contra as réguas, com mediana e dispersão. Uma linha vai para `dataflow.perf/results/<máquina>.jsonl`. Sai com código 0. Os containers continuam de pé; o ambiente de dev (`bun run dev`, :5180, :5190, :5432) não foi tocado.

### CUJ 2: Checar uma mudança no engine enquanto desenvolve

*   **Given**: Containers do perf já de pé de uma execução anterior; uma alteração local no Mapper do core, ainda sem commit.
*   **When**: `bun run perf in-memory-pipeline --quick`.
*   **Then**: Nenhum container é tocado (o cenário não precisa de nenhum). Rodam 2 runs sem aquecimento num tamanho menor. O relatório sai em menos de um minuto, com a linha de resultado marcada como `<sha>-dirty`. A pessoa compara de olho com o relatório que tinha antes da alteração.

### CUJ 3: Mudança no formato do flow

*   **Given**: Um commit no core muda `FLOW_FILE_VERSION` para 2 sem conversão da versão 1.
*   **When**: `bun run test` na raiz.
*   **Then**: O teste `dataflow.perf/tests/flows.test.ts` falha para cada flow de cenário, dizendo qual arquivo e qual erro `validateFlowFile` devolveu. A quebra aparece no dia a dia, não numa execução de perf meses depois.

## Technical Plan (Architecture)

### Visão geral

O `dataflow.perf` é um workspace Bun (`@dataflow/perf`) com três partes: um **orquestrador** (`src/cli.ts`), um **processo de medição** por run (`src/run-once.ts`) e uma **API HTTP fake** (`fake-api/`) que vive num container. O orquestrador nunca roda um flow: ele sobe containers, carrega dados, zera destinos, dispara o processo de medição N+1 vezes, agrega e imprime. O processo de medição é o único lugar onde o `flowRunner` do core executa, e morre no fim de cada run, por isso cada run começa com a memória limpa.

```text
bun run perf [cenário...] [--runs N] [--quick] [--strict] [--size S] [--list]
        │
        ▼
┌──────────────────────── dataflow.perf/src/cli.ts (orquestrador) ────────────────────────┐
│ 1. lê o registro de cenários (scenarios/*/scenario.ts)                                  │
│ 2. confere `docker info` e a memória do Docker contra os limites dos serviços do cenário│
│ 3. `docker compose -f docker-compose.perf.yml up -d --wait <serviços do cenário>`       │
│ 4. carga dos dados (data.ts → bulk insert / insertMany), pulada se o marcador confere   │
│ 5. para cada run (1 aquecimento + N):                                                   │
│      zera destinos ─► Bun.spawn(run-once.ts, cenário, size, seed) ─► lê JSON do stdout  │
│ 6. mediana e dispersão ─► réguas ─► relatório no terminal ─► linha no results/*.jsonl   │
└───────────────┬──────────────────────────────────────────┬──────────────────────────────┘
                │ processo Bun novo por run                 │ docker compose (projeto dataflow-perf)
                ▼                                           ▼
┌──── src/run-once.ts (medição) ────┐     ┌─────────────────────────────────────────────┐
│ flows YAML ─► flowFromYaml        │     │ mssql     :14330  2 CPU / 2,5 GB  vol. mssql │
│          ─► toExecutableFlow      │ ──► │ mongodb   :27018  1 CPU / 1 GB    vol. mongo │
│ RunOptions: evaluate, prepareScript│     │ fake-api  :5195   1 CPU / 512 MB (Bun)      │
│   drivers de dataflow.server/     │     └─────────────────────────────────────────────┘
│   shared/runner, connections,     │
│   flows (Flow Invoker), secrets   │
│ amostra RSS a cada 10 ms;         │
│ process.cpuUsage() antes/depois   │
│ flowRunner(...) ─► RunRecord      │
│ stdout: 1 JSON {record, memory,   │
│   cpu} e sai                      │
└───────────────────────────────────┘
```

### O orquestrador (`src/cli.ts`)

Lê os argumentos com `util.parseArgs` (Node, disponível no Bun). Sem cenário, roda todos na ordem do registro. Flags: `--runs N` (padrão: o `runs` do cenário, senão 5), `--quick` (N = 2, sem aquecimento, tamanho `quickSize` do cenário), `--strict` (código de saída 1 quando alguma régua com meta estoura), `--size S` (substitui o tamanho do cenário), `--list` (imprime os cenários, seus serviços e réguas e sai). Roda a partir da raiz (`bun run perf` na raiz chama `bun dataflow.perf/src/cli.ts`), e resolve seus caminhos por `import.meta.url`, como o `scripts/dev.ts` faz.

Antes de cada cenário, imprime o que vai fazer (serviços, tamanho, N) e uma estimativa de tempo: a mediana do último resultado do mesmo cenário e tamanho no arquivo JSONL desta máquina, se existir; senão "sem estimativa". Isso só lê o arquivo; não é comparação nem alerta.

`Ctrl+C` mata o processo de medição em andamento (no Windows, `taskkill /T /F`, como o `scripts/dev.ts`), grava a linha JSONL com `partial: true` e as amostras que já tem, e sai. Os containers ficam de pé.

### O processo de medição (`src/run-once.ts`)

Recebe por argumentos o id do cenário, o tamanho, a seed e o número da iteração. Monta tudo o que o engine precisa e só então começa a medir:

*   **Flows**: cada `scenarios/<id>/flows/*.yaml` passa por `flowFromYaml` (falha fecha o processo com erro claro) e `toExecutableFlow(file, 'perf')`, com o `id` do arquivo mantido. O flow com o nome do cenário é o principal; os outros entram no mapa `flows` do `RunOptions` para o Flow Invoker (`config.flowId` de cada nó aponta para esses ids fixos).
*   **Conexões**: o mapa `connections` tem dois perfis fixos, `perf-sqlserver` (tipo `sqlserver`, host `127.0.0.1`, porta 14330, banco `perf`, usuário `sa`, `encrypt` off, `trustServerCertificate` on, senha pelo segredo `PERF_SA_PASSWORD`) e `perf-mongodb` (tipo `mongodb`, `connectionString` pelo segredo `PERF_MONGO_URL`, banco `perf`). Os valores dos segredos ficam em `src/stack.ts` (constantes, não são credenciais de nada fora do container local). Os nós dos flows usam `connection: 'perf-sqlserver'` ou `'perf-mongodb'`.
*   **Drivers**: os mesmos que o worker usa, importados do pacote `@dataflow/server` por caminho (`@dataflow/server/shared/runner/sqlserver-driver.ts` etc.): `querySqlServer`, `aggregateMongoDb`, `upsertMongoDb`, `deleteMongoDb`, `sendHttp`, `evaluate`, `prepareScript`. O `RunOptions` fica igual ao do `runJob` do server, sem `onProgress` (ele copia o estado várias vezes por segundo e isso mediria o editor, não o engine), com `mode: 'execution'` e `timeoutMs` igual ao `timeoutMs` do cenário.
*   **Entrada**: o cenário pode dar um `input` (array gerado por `data.ts`) quando o Start aceita entrada; é assim que os cenários sem container alimentam o flow.

A medição em si:

1. `process.memoryUsage()` completo uma vez (início: `rss`, `heapUsed`).
2. Um `setInterval` de 10 ms guardando o máximo de `process.memoryUsage.rss()` (a função rápida, só RSS). O engine roda envelope por envelope com `await` entre eles, então o intervalo dispara; um trecho síncrono maior que 10 ms (um `Sort` de muitos envelopes) esconde seu pico, e o relatório diz quantas amostras foram perdidas (esperadas menos efetivas).
3. `process.cpuUsage()` antes e depois (user + system).
4. `await flowRunner(...)`.
5. Para o intervalo, mais uma leitura de RSS (o fim) e de `heapUsed`.
6. Fecha pools e clients (`closeSqlServerPools`, `closeMongoClients`) e escreve no stdout **uma linha JSON** com o `RunRecord` inteiro (status, `durationMs`, componentes com `activeTimeMs`, `waitingMs`, `inputs`, `outputs`, `memory`), a memória (início, pico, fim, amostras esperadas e efetivas) e a CPU. Logs do engine e erros vão para o stderr. Código de saída 0 se o run terminou (mesmo `failed`: o orquestrador decide), 2 se o processo em si quebrou.

A amostragem fica no próprio processo e não no pai por dois motivos: não há forma portátil de ler o RSS de outro processo sem shell (`/proc` no Linux, `Get-Process` no Windows, `ps` no macOS), e o custo da leitura é baixo. O preço é o ponto 2 acima, e ele fica visível no relatório.

### Cenários (`scenarios/<id>/`)

Cada cenário é uma pasta com:

*   `scenario.ts`: exporta um `Scenario` com `id`, `description`, `services` (subconjunto de `['mssql', 'mongodb', 'fake-api']`), `size` e `quickSize`, `seed`, `runs` (opcional; o padrão é 5 e `--runs` sobrepõe), `timeoutMs`, `rulers`, e funções `load(ctx)` (carga inicial dos dados), `reset(ctx)` (zera os destinos antes de cada run) e `input(size, seed)` (opcional, a entrada do Start).
*   `flows/*.yaml`: um ou mais flows no formato do Download. O flow principal tem `id` igual ao id do cenário.
*   `data.ts`: o gerador determinístico (um PRNG `mulberry32` pela seed; nunca `Math.random`) e a constante `DATA_VERSION`, que entra na impressão digital dos dados.

Os cinco cenários iniciais:

| Cenário | Serviços | O que mede | Tamanho (quick) |
|---|---|---|---|
| `in-memory-pipeline` | nenhum | Start com entrada → Mapper → Filter → Router → TypeScript → End. CPU e alocação do engine puro. | 300 000 (30 000) envelopes |
| `flow-invoker-fanout` | nenhum | Start com entrada → Flow Invoker (flow filho com Mapper) → End. Custo de um `flowRunner` por envelope. | 20 000 (2 000) envelopes |
| `sqlserver-to-mongodb` | mssql, mongodb | SQL Server Query (stream com backpressure) → Mapper → MongoDB Upsert (lote 500). O caminho de carga típico. | 100 000 (10 000) linhas |
| `mongodb-pipeline-aggregate` | mongodb | MongoDB Pipeline → Filter → Aggregate → Sort → Limit → End. Acumuladores e a memória que eles seguram. | 200 000 (20 000) documentos |
| `http-slow-api` | fake-api | Start com entrada (ids) → HTTP Request (8 ao mesmo tempo, 20 ms ± 10 ms, 2 % de falhas com On error) → Mapper → End. Espera externa e tratamento de erro. | 2 000 (200) requisições |

Os dois primeiros não precisam de Docker e são o smoke test de qualquer máquina.

### Dados e destinos

A carga é feita pelo orquestrador, nunca pelo dataflow: SQL Server por `mssql` em lote (`sql.Table` + `request.bulk`, 10 000 linhas por chamada); MongoDB por `insertMany` sem ordem, 10 000 por chamada. Cada carga grava um marcador (`dbo._perf_meta` no SQL Server, coleção `_perf_meta` no MongoDB) com a chave `cenário/tamanho/seed` e a impressão digital dos dados: hash de `DATA_VERSION`, seed e tamanho. No início de cada cenário o orquestrador lê o marcador; se confere, não carrega de novo. Os volumes nomeados do compose guardam os dados entre execuções e entre reinícios do Docker.

`reset(ctx)` zera só os destinos: `deleteMany({})` na coleção que o Upsert escreve; `TRUNCATE TABLE` se um cenário futuro escrever no SQL Server; `POST /_reset` na API fake. As origens não são tocadas.

### A API fake (`fake-api/`)

Um servidor `Bun.serve` numa imagem própria (`oven/bun`, mesma versão do `Dockerfile` do server), subido pelo compose com 1 CPU e 512 MB. Sem dependências. Rotas:

*   `GET /items/:id` e `GET /items?page=&size=`: devolve itens gerados pela seed; com `delayMs`, `jitterMs`, `failRate` e `seed` na query string. O jitter e a decisão de falhar saem de um PRNG alimentado por `seed` e pelo número da requisição, então duas execuções com a mesma seed veem a mesma sequência de atrasos e falhas.
*   `POST /items`: ecoa o corpo depois do mesmo atraso.
*   `GET /_stats`: contadores (requisições, falhas devolvidas, latência p50 e p95 medida dentro do servidor) desde o último reset; `POST /_reset` zera. `GET /health` para o healthcheck.

Os parâmetros da query string são um tipo `FakeApiParams` em `fake-api/params.ts`, usado pelo servidor para ler e pelos cenários para montar a URL (`fakeApiUrl(params)`), para que um nome errado quebre no typecheck. O relatório inclui o `/_stats` de cada run, para se ver quando a API, e não o engine, é o gargalo.

### Métricas, réguas e relatório

Uma **amostra** é o JSON de um run. Um **registro de extratores** (`src/metrics.ts`) transforma a amostra em métricas nomeadas, cada uma `number | undefined`:

| Métrica | De onde vem |
|---|---|
| `durationMs` | `record.durationMs` (o relógio do engine) |
| `envelopesPerSecond` | soma dos `outputs` do nó Start ÷ `durationMs` × 1000 |
| `cpuMs` | `cpuUsage` user + system |
| `cpuPercent` | `cpuMs` ÷ `durationMs` × 100 |
| `memoryStartBytes`, `memoryPeakBytes`, `memoryEndBytes` | amostragem de RSS |
| `memoryDeltaBytes` | pico menos início (a régua de memória) |
| `memorySamplesLost` | amostras esperadas (`durationMs` ÷ 10) menos efetivas |
| `component.<label>.activeMs`, `component.<label>.waitingMs` | `ComponentRun.activeTimeMs`, `waitingMs` |
| `component.<label>.peakBytes` | `ComponentRun.memory.peakBytes` (informativo, ver Open Questions) |
| `fakeApi.requests`, `fakeApi.failures`, `fakeApi.p95Ms` | `/_stats`, só quando o cenário usa a API fake |

Uma **régua** é `{metric, direction: 'lower-is-better' | 'higher-is-better', limit?: number}`. O julgamento usa a **mediana** das N runs. Sem `limit`, a linha mostra o valor e "sem meta" (o estado inicial de todos os cenários, até os primeiros números). Métrica `undefined` mostra "indisponível" e nunca conta como estouro. Um run com `record.status === 'failed'` marca o cenário como falho no relatório e no JSONL, e `--strict` sai com 1.

O relatório é texto puro: cabeçalho do cenário (commit, dirty, máquina, serviços, tamanho, N), uma tabela com as réguas (métrica, mediana, mín, máx, meta, dentro/fora/sem meta/indisponível), uma tabela dos componentes (mediana de ativo e espera por componente, ordenada por ativo), a linha da API fake quando houver, e o status de cada run. No fim de tudo, um resumo por cenário.

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
  rulers: [ { metric, direction, limit, median, min, max, verdict } ] }
```

A chave da máquina é um hash de modelo de CPU, núcleos, RAM total, sistema e versão, versão do Bun, versão do Docker e limites do compose. A impressão digital do cenário é um hash dos YAML dos flows, de `DATA_VERSION`, seed, tamanho, réguas, serviços e do próprio `docker-compose.perf.yml`. Os digests saem de `docker image inspect`. Nada disso é comparado nesta versão; está aí para a versão que comparar.

### Containers (`docker-compose.perf.yml`)

Projeto `name: dataflow-perf`, arquivo próprio dentro de `dataflow.perf/`. Três serviços, cada um com `deploy.resources.limits` (o `docker compose` v2 aplica `cpus` e `memory` sem Swarm), healthcheck e volume nomeado:

*   `mssql`: `mcr.microsoft.com/mssql/server:2022-<CU fixo>` com `ACCEPT_EULA=Y`, `MSSQL_PID=Express`, `MSSQL_SA_PASSWORD` fixa, porta `14330:1433`, 2 CPUs, 2,5 GB; healthcheck com `sqlcmd -C -Q "SELECT 1"` (o Express exige os mesmos 2 GB para subir; o limite fica acima disso).
*   `mongodb`: `mongo:8.0.<x>`, porta `27018:27017`, 1 CPU, 1 GB; healthcheck `mongosh --eval "db.runCommand({ping:1})"`.
*   `fake-api`: `build: ./fake-api`, porta `5195:5195`, 1 CPU, 512 MB; healthcheck por `bun -e fetch(...)`, como o server faz.

`docker compose up -d --wait <serviços>` sobe só os que o cenário lista e volta quando os healthchecks passam. O orquestrador imprime, antes, quanto de memória os serviços pedem e quanto o Docker tem (`docker info --format '{{.MemTotal}}'`), e para com uma mensagem de correção quando não cabe. O SQL Server não tem imagem ARM64: em Apple Silicon o orquestrador avisa que roda emulado e que os números não se comparam, e segue.

### O que muda fora do pacote

*   `package.json` da raiz: `dataflow.perf` nos `workspaces`; scripts `perf`, e `test` e `typecheck` passam a incluir o perf.
*   `dataflow.server/Dockerfile` e `.dockerignore`: o `bun install --frozen-lockfile` dentro da imagem exige o `package.json` de todos os workspaces do lockfile. O Dockerfile copia `dataflow.perf/package.json`; o `.dockerignore` deixa de fora todo o resto de `dataflow.perf/`, como já faz com o editor. O perf não traz dependência nova (usa `mssql` e `mongodb` pelo `@dataflow/server`, `yaml` pelo `@dataflow/core`), então o lockfile só ganha o workspace.
*   `.gitignore`: `dataflow.perf/results/`.
*   Nada no core nem no server muda. O único acoplamento é a importação dos drivers, coberta pelo `bun run typecheck`.

## Alternatives Considered

### Alternative A: Rodar os cenários pelo servidor (API → fila → supervisor → worker)

*   **Pros**: Mede o caminho que a produção usa; é o único jeito de ver fila, workers e, no futuro, Fire and Forget.
*   **Cons**: Soma à medida o NOTIFY e o poll de 5 s do supervisor (um NOTIFY perdido são 5 s a mais), a reutilização do worker por até 100 runs (memória de runs anteriores no pico) e a cópia do progresso para o Postgres. Exige um server e um Postgres de perf de pé, e os flows no banco, com ids que mudam a cada seed.
*   **Reason for Rejection**: Rejected by author: o ruído da fila e do worker atrapalha justamente a comparação que o perf quer permitir. Fila e workers ficam para quando houver o que medir neles (Non-Goals).

### Alternative B: v0 mínima com Testcontainers, sem pacote nem compose

*   **Pros**: Reaproveita `tests/integration/database-drivers.test.ts`; sem workspace novo, sem compose, sem Dockerfile mexido; menos arquivos.
*   **Cons**: Testcontainers sobe e derruba os containers a cada execução: o SQL Server leva 30 a 60 s para subir e os dados teriam de ser recarregados sempre (ou depender do modo de reutilização do Testcontainers, que não é padrão e não isola portas). Um script dentro de `dataflow.server/tests` entraria no `bun test` do server ou precisaria de uma exclusão. Sem lugar para o `results/` fora do git nem para a API fake.
*   **Reason for Rejection**: Rejected by author: os containers precisam ficar de pé entre execuções e os dados precisam sobreviver, e isso é o que um compose próprio dá. A parte boa da proposta (engine no próprio processo, N runs, uma linha JSON) foi adotada.

### Alternative C: Perfil `perf` dentro do `docker-compose.yml` atual

*   **Pros**: Um arquivo de compose só; `docker compose --profile perf up`.
*   **Cons**: Divide o projeto `dataflow`, a rede e o `docker compose down` com o ambiente de dev; qualquer `down -v` apaga o volume do Postgres do dev. Portas e volumes teriam de ser nomeados para não colidir mesmo assim.
*   **Reason for Rejection**: Rejected by author: o perf não pode tocar no Postgres nem nas portas do dev. Um projeto compose separado (`name: dataflow-perf`) é a única forma de garantir isso com `docker compose down`.

### Alternative D: Flows de cenário criados no banco pelo seed de dev (projeto "Lab")

*   **Pros**: Os flows aparecem no editor para serem editados.
*   **Cons**: Dependem do server e do Postgres; não ficam no git; uma mudança de formato os deixa ilegíveis sem ninguém notar; os ids de conexão e de flow mudam a cada seed.
*   **Reason for Rejection**: Rejected by author: os flows ficam em arquivos versionados dentro do perf, com ids fixos, e nunca vão para o banco. Quem quiser editar um no editor pode fazer Upload do YAML e Download de volta.

### Alternative E: Flows de cenário montados em TypeScript (objetos `ExecutableFlow`), não em arquivos

*   **Pros**: Typecheck dos configs; sem parse.
*   **Cons**: Não passa por `validateFlowFile`, então uma mudança de formato de arquivo não quebraria o teste do dia a dia (um dos Goals); não se edita no editor; posições e grupos teriam de ser inventados para um Upload.
*   **Reason for Rejection**: Rejected by author (via a decisão "ler os flows só pelas funções do core"): o YAML do Download é o formato que o core lê e que o teste `flows.test.ts` valida.

### Alternative F: Ler as métricas do Postgres do server

*   **Pros**: Reaproveita o que o server já grava por run.
*   **Cons**: Acopla o perf ao esquema (já na migração 6) e exige o server rodando.
*   **Reason for Rejection**: Rejected by author: com o engine no processo, o `RunRecord` vem direto do `flowRunner`, sem banco.

### Alternative G: Comparar com o commit anterior e alertar regressão

*   **Pros**: Dá um veredito automático.
*   **Cons**: Variação de 10 a 30 % na mesma máquina gera alarme por ruído; deriva lenta passa; exige base por máquina, tolerância por dispersão e marcação de dirty, isto é, um subsistema inteiro.
*   **Reason for Rejection**: Rejected by author: adiado, não descartado. O JSONL guarda chave da máquina, impressão digital, digests e todas as amostras para que a versão seguinte compare sem mudar o formato.

### Alternative H: k6, hyperfine ou mitata

*   **Pros**: Ferramentas prontas. O k6 gera carga HTTP com relatório; o hyperfine roda um comando N vezes e dá mediana; o mitata faz micro benchmarks.
*   **Cons**: O k6 mede uma API sob muitos usuários, fora do escopo. O hyperfine só vê o tempo de relógio do processo inteiro (subida do Bun, carga dos drivers), não o `durationMs` do engine, e não lê o `RunRecord`. O mitata mede funções isoladas, não um flow com bancos. Nenhum sobe containers, carrega dados ou grava o histórico por máquina.
*   **Reason for Rejection**: Rejected by author: o que elas dariam (N runs e mediana) são 30 linhas no orquestrador; o resto do problema elas não cobrem.

### Alternative I: Amostrar a memória do processo de medição a partir do orquestrador

*   **Pros**: Não depende do event loop do filho; um trecho síncrono longo não esconde o pico.
*   **Cons**: Não há API portátil: `/proc/<pid>/status` no Linux, `ps` no macOS, `Get-Process` ou WMI no Windows, cada um com seu custo e atraso (um `Get-Process` leva dezenas de ms, mais que o intervalo). Mais código e três caminhos para testar.
*   **Reason for Rejection**: Rejected by author (decisão deste rascunho, a confirmar): o filho amostra o próprio RSS a cada 10 ms, como o worker já faz a cada 100 ms, e o relatório mostra as amostras perdidas para que o limite fique visível.

### Alternative J: API fake como processo Bun na máquina, fora do Docker

*   **Pros**: Sem imagem para construir; sobe em milissegundos.
*   **Cons**: Disputa CPU com o processo de medição e sem limite; o cenário `http-slow-api` mediria a API fake tanto quanto o engine.
*   **Reason for Rejection**: Rejected by author: a API fake precisa de CPU própria (análise 11 do brief), e o compose já está lá para dar isso.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**: Nenhum dado real. As senhas do SQL Server e a URL do MongoDB dos containers do perf são constantes no código e só valem para `127.0.0.1` nas portas do perf. Nada do perf entra na imagem do server (`.dockerignore`), e o server nunca o importa.
*   **Performance & Latency**: O próprio perf não pode distorcer o que mede: o orquestrador não faz nada enquanto o filho roda (só espera o processo); a amostragem de RSS custa uma chamada rápida a cada 10 ms; sem `onProgress`. O tempo total do `bun run perf` completo deve ficar abaixo de 15 minutos numa máquina com os containers já de pé; cada cenário diz quanto demorou e o `--quick` fica abaixo de 2 minutos.
*   **Rollout & Rollback**: Nada muda em produção. A única alteração em um arquivo de deploy é a linha `COPY dataflow.perf/package.json` no `Dockerfile` do server, exigida pelo `--frozen-lockfile`; `docker compose --profile server build` tem de continuar passando. Reverter é apagar a pasta e as três linhas fora dela.

--------------------------------------------------------------------------------

### Additional Resources

*   O concepts brief do `egm-brainstorm` que este documento substitui: `docs/designs/dataflow-perf.md` no commit `d036f09` (análise dos seis revisores, decisões 1 a 12).
*   `dataflow.server/features/runs/run-job.ts`: o `RunOptions` que o worker monta, copiado pelo processo de medição.
*   `dataflow.server/supervisor/workers/worker.ts`: a amostragem de memória de hoje (100 ms, RSS do worker).
*   `dataflow.server/tests/integration/database-drivers.test.ts`: os drivers contra containers, a referência para a carga em lote e as strings de conexão.
*   `dataflow.core/src/flows/flow-file.ts`: `flowFromYaml`, `validateFlowFile`, `toExecutableFlow`.

### Future Improvements

*   **Comparação com execuções anteriores**: mediana das últimas K execuções com a mesma chave de máquina e impressão digital, tolerância `max(X %, k × dispersão)`, "ruído alto demais para julgar", `--baseline`.
*   **Mais cenários**: Lookup com duas origens, Mongo Delete, TypeScript que chama a API fake, flows aninhados em profundidade.
*   **Réguas de fila e workers**: quando Fire and Forget e workers múltiplos existirem, um modo que passe pelo server.
*   **Relatório em HTML ou no editor**.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Sem código aqui: assinaturas, formas de dado e comportamento. Caminhos relativos à raiz do repositório. Estilo dos arquivos novos igual ao do server (`imports` com `#`, comentário de bloco no topo de cada módulo dizendo o que ele é, sem comentários inline).

### Target Files to Create/Modify

#### Fora do pacote

##### 1. `./package.json` (Modify)

*   **Type / Scope**: Manifesto do workspace raiz.
*   **Proposed Changes**: `"dataflow.perf"` em `workspaces`. Scripts: `"perf": "bun dataflow.perf/src/cli.ts"` (os argumentos extras de `bun run perf <cenário> --quick` chegam ao script); `test` e `typecheck` ganham `&& bun test --cwd=dataflow.perf` e `&& bun run --cwd=dataflow.perf typecheck`. A `description` menciona o perf.

##### 2. `./bun.lock` (Modify, gerado)

*   **Type / Scope**: Lockfile.
*   **Proposed Changes**: Regenerado por `bun install` com o workspace novo. Sem pacote de terceiros novo (o perf depende só de `@dataflow/core`, `@dataflow/server`, `@types/bun` e `typescript`).

##### 3. `./.dockerignore` (Modify)

*   **Type / Scope**: Build da imagem do server.
*   **Proposed Changes**: `dataflow.perf/*` e `!dataflow.perf/package.json`, no mesmo padrão das duas linhas do editor, com o comentário de uma linha dizendo por quê (o `--frozen-lockfile` precisa do manifesto de cada workspace).

##### 4. `./dataflow.server/Dockerfile` (Modify)

*   **Type / Scope**: Build da imagem do server.
*   **Proposed Changes**: `COPY dataflow.perf/package.json dataflow.perf/` logo depois da linha do editor. Nada mais: o `--filter '@dataflow/server'` já deixa o perf fora do `node_modules` da imagem.

##### 5. `./.gitignore` (Modify)

*   **Type / Scope**: Git.
*   **Proposed Changes**: `dataflow.perf/results/*` e `!dataflow.perf/results/.gitkeep`.

##### 6. `./docs/designs/dataflow-perf.md` (Modify)

*   **Type / Scope**: Documentação.
*   **Proposed Changes**: Este documento substitui o brief.

#### O pacote

##### 7. `./dataflow.perf/package.json` (Create)

*   **Type / Scope**: Manifesto do workspace.
*   **Proposed Changes**: `name: "@dataflow/perf"`, `private`, `type: module`. `imports`: `"#perf/*": "./src/*.ts"`, `"#scenarios/*": "./scenarios/*.ts"`, `"#fake-api/*": "./fake-api/*.ts"`. Scripts: `perf` (`bun src/cli.ts`), `test` (`bun test`), `typecheck` (`tsc --noEmit`), `fake-api` (`bun fake-api/server.ts`, para rodar a API fake sem Docker ao desenvolvê-la). `dependencies`: `@dataflow/core` e `@dataflow/server` como `workspace:*`. `devDependencies`: `@types/bun`, `typescript` nas mesmas versões do server.

##### 8. `./dataflow.perf/tsconfig.json` (Create)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: Cópia do `tsconfig.json` do server (`bundler`, `strict`, `noEmit`, `types: ["bun"]`) mais `allowImportingTsExtensions: true`, porque as importações `@dataflow/server/shared/runner/*.ts` levam a extensão. `include`: `src`, `scenarios`, `fake-api`, `tests`.

##### 9. `./dataflow.perf/README.md` (Create)

*   **Type / Scope**: Documentação do pacote.
*   **Proposed Changes**: Como rodar (`bun run perf`, flags), o que precisa (Docker, memória), onde ficam os resultados, como criar um cenário (pasta, `scenario.ts`, YAML pelo Download do editor com `connection: 'perf-sqlserver'` etc., `data.ts` com `DATA_VERSION`), como desenvolver a API fake, e os avisos (Apple Silicon, memória). Curto; o design é a referência.

##### 10. `./dataflow.perf/results/.gitkeep` (Create)

*   **Type / Scope**: Pasta dos resultados.
*   **Proposed Changes**: Arquivo vazio para a pasta existir no clone.

##### 11. `./dataflow.perf/docker-compose.perf.yml` (Create)

*   **Type / Scope**: Containers do perf.
*   **Proposed Changes**: `name: dataflow-perf`. Serviços `mssql`, `mongodb`, `fake-api` como descritos no Technical Plan: imagens com tag fixa (e digest `@sha256:` quando a tag for escolhida), `deploy.resources.limits` (`cpus`, `memory`), portas `14330`, `27018`, `5195`, volumes nomeados `mssql` e `mongodb`, healthchecks, `restart: unless-stopped`. Variáveis de ambiente do SQL Server: `ACCEPT_EULA`, `MSSQL_PID=Express`, `MSSQL_SA_PASSWORD` (a constante de `src/stack.ts`, repetida aqui; o teste `stack.test.ts` confere que são iguais). Comentário no topo dizendo que é independente do `docker-compose.yml` da raiz.

#### A API fake

##### 12. `./dataflow.perf/fake-api/params.ts` (Create)

*   **Type / Scope**: Tipo compartilhado.
*   **Proposed Changes**: `type FakeApiParams = {delayMs?: number; jitterMs?: number; failRate?: number; seed?: number; page?: number; size?: number}`; `parseParams(url: URL): FakeApiParams` (número inválido → padrão); `fakeApiUrl(base: string, path: string, params: FakeApiParams): string`. Padrões: 0 ms, 0 ms, 0, seed 1, página 1, 100 itens.

##### 13. `./dataflow.perf/fake-api/random.ts` (Create)

*   **Type / Scope**: PRNG determinístico.
*   **Proposed Changes**: `mulberry32(seed: number): () => number` e `hashSeed(...parts: number[]): number`. Usado pela API fake (atraso e falha da requisição `n` saem de `mulberry32(hashSeed(seed, n))`) e, por importação direta, pelos `data.ts` dos cenários.

##### 14. `./dataflow.perf/fake-api/server.ts` (Create)

*   **Type / Scope**: Servidor HTTP (Bun).
*   **Proposed Changes**: `Bun.serve` na porta `PORT` (padrão 5195). Rotas `GET /health`, `GET /items`, `GET /items/:id`, `POST /items`, `GET /_stats`, `POST /_reset`. Contador de requisições por processo (reiniciado em `/_reset`) que alimenta o PRNG; atraso `delayMs ± jitterMs`; com probabilidade `failRate` devolve 503 com corpo `{error}`. Itens gerados: `{id, name, price, updatedAt}` a partir da seed. `/_stats` devolve `{requests, failures, p50Ms, p95Ms}` com latências medidas por `performance.now()` em volta do atraso. Exporta `createFakeApi(port)` para o teste subir e derrubar.

##### 15. `./dataflow.perf/fake-api/Dockerfile` (Create)

*   **Type / Scope**: Imagem da API fake.
*   **Proposed Changes**: `FROM oven/bun:1.4.4-slim` (a mesma do server), copia `params.ts`, `random.ts`, `server.ts`, `USER bun`, `EXPOSE 5195`, `CMD ["bun", "server.ts"]`. Sem `bun install`.

#### O orquestrador e a medição

##### 16. `./dataflow.perf/src/scenario.ts` (Create)

*   **Type / Scope**: Tipos do pacote.
*   **Proposed Changes**: `type ServiceName = 'mssql' | 'mongodb' | 'fake-api'`. `type Direction = 'lower-is-better' | 'higher-is-better'`. `type Ruler = {metric: string; direction: Direction; limit?: number}`. `type LoadContext = {sqlserver: (sql, parameters?) => AsyncIterable<row>; bulkSqlServer: (table, columns, rows) => Promise<void>; mongo: MongoClient-like {insertMany, deleteMany, find}; fakeApi: {reset(), stats()}; size; seed; log(line)}` (só os serviços do cenário vêm preenchidos). `type Scenario = {id; description; services: ServiceName[]; size: number; quickSize: number; seed: number; runs?: number; timeoutMs: number; rulers: Ruler[]; load(ctx): Promise<void>; reset(ctx): Promise<void>; input?(size, seed): unknown}`. `type Sample` (o JSON do processo de medição): `{iteration; warmup: boolean; record: RunRecord; memory: {startBytes; peakBytes; endBytes; heapStartBytes; heapEndBytes; samplesExpected; samplesTaken}; cpu: {userMs; systemMs}; fakeApi?: {requests; failures; p50Ms; p95Ms}}`.

##### 17. `./dataflow.perf/src/scenarios.ts` (Create)

*   **Type / Scope**: Registro.
*   **Proposed Changes**: Importa os cinco `scenario.ts` e exporta `SCENARIOS: Scenario[]` na ordem de execução (os sem container primeiro) e `scenarioById(id)`. Um id desconhecido na linha de comando lista os válidos e sai com 1.

##### 18. `./dataflow.perf/src/cli.ts` (Create)

*   **Type / Scope**: Ponto de entrada.
*   **Proposed Changes**: `parseArgs` com `runs`, `quick`, `strict`, `size`, `list` e os positionals. Para cada cenário: `checkDocker` e `ensureServices` de `stack.ts` (pulados se `services` vazio), `ensureData` e `resetTargets` de `data.ts`, `measureOnce` de `measure.ts` 1 + N vezes (ou N com `--quick`), `judge` de `rulers.ts`, `printScenario` de `report.ts`, `appendResult` de `results.ts`. `SIGINT`/`SIGTERM`/`SIGBREAK` como o `scripts/dev.ts`: mata o filho, grava `partial: true`, sai. Código de saída: 0; 1 com `--strict` e régua estourada ou run `failed`; 2 em erro de infraestrutura (Docker ausente, carga falhou).

##### 19. `./dataflow.perf/src/stack.ts` (Create)

*   **Type / Scope**: Docker.
*   **Proposed Changes**: Constantes `PERF_PORTS`, `SA_PASSWORD`, `MONGO_URL`, `FAKE_API_URL`, `SERVICE_LIMITS` (memória por serviço, iguais ao compose). `checkDocker(): {ok, memTotalBytes, arch, version}` via `docker info --format json`; `ensureServices(services)`: `docker compose -f <arquivo> up -d --wait <serviços>`, com a saída do compose repassada; erro com a mensagem de correção (Docker parado, memória insuficiente: quanto falta e onde mudar no Docker Desktop). `imageDigests(services)`: `docker image inspect --format '{{index .RepoDigests 0}}'`; para `fake-api`, hash dos três arquivos da pasta. `warnIfEmulated()` para `arm64`. Tudo com `Bun.spawn`, `stdout: 'pipe'`.

##### 20. `./dataflow.perf/src/data.ts` (Create)

*   **Type / Scope**: Carga e reset.
*   **Proposed Changes**: `dataFingerprint(scenario, size, seed)`: sha256 de `DATA_VERSION`, size, seed. `ensureData(scenario, size, seed)`: abre o `LoadContext` (pool `mssql` próprio para a carga, `MongoClient` próprio; a API fake só `fetch`), lê o marcador (`dbo._perf_meta` / `_perf_meta`), chama `scenario.load(ctx)` se não confere e grava o marcador. `bulkSqlServer` com `sql.Table` e `request.bulk` em blocos de 10 000; `insertMany` em blocos de 10 000, `ordered: false`. `resetTargets(scenario)`: `scenario.reset(ctx)`. Fecha pool e client no fim.

##### 21. `./dataflow.perf/src/measure.ts` (Create)

*   **Type / Scope**: O lado do orquestrador da medição.
*   **Proposed Changes**: `measureOnce(scenario, {size, seed, iteration, warmup}): Promise<Sample>`: `Bun.spawn(['bun', 'src/run-once.ts', id, size, seed, iteration])` com `stdout: 'pipe'`, `stderr: 'inherit'`; lê o stdout inteiro, faz `JSON.parse` da última linha, consulta `/_stats` da API fake se o cenário a usa e anexa. Expõe `currentChild` para o `cli.ts` matar no Ctrl+C. Código de saída 2 do filho vira erro com o stderr.

##### 22. `./dataflow.perf/src/run-once.ts` (Create)

*   **Type / Scope**: O processo de medição.
*   **Proposed Changes**: Lê os argumentos; `loadFlows(scenario)` de `flows.ts`; monta `RunOptions` como no Technical Plan (`mode: 'execution'`, `id: crypto.randomUUID()`, `evaluate`, `prepareScript` com `scripts` e `scriptHashes` vazios, `http: sendHttp`, `databases: {sqlserver: querySqlServer}`, `documentQueries`, `documentStores`, `documentDeletes`, `secrets`, `connections`, `flows`, `input`, `timeoutMs`); `memoryWatch(10)` e `process.cpuUsage()` em volta de `await flowRunner(...)`; `closeSqlServerPools()` e `closeMongoClients()`; `console.log(JSON.stringify(sample))`; `process.exit(0)`. Qualquer exceção fora do `flowRunner`: mensagem no stderr e `exit(2)`.

##### 23. `./dataflow.perf/src/flows.ts` (Create)

*   **Type / Scope**: Flows e conexões.
*   **Proposed Changes**: `loadFlowFiles(scenarioId): {path, file: FlowFile}[]` (lê `scenarios/<id>/flows/*.yaml`, `flowFromYaml`, lança com o caminho e os erros se `ok: false`); `executableFlows(files): {main: ExecutableFlow; flows: Record<string, ExecutableFlow>}` (`toExecutableFlow(file, 'perf')`; `main` é o de `id === scenarioId`; erro se não houver ou se algum arquivo não tiver `id`); `PERF_CONNECTIONS: Record<string, ConnectionProfileData>` e `PERF_SECRETS` com os valores de `stack.ts`. Usado pelo `run-once.ts` e pelo teste.

##### 24. `./dataflow.perf/src/metrics.ts` (Create)

*   **Type / Scope**: Extratores.
*   **Proposed Changes**: `type Extractor = (sample: Sample) => number | undefined`; `EXTRACTORS: Record<string, Extractor>` com as métricas fixas da tabela do Technical Plan; `metricOf(name, sample)`: as fixas, ou `component.<label>.activeMs|waitingMs|peakBytes` resolvido por `record.components` (label igual; `undefined` se não houver), ou `fakeApi.*`. `envelopesPerSecond` usa a soma de `outputs` do nó com `type === START` e devolve `undefined` quando `durationMs` é 0.

##### 25. `./dataflow.perf/src/rulers.ts` (Create)

*   **Type / Scope**: Julgamento.
*   **Proposed Changes**: `median(values)`, `spread(values): {min, max}`; `judge(rulers, samples): RulerResult[]` com `{metric, direction, limit, median, min, max, verdict: 'within' | 'exceeded' | 'no-limit' | 'unavailable'}`. `unavailable` quando alguma amostra devolve `undefined` para a métrica. `exceeded` só com `limit` e mediana do lado errado conforme `direction`.

##### 26. `./dataflow.perf/src/report.ts` (Create)

*   **Type / Scope**: Texto no terminal.
*   **Proposed Changes**: `printPlan(scenario, options, estimateMs | undefined)`, `printScenario(result)` (cabeçalho, tabela das réguas, tabela dos componentes por mediana de `activeTimeMs` e `waitingMs`, linha da API fake, status por run com `samplesLost` quando maior que 0), `printSummary(results)`. Formatação própria (colunas alinhadas com `padEnd`), bytes em MB com uma casa, tempos em ms ou s. Sem cores por padrão; cores só com `FORCE_COLOR` como no `scripts/dev.ts`.

##### 27. `./dataflow.perf/src/results.ts` (Create)

*   **Type / Scope**: JSONL.
*   **Proposed Changes**: `type ResultLine` com a forma do Technical Plan e `SCHEMA_VERSION = 1`; `resultsPath(machineKey)` → `results/<key>.jsonl`; `appendResult(line)`; `lastResult(scenarioId, size)` para a estimativa.

##### 28. `./dataflow.perf/src/fingerprint.ts` (Create)

*   **Type / Scope**: Identidade.
*   **Proposed Changes**: `gitInfo(): {sha, dirty}` (`git rev-parse HEAD`, `git status --porcelain`); `machineKey(): {key, ...campos}` (`os.cpus()[0].model`, `os.cpus().length`, `os.totalmem()`, `os.platform()`, `os.release()`, `Bun.version`, versão do Docker de `stack.ts`, `SERVICE_LIMITS`); `scenarioFingerprint(scenario, flowsYaml, composeYaml, size, seed)`: sha256 dos conteúdos. `node:crypto` para os hashes.

#### Cenários

##### 29. `./dataflow.perf/scenarios/in-memory-pipeline/scenario.ts`, `flows/in-memory-pipeline.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário sem container.
*   **Proposed Changes**: `services: []`, `size: 300_000`, `quickSize: 30_000`, `input(size, seed)` devolve o array de `data.ts` (`{id, name, amount, category, createdAt}`). Flow: Start (`acceptsInput: true`) → Mapper (dois campos calculados) → Filter (`amount > 0`) → Router (duas saídas por `category`, ambas para o mesmo TypeScript) → TypeScript (`process` que arredonda e devolve) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `cpuPercent` (informativa, lower); todas sem `limit`. `load` e `reset` vazios.

##### 30. `./dataflow.perf/scenarios/flow-invoker-fanout/scenario.ts`, `flows/flow-invoker-fanout.yaml`, `flows/perf-child-mapper.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário sem container, dois flows.
*   **Proposed Changes**: `size: 20_000`, `quickSize: 2_000`. Principal: Start com entrada → Flow Invoker (`flowId: 'perf-child-mapper'`, entrada `$DATA`) → End. Filho (`id: perf-child-mapper`): Start (`acceptsInput: true`) → Mapper → End. Réguas: `durationMs`, `envelopesPerSecond`, `memoryDeltaBytes`, `component.Flow Invoker.waitingMs`.

##### 31. `./dataflow.perf/scenarios/sqlserver-to-mongodb/scenario.ts`, `flows/sqlserver-to-mongodb.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com dois bancos.
*   **Proposed Changes**: `services: ['mssql', 'mongodb']`, `size: 100_000`, `quickSize: 10_000`. `load`: cria `perf` (banco) e `dbo.Customer (id int PK, name nvarchar(80), email nvarchar(120), balance decimal(12,2), since datetime2)` se não existir, `TRUNCATE`, `bulkSqlServer` com as linhas de `data.ts`. `reset`: `deleteMany({})` em `perf.customers`. Flow: Start → SQL Server Query (`connection: 'perf-sqlserver'`, `SELECT ... FROM dbo.Customer WHERE id <= @size ORDER BY id`, parâmetro `size` de `$PARAMETERS.size`) → Mapper (renomeia e calcula) → MongoDB Upsert (`connection: 'perf-mongodb'`, coleção `customers`, filtro `id`, lote 500) → End. O Start declara o parâmetro `size`; o `run-once.ts` passa `parameterValues: {size}`. Réguas: `durationMs`, `envelopesPerSecond`, `memoryDeltaBytes`, `component.SQL Server Query.waitingMs`, `component.MongoDB Upsert.waitingMs`.

##### 32. `./dataflow.perf/scenarios/mongodb-pipeline-aggregate/scenario.ts`, `flows/mongodb-pipeline-aggregate.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com MongoDB.
*   **Proposed Changes**: `services: ['mongodb']`, `size: 200_000`, `quickSize: 20_000`. `load`: `insertMany` em `perf.orders` (`{orderId, customerId, status, total, items[], placedAt}`), índice em `customerId`. `reset` vazio (só leitura). Flow: Start → MongoDB Pipeline (`$match` por `placedAt`, `$limit` = `$PARAMETERS.size`) → Filter (`status !== 'cancelled'`) → Aggregate (por `customerId`, soma de `total`, contagem) → Sort (soma desc) → Limit (100) → End. Réguas: `durationMs`, `memoryDeltaBytes`, `component.Aggregate.peakBytes`, `component.Sort.peakBytes` (as duas últimas informativas), `component.MongoDB Pipeline.waitingMs`.

##### 33. `./dataflow.perf/scenarios/http-slow-api/scenario.ts`, `flows/http-slow-api.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com a API fake.
*   **Proposed Changes**: `services: ['fake-api']`, `size: 2_000`, `quickSize: 200`, `input` = array de `{id}`. `load` vazio; `reset`: `POST /_reset`. Flow: Start com entrada → HTTP Request (URL montada com `fakeApiUrl` no `data.ts` e gravada no YAML: `http://127.0.0.1:5195/items/$id?delayMs=20&jitterMs=10&failRate=0.02&seed=<seed>`, `concurrency: 8`, `failOnError: true`, `onError: 'divert'` com a porta de erro ligada a um Discard) → Mapper → End. Réguas: `durationMs`, `envelopesPerSecond`, `component.HTTP Request.waitingMs`, `fakeApi.p95Ms` (informativa), `fakeApi.failures` (informativa).

#### Testes (rodam no `bun run test` da raiz, sem Docker)

##### 34. `./dataflow.perf/tests/flows.test.ts` (Create)

*   **Type / Scope**: Teste unitário (o Goal da validação diária).
*   **Proposed Changes**: Para cada cenário de `SCENARIOS`: todos os YAML passam por `flowFromYaml` com `ok: true` (falha com o caminho e os erros); existe um flow com `id` igual ao id do cenário; cada `config.flowId` de um Flow Invoker aponta para um `id` presente na pasta; cada `config.connection` não vazio está em `PERF_CONNECTIONS`; `componentIssues` do core não devolve problema para nenhum nó; `toExecutableFlow` + `flowRunner` com drivers ausentes e `signal` já abortado termina sem lançar (o engine falha de forma controlada, o que prova que o flow é executável no formato atual).

##### 35. `./dataflow.perf/tests/metrics.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Uma `Sample` fabricada: `envelopesPerSecond` calcula pelo Start; `memoryDeltaBytes` é pico menos início; `component.X.activeMs` de um label inexistente é `undefined`; `fakeApi.*` é `undefined` sem `fakeApi`.

##### 36. `./dataflow.perf/tests/rulers.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Mediana de N par e ímpar; `within`/`exceeded` nas duas direções; `no-limit` sem `limit`; `unavailable` quando uma amostra não tem a métrica, mesmo com `limit`.

##### 37. `./dataflow.perf/tests/fake-api.test.ts` (Create)

*   **Type / Scope**: Teste de integração local (sem Docker).
*   **Proposed Changes**: Sobe `createFakeApi(0)` (porta livre); a mesma seed dá a mesma sequência de atrasos e falhas em duas rodadas após `/_reset`; `failRate: 0` nunca falha; `/_stats` conta; `parseParams` ignora valores inválidos; `fakeApiUrl` e `parseParams` são inversos.

##### 38. `./dataflow.perf/tests/results.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: `appendResult` numa pasta temporária escreve uma linha JSON por chamada com `schemaVersion: 1`; `lastResult` devolve a última do cenário e tamanho pedidos; `scenarioFingerprint` muda quando um YAML muda e não muda quando só a ordem dos arquivos muda.

##### 39. `./dataflow.perf/tests/stack.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Lê o `docker-compose.perf.yml` com `yaml` e confere: `name: dataflow-perf`; nenhuma porta publicada igual a 5180, 5190 ou 5432; `MSSQL_SA_PASSWORD` igual a `SA_PASSWORD` de `stack.ts`; os limites de memória iguais a `SERVICE_LIMITS`; toda imagem com tag fixa (nada de `latest`).

### Verification Plan

*   **Compilation/Build**: `bun install` (lockfile só com o workspace novo); `bun run typecheck` na raiz, incluindo o perf (as importações de `@dataflow/server/shared/runner/*.ts` resolvem); `docker compose --profile server build` continua passando com o Dockerfile alterado.
*   **Unit Tests**: `bun run test` na raiz roda os testes do perf sem Docker; `bun test --cwd=dataflow.perf` isolado.
*   **Static Analysis & Linting**: Não há linter na raiz hoje; o typecheck com `noUnusedLocals` e `noUnusedParameters` é o que existe.
*   **Test Coverage Requirement**: Nenhuma meta numérica. O que precisa estar coberto: validação dos flows de todos os cenários, extratores, julgamento das réguas, determinismo da API fake, formato do JSONL, invariantes do compose.
*   **E2E/Integration (manual, com Docker)**:
    1. `bun run perf --list` lista cinco cenários.
    2. `bun run perf in-memory-pipeline --quick` termina em menos de 1 minuto sem tocar no Docker e grava uma linha em `results/`.
    3. `bun run perf sqlserver-to-mongodb` sobe só `mssql` e `mongodb` (`docker ps` não mostra `fake-api`), carrega os dados uma vez (a segunda execução diz "dados conferem, carga pulada"), e `docker compose -p dataflow ps` do dev fica como estava.
    4. `bun run perf` completo fica abaixo de 15 minutos com os containers já de pé.
    5. `Ctrl+C` no meio de um cenário deixa uma linha com `partial: true` e os containers de pé.
    6. `bun run perf http-slow-api --strict` com uma régua de `limit` impossível sai com código 1.
    7. Com `bun run dev` rodando ao mesmo tempo, o editor em :5180 continua funcionando durante o passo 3.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
