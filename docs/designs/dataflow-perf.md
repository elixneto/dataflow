# dataflow.perf: cenários de performance do engine

*   **Author:** Élix Neto
*   **Status:** Proposed
*   **Date:** 2026-11-05

--------------------------------------------------------------------------------

## Overview

`dataflow.perf` (daqui em diante, *o perf*) é um pacote do monorepo que roda cenários de performance do engine do dataflow com `bun run perf`. Cada cenário é um ou mais flows em arquivo (o YAML que o Download do editor gera), com dados gerados de forma determinística, executados pelo `flowRunner` do core num processo Bun novo, contra MongoDB e SQL Server em containers dedicados, cada um com limite de CPU e RAM, e uma API HTTP fake num processo local. O relatório sai em texto no terminal e numa página web estática (`dataflow.perf/report/`) que lê os resultados: a visão geral de todos os cenários, o histórico de cada um em gráfico e as execuções escolhidas comparadas lado a lado. `bun run perf --serve --open` a serve com os resultados e abre o navegador. Os resultados ficam num arquivo local, fora do git.

Um *envelope* é a unidade que o engine processa: um registro (um objeto `DATA` com os campos do dado) que atravessa os componentes do flow um a um. Uma linha do SQL Server, um documento do MongoDB ou um item de um array de entrada viram um envelope cada. Todas as métricas de volume deste documento contam envelopes.

O pacote nunca vai para o deploy do app e não toca no server, no Postgres nem nas portas que o editor usa. Além do Bun e do Docker Desktop (pelo menos 6 GB para containers, ver Riscos e limites), não há nada a instalar: cenários, compose e API fake estão no repositório.

## The Problem

Não há hoje um jeito de ver como o engine se comporta com volume e lentidão. Os testes automáticos usam poucos envelopes e respondem em milissegundos, e um flow real contra um banco real só mostra um problema em produção. Um commit que dobra o uso de memória do Mapper ou deixa o SQL Server Query serializar mais devagar passa pelo `bun run test`.

Não existe incidente conhecido. O objetivo é prevenção: ter cenários reproduzíveis que rodam na máquina de quem desenvolve, para olhar as métricas de uma mudança antes de ela entrar. Nesta versão a ferramenta é de observação: ela imprime as métricas e guarda os resultados; quem compara é a pessoa, com o relatório anterior ao lado (a comparação automática é um Non-Goal).

A solução é um conjunto de cenários versionados no repositório, com um comando único que sobe o que falta, gera os dados, roda cada cenário várias vezes e imprime as métricas. As réguas por cenário dizem quais métricas olhar e em que direção é melhor; limites e alertas ficam para quando houver histórico que os calibre.

## Goals

*   `bun run perf` roda todos os cenários; `bun run perf <cenário...>` roda os indicados. Ambos sobem só os containers que o cenário precisa, carregam os dados de origem uma vez por cenário e seed, e zeram os destinos entre iterações.
*   Cada cenário roda N vezes (padrão 5) depois de 1 run de aquecimento descartada, cada run num processo Bun novo, com os drivers e os scripts pré-aquecidos antes de o relógio começar.
*   Por run, o relatório mostra: `durationMs` do engine, CPU, memória no início, pico amostrado durante a run e memória no fim (a régua usa pico menos início), envelopes por segundo, e tempo ativo e de espera por componente. No fim, mediana e dispersão das N runs, e a mediana da última execução do mesmo cenário nesta máquina ao lado, quando existir.
*   Réguas configuráveis por cenário, cada uma com direção (menor ou maior é melhor). Uma régua cuja métrica não existe aparece como "indisponível", não como erro.
*   Cada execução grava uma linha JSON (com `schemaVersion`, commit, flag de alterações não commitadas, os fatos da máquina, o cenário com seed e tamanho, as tags das imagens e todas as amostras) em `dataflow.perf/results/`, fora do git.
*   Código de saída 0; 1 quando um run medido falha; 2 quando a infraestrutura falha (Docker, carga). `--quick` roda com N menor e sem aquecimento.
*   O perf mede sempre a mesma configuração de drivers que o worker do server roda: ele chama o `runJob` do server, não monta a sua própria.
*   A ferramenta só serve se o ruído for menor que o que ela quer mostrar: a dispersão (máximo menos mínimo sobre a mediana) do `in-memory-pipeline` com N = 5 deve ficar abaixo de 10 % na máquina de referência do autor; se não ficar, o relatório diz "high noise" e o passo seguinte é aumentar N ou fixar a CPU, antes de calibrar qualquer limite.
*   Os flows de cenário são validados pelo `bun run test` normal com o `validateFlowFile` do core, para que uma mudança de formato quebre no dia a dia, não meses depois.
*   O engine roda isolado: o server, o Postgres e as portas 5180, 5190 e 5432 do ambiente de dev não são tocados.

## Non-Goals

*   Comparar com execuções anteriores e alertar regressão entre commits. Os resultados guardam as amostras e os fatos da máquina para isso, mas a comparação fica para uma versão seguinte.
*   Limites nas réguas e um modo que falhe por limite estourado (`--strict`): até existir histórico que os calibre.
*   Medir API, fila, supervisor e workers. O engine roda no processo do perf.
*   Carga na API ou no editor (muitos usuários), carga distribuída em várias máquinas, ou comparar resultados entre máquinas diferentes.
*   Bloquear merge ou rodar no CI.
*   Simular falhas reais de rede. A lentidão e os erros vêm só da API fake.
*   Réguas de Fire and Forget (disparar um flow sem esperar o resultado) e de workers múltiplos (vários processos de execução em paralelo), até essas funções existirem.
*   Relatório dentro do editor, ou publicado em algum lugar. A página é estática e local; o servidor do `--serve` só entrega os arquivos dela e os resultados, em `127.0.0.1`.
*   Abrir as runs do perf no editor ou apontar "o componente que mais mudou": as runs não passam pelo server (não existem lá) e não há comparação nesta versão.
*   Monitorar produção.

## Open Questions

*   **Métricas de memória por componente**: `ComponentRun.memory.peakBytes` existe no core. Falta confirmar se ele serve como régua ou só como informação, dado que mede amostras de envelopes e não o processo.

Decisões do autor após a revisão (2026-11-05): sem limites nem `--strict` nesta versão; campos brutos no JSONL em vez de hashes e digests; API fake como processo local; o perf chama o `runJob` do server (exposto por `exports`) em vez de copiar a montagem dos drivers. Depois da primeira execução: uma página estática que lê os resultados (JSONL) e permite abrir cada cenário e comparar as execuções, além do texto no terminal (o brief tinha decidido só texto), e resultados compactos (`schemaVersion` 2), porque o registro inteiro do engine fazia o JSONL passar de 50 MB em uma tarde.

Dependência fora do escopo: `validateFlowFile` recusa qualquer versão diferente de 1 e ainda não existe conversão de versões antigas. Ela precisa existir no core antes de a versão 2 do formato aparecer; a CUJ 3 é o que avisa.

## Critical User Journeys (CUJs)

### CUJ 1: Primeira execução num clone novo

*   **Given**: Repositório clonado, `bun install` feito, Docker Desktop rodando com pelo menos 6 GB para containers, nenhuma imagem do perf baixada.
*   **When**: `bun run perf sqlserver-to-mongodb`.
*   **Then**: O comando confere Docker e memória, sobe só `mssql` e `mongodb` do `docker-compose.perf.yml` (baixando as imagens) e espera os healthchecks. Carrega os dados de origem do cenário uma vez; nas próximas execuções a carga é pulada porque o marcador dos dados confere. Roda 1 aquecimento e 5 runs em processos Bun novos, zerando a coleção de destino antes de cada um, e imprime a tabela das métricas que as réguas escolhem, com mediana e dispersão. Uma linha vai para `dataflow.perf/results/<máquina>.jsonl`. Sai com código 0. Os containers continuam em execução; o ambiente de dev (`bun run dev`, :5180, :5190, :5432) não foi tocado.

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

Como o server executa um flow hoje: a API grava a run no Postgres e avisa por NOTIFY; o supervisor (`dataflow.server/supervisor/`) pega a run (ou a vê no poll de 5 s), monta um `RunJob` com o flow, os perfis de conexão, os segredos e os flows chamados (`features/runs/run-job.ts`), e o entrega a um worker (processo filho reutilizado por até 100 runs). O worker chama `runJob(job, {signal, onProgress})`, que monta o `RunOptions` com os drivers de `dataflow.server/shared/runner/` e chama `flowRunner` do core, devolvendo o `RunRecord` (status, `durationMs`, um `ComponentRun` por componente com `activeTimeMs`, `waitingMs`, contagens de envelopes por porta e, nos acumuladores, `memory.peakBytes`). O worker amostra o RSS do próprio processo a cada 100 ms durante a run.

O perf é um workspace Bun (`@dataflow/perf`) com três partes: um **orquestrador** (`src/cli.ts`), um **processo de medição** por run (`src/run-once.ts`) e uma **API HTTP fake** (`fake-api/`) que o orquestrador sobe como processo local quando um cenário a pede. O orquestrador nunca roda um flow: ele sobe containers e a API fake, carrega dados, zera destinos, dispara o processo de medição N+1 vezes, agrega e imprime. O processo de medição é o único lugar onde o engine executa, e ele o faz pelo mesmo `runJob` que o worker do server usa: o perf mede a configuração de drivers que a produção roda, e um driver novo no `runJob` entra no perf sem ninguém mexer nele. O processo morre no fim de cada run, por isso cada run começa sem heap herdado de runs anteriores.

```text
bun run perf [cenário...] [--runs N] [--quick] [--size S] [--list] [--serve] [--open]
        │
        ▼
┌──────────────────────── dataflow.perf/src/cli.ts (orquestrador) ─────────────────────────┐
│ 1. lê o registro de cenários (scenarios/*/scenario.ts)                                   │
│ 2. confere `docker info` e a memória do Docker contra os limites dos serviços do cenário │
│ 3. `docker compose -f docker-compose.perf.yml up -d --wait <mssql|mongodb do cenário>`   │
│    e, se o cenário usa a API fake, Bun.spawn(fake-api/server.ts) local na :5195          │
│ 4. carga dos dados de origem (uma vez por cenário e seed), pulada se o marcador confere  │
│ 5. para cada run (1 aquecimento + N):                                                    │
│      zera destinos ─► Bun.spawn(run-once.ts, cenário, size, seed) ─► lê JSON do stdout   │
│ 6. mediana e dispersão ─► relatório no terminal ─► linha no results/*.jsonl              │
└───────────────┬──────────────────────────────────────────┬───────────────────────────────┘
                │ processo Bun novo por run                 │ docker compose (projeto dataflow-perf)
                ▼                                           ▼
┌──── src/run-once.ts (medição) ─────┐     ┌──────────────────────────────────────────────┐
│ flows YAML ─► flowFromYaml         │     │ mssql     :14330  2 CPU / 2,5 GB  vol. mssql │
│          ─► toExecutableFlow       │ ──► │ mongodb   :27030  1 CPU / 1 GB    vol. mongo │
│ RunJob: flow, flows, connections,  │     └──────────────────────────────────────────────┘
│   secrets, parameters, input       │ ──► fake-api :5195 (processo local do orquestrador)
│ pré-aquece drivers e scripts       │
│ Worker amostra RSS do processo;    │
│ process.cpuUsage() antes/depois    │
│ runJob(job) do server ─► RunRecord │
│ stdout: 1 JSON {record, memory,    │
│   cpu} e sai                       │
└────────────────────────────────────┘
```

### O orquestrador (`src/cli.ts`)

Lê os argumentos da linha de comando. Sem cenário, roda todos na ordem do registro. Flags: `--runs N` (padrão: o `runs` do cenário, senão 5), `--quick` (N = 2, sem aquecimento, tamanho `quickSize` do cenário), `--size S` (substitui o tamanho do cenário), `--list` (imprime os cenários, seus serviços e réguas e sai). `bun run perf` na raiz executa `bun dataflow.perf/src/cli.ts` com o diretório de trabalho na raiz; todo caminho do perf (compose, cenários, `results/`, o script do processo de medição, a API fake) é resolvido a partir da pasta do pacote, nunca do diretório de trabalho.

Antes de cada cenário, imprime o que vai fazer (serviços, tamanho, N) e, se existir, a mediana da última execução do mesmo cenário e tamanho no arquivo JSONL desta máquina, usada como estimativa de tempo e repetida na tabela de réguas como coluna "anterior". Isso só lê o arquivo; não há veredito de regressão.

`Ctrl+C` encerra o processo de medição em andamento e a API fake (no Windows, pela árvore de processos, como o `scripts/dev.ts`), grava a linha JSONL com `partial: true` e as amostras que já tem, e sai. Os containers continuam em execução.

### O processo de medição (`src/run-once.ts`)

Recebe por argumentos o id do cenário, o tamanho, a seed e o número da iteração. Monta um `RunJob`, pré-aquece, e só então começa a medir:

*   **Flows**: cada `scenarios/<id>/flows/*.yaml` passa por `flowFromYaml` (uma falha encerra o processo com o caminho e os erros devolvidos) e `toExecutableFlow(file, 'perf')` (o segundo argumento é o nome do projeto que aparece no `RunRecord`), com o `id` do arquivo mantido. O flow com `id` igual ao id do cenário é o principal (`job.flow`); todos entram no mapa `job.flows` para o Flow Invoker (`config.flowId` de cada nó aponta para esses ids fixos).
*   **Conexões**: `job.connections` tem dois perfis fixos, `perf-sqlserver` (tipo `sqlserver`: host `127.0.0.1`, porta 14330, banco `perf`, usuário `sa`, `encrypt` off, `trustServerCertificate` on, senha pelo segredo `PERF_SA_PASSWORD`) e `perf-mongodb` (tipo `mongodb`: `connectionString` pelo segredo `PERF_MONGO_URL`, campo `database` = `perf`). Os valores dos segredos (`job.secrets`) são constantes em `src/stack.ts` e só valem para os containers locais do perf. Os nós dos flows usam `connection: 'perf-sqlserver'` ou `'perf-mongodb'`.
*   **O engine**: `runJob(job, {signal})` de `@dataflow/server/run-job`, o mesmo que o worker chama. Ele monta o `RunOptions` com `evaluate`, `prepareScript`, `sendHttp`, `querySqlServer`, `aggregateMongoDb`, `upsertMongoDb`, `deleteMongoDb`, `timeoutMs` de 10 minutos e, quando o engine lança, devolve um `RunRecord` `failed` com a mensagem. O perf não passa `onProgress` (ele copia o estado várias vezes por segundo e isso mediria o editor, não o engine). `job.mode` é `'execution'`, `job.parameters` é `{size: String(size)}` (os flows que não declaram o parâmetro o ignoram), `job.variables` é vazio, `job.projectName` é `'perf'` e `job.flowName` é o nome do flow principal. Para isso o `package.json` do server ganha um campo `exports` que expõe `run-job.ts` e os drivers de `shared/runner/`; é a única mudança no server.
*   **Entrada**: o cenário pode dar um `input` (array gerado por `data.ts`) quando o Start aceita entrada; é assim que os cenários sem container alimentam o flow.
*   **Pré-aquecimento**: num processo novo, o primeiro uso de cada driver paga o `import` do pacote, a conexão (login e TLS no SQL Server, seleção de servidor no MongoDB) e, no TypeScript, o bundle do script; em produção um worker amortiza isso em até 100 runs. Antes de ligar o relógio, o processo faz uma consulta trivial por cada driver que o cenário usa, pelas mesmas funções exportadas pelo server (`SELECT 1` por `querySqlServer`, um pipeline vazio numa coleção vazia por `aggregateMongoDb`, `GET /health` por `sendHttp`) e um `prepareScript` por script do flow (o cache de bundles é por processo). O que sobra dentro de `durationMs` é o engine.

A medição em si:

1. `Bun.gc(true)` e `process.memoryUsage()` uma vez (início: `rss`, `heapUsed`).
2. Uma thread (`Worker` de `node:worker_threads`, `src/memory-sampler.ts`) que começa a amostrar ao carregar, avisa que está pronta (o relógio só começa depois) e lê `process.memoryUsage.rss()` a cada 10 ms e guarda o máximo. O RSS é do processo inteiro, então o worker vê a memória do thread principal; e como ele tem o próprio event loop, continua amostrando enquanto o engine ocupa o thread principal. Isso importa: o engine passa envelopes por promessas (microtasks), sem ceder a timers, então um `setInterval` no thread principal só dispararia quando o flow terminasse. Ao fim, o worker devolve o pico e o número de amostras por `postMessage`.
3. `process.cpuUsage()` antes e depois (user + system).
4. `await runJob(job, {signal})`.
5. Encerra o worker, mais uma leitura de RSS (o fim) e de `heapUsed`.
6. Fecha pools e clients (`closeSqlServerPools`, `closeMongoClients`, exportados pelo server) e escreve no stdout **uma linha JSON** com o `RunRecord` inteiro, a memória (início, pico, fim, amostras) e a CPU, com os mesmos nomes que o worker do server usa (`startRssBytes`, `peakRssBytes`, `cpuMs`). Logs do engine e erros vão para o stderr. Código de saída 0 se o run terminou (mesmo `failed`: o orquestrador decide), 2 se o processo em si quebrou.

O orquestrador encerra o processo de medição à força em `timeoutMs` do cenário mais 30 s: o timeout do engine é um timer e, por isso, também não dispara num flow sem I/O.

### Cenários (`scenarios/<id>/`)

Cada cenário é uma pasta com:

*   `scenario.ts`: exporta um `Scenario` com `id`, `description`, `services` (subconjunto de `['mssql', 'mongodb', 'fake-api']`), `size` e `quickSize`, `seed`, `runs` (opcional; o padrão é 5 e `--runs` sobrepõe), `timeoutMs`, `dataVersion` (reexportado de `data.ts`), `throughputNode` (o `label` do componente cujas saídas contam como envelopes processados), `rulers`, e funções `load(ctx)` (carga inicial dos dados de origem), `reset(ctx)` (zera os destinos antes de cada run) e `input(size, seed)` (opcional, a entrada do Start).
*   `flows/*.yaml`: um ou mais flows no formato do Download. O flow principal tem `id` igual ao id do cenário.
*   `data.ts`: o gerador determinístico (um PRNG `mulberry32` pela seed; nunca `Math.random`) e a constante `DATA_VERSION`, que entra no marcador dos dados.

Os cinco cenários iniciais (componentes do core: Mapper calcula campos; Filter descarta por condição; Router separa em saídas por condição; TypeScript roda um `process` do usuário; Flow Invoker chama outro flow por envelope; Aggregate junta N envelopes num lote; Sort e Limit ordenam e cortam; os de banco e HTTP falam com fora):

| Cenário | Serviços | O que mede | Tamanho (quick) |
|---|---|---|---|
| `in-memory-pipeline` | nenhum | Start com entrada → Mapper → Filter → Router → TypeScript → End. CPU e alocação do engine puro. | 10 000 (1 000) envelopes |
| `flow-invoker-fanout` | nenhum | Start com entrada → Flow Invoker (flow filho com Mapper) → End. Custo de um `flowRunner` por envelope. | 20 000 (2 000) envelopes |
| `sqlserver-to-mongodb` | mssql, mongodb | SQL Server Query (stream com backpressure) → Mapper → MongoDB Upsert (lote 500). Origem SQL, destino Mongo. | 50 000 (5 000) linhas |
| `mongodb-pipeline-aggregate` | mongodb | MongoDB Pipeline (com `$group` no banco) → Filter → Aggregate (lotes de 500) → TypeScript (soma do lote) → Sort → Limit → End. Acumuladores e a memória que eles seguram. | 100 000 (10 000) documentos |
| `http-slow-api` | fake-api | Start com entrada (ids) → HTTP Request (8 ao mesmo tempo, 20 ms ± 10 ms, 2 % de falhas desviadas pela porta de erro) → Mapper → End. Espera externa e tratamento de erro. | 2 000 (200) requisições |

Os dois primeiros não precisam de Docker e servem de smoke test em máquinas sem Docker; o quinto também não precisa de Docker.

Os tamanhos saíram da primeira execução (2026-11-05, Ryzen 9 7900, 32 GB): a suíte completa leva cerca de 5 minutos com os containers em execução. O `in-memory-pipeline` foi planejado com 300 000 envelopes e não cabe: cada `evaluate` do runner cria um contexto `node:vm` novo (`vm.runInNewContext`), que custa ~0,13 ms e deixa ~110 KB de lixo que o GC só recolhe tarde; com 4 avaliações por envelope, 30 000 envelopes levaram 18 s e o RSS subiu 13 GB (um `Bun.gc(true)` depois devolve tudo). Foi o primeiro achado do perf, e já foi corrigido: o runner passou a ter `createEvaluate()`, um avaliador por run que compila cada expressão uma vez como uma função cujos parâmetros são as variáveis do envelope, e a chama num contexto `node:vm` só daquela run (os globais que uma expressão cria são apagados antes da próxima chamada, e os nomes globais nativos são somente leitura). Comparado ao `evaluate` antigo em 32 expressões típicas, o resultado é idêntico, e funções ou getters devolvidos por uma expressão continuam vendo o próprio envelope. A única diferença: uma expressão que altere de propósito um protótipo nativo (`Object.prototype.x = 1`) afeta as expressões seguintes da mesma run, nunca de outra. O `runJob` cria um por run, então runs nunca compartilham contexto. No `in-memory-pipeline` (10 000 envelopes, mesma máquina) o tempo do engine caiu de 5 544 ms para 489 ms e o pico de memória de 3,74 GB para 52,5 MB. Os tamanhos ficam como estão por enquanto, para o histórico continuar comparável; podem subir numa próxima calibragem.

### Dados e destinos

A carga é feita pelo orquestrador, nunca pelo dataflow, e só nos cenários com `mssql` ou `mongodb` em `services`. É feita **uma vez por cenário e seed, no `size` máximo do cenário**: os flows leem o subconjunto que a run pede por parâmetro (`WHERE id <= @size` no SQL Server, `orderId <= size` no pipeline), então `--quick`, `--size` e o tamanho completo compartilham os mesmos dados e não recarregam nada. Um `--size` maior que o `size` do cenário recarrega nesse tamanho.

`load(ctx)` começa apagando os objetos de origem que vai criar (tabela, coleção), carrega em lote pelo cliente do banco, e só no fim o orquestrador grava o marcador (`dbo._perf_meta` no SQL Server, coleção `_perf_meta` no MongoDB): a chave é o id do cenário e o valor é o texto `<dataVersion>:<seed>:<tamanho carregado>`, mais a data. Marcador ausente ou diferente significa carga incompleta ou dados de outra versão, e a carga roda de novo do zero. Os volumes nomeados do compose guardam os dados entre execuções e entre reinícios do Docker.

`reset(ctx)` zera só os destinos: a coleção que o Upsert escreve (mantendo um índice único em `id`, sem o qual cada upsert varre a coleção e o cenário mediria o MongoDB, não o engine: 9,4 s contra 1 s de espera em 10 000 linhas); `POST /_reset` na API fake. As origens não são tocadas.

### A API fake (`fake-api/`)

Um servidor `Bun.serve` que o orquestrador sobe com `Bun.spawn` (`process.execPath fake-api/server.ts`) na porta 5195 quando o cenário tem `fake-api` em `services`, espera `GET /health` responder, e encerra no fim do cenário. Sem dependências, sem Docker: é um servidor de `setTimeout` que atende ~400 requisições por segundo no cenário atual, e o custo disso no processo medido é pequeno diante do que ele mede (espera externa). Rotas, só as que o cenário usa:

*   `GET /items/:id`: devolve um item gerado pela seed, com `delayMs`, `jitterMs`, `failRate` e `seed` na query string. O jitter e a decisão de falhar saem de um PRNG alimentado por `seed` e pelo **id do item**, não pela ordem de chegada: com 8 requisições em voo a ordem muda a cada run, e o resultado para um mesmo item precisa ser o mesmo.
*   `GET /_stats`: contadores (requisições, falhas devolvidas, latência p50 e p95 medida dentro do servidor) desde o último reset; `POST /_reset` zera. `GET /health` para a espera do orquestrador.

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
| `memoryDeltaBytes` | pico menos início (a métrica de memória do processo) |
| `component.<label>.activeMs`, `component.<label>.waitingMs` | `ComponentRun.activeTimeMs`, `waitingMs` do componente com esse `label` |
| `component.<label>.peakBytes` | `ComponentRun.memory.peakBytes` (ver Open Questions) |
| `fakeApi.requests`, `fakeApi.failures`, `fakeApi.p50Ms`, `fakeApi.p95Ms` | `/_stats`, só quando o cenário usa a API fake |

Uma **régua** é `{metric, direction: 'lower-is-better' | 'higher-is-better'}`: diz qual métrica o relatório mostra para o cenário e em que direção uma mudança é melhora. Não há limite nem veredito nesta versão (Non-Goals). Para cada régua o relatório mostra a **mediana** das N runs medidas, o mínimo, o máximo e a coluna "anterior" (a mediana da última execução do mesmo cenário e tamanho nesta máquina). O aquecimento e os runs com `status === 'failed'` ficam fora da conta; sem nenhum run válido, ou quando alguma amostra não tem a métrica, a linha diz "indisponível". Um run `failed` marca o cenário como falho no relatório e no JSONL, e o comando sai com 1.

O relatório é texto puro: cabeçalho do cenário (commit, dirty, máquina, serviços, tamanho, N), uma tabela com as réguas (métrica, direção, mediana, mín, máx, anterior), uma tabela dos componentes (mediana de `activeMs` e `waitingMs` por componente, ordenada por `activeMs`), a linha da API fake quando houver, e o status de cada run. No fim de tudo, um resumo por cenário e como abrir a página.

A página do relatório (`report/`: `index.html`, `style.css`, `app.ts`, `model.ts`) é estática e versionada; os dados vêm dos `results/*.jsonl`. Ela não muda a cada execução: o `app.ts` é empacotado para o navegador (`Bun.build`) e copiado com a página para `results/report/` no fim de toda execução e no `--serve`. Uma página aberta como arquivo (`file://`) não pode ler outro arquivo local com `fetch`, por isso há dois jeitos de abrir:

*   `bun run perf --serve` (ou `--serve --open`, que abre o navegador): um servidor mínimo em `http://127.0.0.1:5196` entrega a página e `results.jsonl`, que junta os `.jsonl` de todas as máquinas; recarregar a página relê os resultados. `bun run perf <cenário> --serve` abre direto no cenário; `bun run perf --open` roda e depois serve.
*   Abrir `results/report/index.html` direto: a página pede para escolher ou arrastar os `.jsonl`.

Três vistas, com todo o estado no hash da URL (`#/s/<cenário>?size=&sel=<execuções>`), de modo que voltar, recarregar e um link compartilhado mostram a mesma coisa:

*   **Visão geral**: para cada cenário, a última execução completa nesta máquina (tamanho, tempo do engine, variação contra a anterior do mesmo tamanho, um gráfico pequeno do histórico, quantas execuções, quando, commit e marcas de parcial, runs com falha, ruído, `--quick` e alterações não commitadas). Com resultados de mais de uma máquina, um seletor escolhe qual.
*   **Cenário**: abas por tamanho (resultados de tamanhos diferentes não se comparam); um gráfico do histórico de cada métrica, com a faixa mín–máx; a tabela das execuções, da mais nova para a mais antiga, com a variação de cada métrica contra a execução anterior. Clicar num ponto do gráfico ou na caixa da tabela põe ou tira a execução da comparação; por padrão ficam as duas últimas.
*   **Comparação** (embaixo da vista do cenário): as execuções escolhidas lado a lado, a mais antiga como referência. Mostra as métricas com a variação de cada uma contra a referência (verde quando foi para o lado melhor da direção, vermelho quando piorou, cinza abaixo de 2 %), o tempo ativo e de espera de cada componente com a mesma variação, e as runs de cada execução (status, tempo, CPU, memória, amostras, erro, a API fake, versões do Bun e do Docker).

O `model.ts` tem as funções puras dessas vistas, sem DOM e sem Node, testadas pelo `bun test`. Ele declara o subconjunto da linha de resultado que lê (`ReportLine`), e um teste atribui um `ResultLine` real a esse tipo, para que uma mudança no formato quebre o `bun run typecheck`.

### Resultados (`results/<hostname>.jsonl`)

Uma linha por cenário executado, `schemaVersion: 2`, só com campos brutos (um comparador futuro deriva o que precisar; `schemaVersion` cobre mudanças de formato). Cada amostra guarda o registro do run **compacto** (`src/compact.ts`): status, tempos, contagens de envelopes e memória retida por componente, quantas linhas de erro ele registrou e a primeira; os logs e as amostras de envelopes do engine ficam de fora (na versão 1 eram 99 % do arquivo: 58 MB em 21 execuções, contra 0,14 MB depois):

```text
{ schemaVersion, at, partial,
  scenario: { id, size, seed, dataVersion, services, runs, quick },
  git: { sha, dirty },
  machine: { hostname, cpuModel, cores, totalMemBytes, platform, release, bunVersion, dockerVersion, limits },
  images: { mssql: tag, mongodb: tag },
  warmup: amostra | null,
  samples: [ amostra, ... ],
  rulers: [ { metric, direction, median, min, max, previous } ] }
```

O arquivo é um por máquina, nomeado pelo `hostname` (letras, dígitos e `-`). `images` traz as tags fixas do compose. Nada disso é comparado nesta versão.

### Containers (`docker-compose.perf.yml`)

Projeto `name: dataflow-perf`, arquivo próprio dentro de `dataflow.perf/`. Dois serviços, cada um com `deploy.resources.limits` (o `docker compose` v2 aplica `cpus` e `memory` sem Swarm), healthcheck e volume nomeado. As imagens têm tag fixa (nada de `latest`):

*   `mssql`: `mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04` com `ACCEPT_EULA=Y`, `MSSQL_PID=Express`, `MSSQL_SA_PASSWORD` fixa (cumpre a complexidade que o SQL Server exige), porta `14330:1433`, 2 CPUs, 2,5 GB; healthcheck `/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT 1"` (o `sqlcmd` não está no PATH da imagem; se a tag escolhida não trouxer o `mssql-tools18`, o healthcheck vira um probe TCP na 1433 com `bash -c '</dev/tcp/127.0.0.1/1433'`). O Express exige os mesmos 2 GB para subir; o limite fica acima disso.
*   `mongodb`: `mongo:8.0.9`, porta `27030:27017`, 1 CPU, 1 GB; healthcheck `mongosh --quiet --eval "db.runCommand({ping:1}).ok"`.

`docker compose up -d --wait <serviços>` sobe só os que o cenário lista e volta quando os healthchecks passam. O orquestrador imprime, antes, quanto de memória os serviços pedem e quanto o Docker tem, e para com uma mensagem de correção quando não cabe. O SQL Server não tem imagem ARM64: em Apple Silicon o orquestrador avisa que roda emulado e que os resultados não se comparam com os de outras máquinas, e continua.

### Fronteira com o resto do monorepo

O perf é um workspace novo. Fora dele mudam o `package.json` da raiz (workspace e scripts), o `package.json` do server (campo `exports`), o `Dockerfile` do server e o `.dockerignore` (o `bun install --frozen-lockfile` dentro da imagem exige o `package.json` de todos os workspaces do lockfile; o resto do perf fica fora da imagem), e o `.gitignore`. A lista arquivo a arquivo está no plano de implementação.

O server passa a expor, por `exports`, o `runJob` (`@dataflow/server/run-job`) e os drivers (`@dataflow/server/runner/*`). O perf importa só isso; o resto do server continua privado. O `runJob` importa, ao carregar, módulos de banco do server (drizzle, repositórios), que resolvem pelo `node_modules` do próprio server; isso acontece antes da medição e não entra nos números.

O repositório instala com o linker isolado do Bun (nada é içado para o `node_modules` da raiz), então o perf declara tudo o que importa: `@dataflow/core`, `@dataflow/server`, e também `mssql`, `mongodb` e `yaml`, que o orquestrador usa na carga e nos testes. Nenhum pacote de terceiros novo entra no lockfile. Nada no core muda.

### Riscos e limites

| Risco | Tratamento |
|---|---|
| Ruído de 10 a 30 % run a run num notebook com Docker Desktop | Aquecimento descartado, N = 5, mediana e dispersão sempre visíveis; "high noise" quando a dispersão passa de 10 %; critério de aceitação nos Goals |
| Cold-start do processo novo (drivers, conexões, bundle) dentro do `durationMs` | Pré-aquecimento antes do relógio (seção do processo de medição) |
| Flow sem I/O não cede a timers: amostragem e timeout do engine não disparam | Amostragem num `Worker`; kill pelo orquestrador em `timeoutMs` + 30 s |
| `runJob` fixa o timeout do engine em 10 minutos | O kill do orquestrador usa o `timeoutMs` do cenário, sempre menor |
| API fake no mesmo host que o processo medido | Aceito: é um servidor de `setTimeout` a ~400 req/s; o `/_stats` mostra a latência dela para separar os dois |
| SQL Server Express exige 2 GB; o stack pede até 3,5 GB; sem imagem ARM64 | Checagem de `docker info` antes de subir, com a correção; aviso de emulação em Apple Silicon |
| Docker parado, ou portas 14330, 27030, 5195, 5196 ocupadas | Mensagem com a causa e o comando para liberar; código de saída 2 |
| `up --wait` sem fim se um healthcheck nunca passa (SQL Server > 60 s para subir) | `--wait-timeout 180` e mensagem com `docker compose logs <serviço>` |
| Carga interrompida deixa dados parciais | Marcador gravado só no fim; origem apagada antes de cada carga |
| Volumes e `results/*.jsonl` crescem sem limite | `docker compose -p dataflow-perf down -v` documentado no README; `results/` é local e apagável |
| Processo de medição travado ou morto no meio | Linha com `partial: true`; o `Ctrl+C` grava o que já tem |
| Formato do flow muda sem conversão | CUJ 3: `flows.test.ts` quebra no `bun run test` |

## Alternatives Considered

### Alternative A: Rodar os cenários pelo servidor (API → fila → supervisor → worker)

*   **Pros**: Mede o caminho que a produção usa; é o único jeito de ver fila, workers e, no futuro, Fire and Forget.
*   **Cons**: Soma à medida o NOTIFY e o poll de 5 s do supervisor (um NOTIFY perdido são 5 s a mais), a reutilização do worker por até 100 runs (memória de runs anteriores no pico) e a cópia do progresso para o Postgres. Exige um server e um Postgres de perf em execução, e os flows no banco, com ids que mudam a cada seed.
*   **Reason for Rejection**: Rejected by author: o ruído da fila e do worker atrapalha justamente a comparação que o perf quer permitir. Fila e workers ficam para quando houver o que medir neles (Non-Goals). O que o worker faz com o engine (`runJob`) o perf chama direto.

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
*   **Reason for Rejection**: Rejected by author: com o engine no processo, o `RunRecord` vem direto do `runJob`, sem banco.

### Alternative G: Comparar com o commit anterior e alertar regressão

*   **Pros**: Dá um veredito automático.
*   **Cons**: Variação de 10 a 30 % na mesma máquina gera alarme por ruído; deriva lenta passa; exige base por máquina, tolerância por dispersão e marcação de dirty, isto é, um subsistema inteiro.
*   **Reason for Rejection**: Rejected by author: adiado, não descartado. O JSONL guarda os fatos da máquina, o cenário e todas as amostras para que a versão seguinte compare. A coluna "anterior" do relatório não é um veredito: é o último valor, lado a lado.

### Alternative H: k6, hyperfine ou mitata

*   **Pros**: Ferramentas prontas. O k6 gera carga HTTP com relatório; o hyperfine roda um comando N vezes e dá mediana; o mitata faz micro benchmarks.
*   **Cons**: O k6 mede uma API sob muitos usuários, fora do escopo. O hyperfine só vê o tempo de relógio do processo inteiro (subida do Bun, carga dos drivers), não o `durationMs` do engine, e não lê o `RunRecord`. O mitata mede funções isoladas, não um flow com bancos. Nenhum sobe containers, carrega dados ou grava o histórico por máquina.
*   **Reason for Rejection**: Rejected by author: o que elas dariam (N runs e mediana) cabe em poucas dezenas de linhas no orquestrador; o resto do problema elas não cobrem.

### Alternative I: Amostrar a memória do processo de medição a partir do orquestrador, ou por `setInterval` no próprio processo

*   **Pros**: Do orquestrador: não depende do processo medido. Por `setInterval` no próprio processo: é o que o worker do server faz hoje (a cada 100 ms), sem código novo.
*   **Cons**: Do orquestrador: não há API portátil para ler o RSS de outro processo (`/proc/<pid>/status` no Linux, `ps` no macOS, `Get-Process` ou WMI no Windows, cada um com custo e atraso maiores que o intervalo). Por `setInterval`: o engine não cede a timers (envelopes passam por microtasks), então num flow sem I/O o timer só dispara no fim e o pico some; no worker do server isso fica escondido porque todo flow de produção tem I/O.
*   **Reason for Rejection**: Rejected by author: um `Worker` do Bun dentro do processo de medição lê `process.memoryUsage.rss()` (do processo inteiro) no próprio event loop, a cada 10 ms, portátil e sem shell.

### Alternative J: API fake em container, com limite de CPU próprio

*   **Pros**: CPU da API separada da do processo medido; sobe pelo mesmo compose.
*   **Cons**: Uma imagem a mais para construir, um healthcheck, e o port-forwarding do Docker Desktop (vpnkit no macOS, WSL2 no Windows) dentro da latência medida do único cenário cujo objetivo é a espera externa. O ganho em isolamento de CPU é pequeno: a API é um servidor de `setTimeout` a ~400 req/s.
*   **Reason for Rejection**: Rejected by author: processo local subido pelo orquestrador, sem Docker; o `/_stats` mostra a latência da própria API para separá-la do engine.

### Alternative K: Copiar no perf a montagem do `RunOptions` que o `runJob` faz, importando os drivers um a um

*   **Pros**: O perf controla cada opção (`timeoutMs` do cenário, nenhum módulo de banco do server carregado).
*   **Cons**: O próximo driver adicionado ao `runJob`, ou uma mudança nos argumentos de `prepareScript`, não chega ao perf, que passa a medir uma configuração que a produção não usa, sem aviso. Exigia importar arquivos internos do server por caminho e um flag de tsconfig (`allowImportingTsExtensions`) no consumidor.
*   **Reason for Rejection**: Rejected by author: o perf chama `runJob` com um `RunJob`, e o server expõe `run-job.ts` e `shared/runner/*` por `exports`. O custo é o timeout do engine fixo em 10 minutos (o orquestrador mata antes) e módulos de banco carregados antes da medição.

### Alternative L: Guardar hashes (impressão digital do cenário, chave da máquina, digests das imagens) no JSONL

*   **Pros**: Um comparador futuro compararia só linhas com os mesmos hashes.
*   **Cons**: Hashes são opacos: ninguém lê o que mudou. Uma chave que inclui a versão do Docker ou os limites do compose abre um arquivo novo a cada atualização e órfã o histórico; um hash do compose inteiro muda com um comentário. `schemaVersion` já permite acrescentar campos depois.
*   **Reason for Rejection**: Rejected by author: só campos brutos (fatos da máquina, cenário com seed e tamanho, tags das imagens, commit); o comparador futuro decide o que comparar.

### Alternative M: Réguas com limite e `--strict` desde a primeira versão

*   **Pros**: Um veredito dentro/fora por métrica e um código de saída para scripts.
*   **Cons**: Nenhum cenário tem limite conhecido; todos sairiam "sem limite" e `--strict` não faria nada além de falhar por run `failed`, o que não precisa de régua. Quatro estados de veredito, testes e um passo de verificação que inventa um limite impossível, para um consumidor que não existe.
*   **Reason for Rejection**: Rejected by author: réguas são `{metric, direction}`; limites e `--strict` voltam quando houver histórico que os calibre (Non-Goals).

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**: Nenhum dado real. As senhas do SQL Server e a URL do MongoDB dos containers do perf são constantes no código e só valem para `127.0.0.1` nas portas do perf. Nada do perf entra na imagem do server (`.dockerignore`), e o server nunca o importa.
*   **Performance & Latency**: O próprio perf não pode distorcer o que mede: o orquestrador não faz nada enquanto o filho roda (só espera o processo); a amostragem de RSS é uma chamada a `process.memoryUsage.rss()` a cada 10 ms num worker; sem `onProgress`. O tempo total do `bun run perf` completo deve ficar abaixo de 15 minutos numa máquina com os containers já em execução; cada cenário diz quanto demorou e o `--quick` fica abaixo de 2 minutos.
*   **Rollout & Rollback**: Nada muda em produção: o campo `exports` do server só torna importável o que já existe, e o server não o usa. As únicas alterações em entradas do build do server são a linha `COPY dataflow.perf/package.json` no `Dockerfile` e as duas linhas do `.dockerignore`, exigidas pelo `--frozen-lockfile`; `docker compose --profile server build` tem de continuar passando. Reverter é apagar a pasta e as alterações listadas em "Fronteira com o resto do monorepo".

--------------------------------------------------------------------------------

### Additional Resources

*   O documento de conceito anterior (mesmo caminho, commit `d036f09`), com a análise dos seis revisores e as decisões 1 a 12 do autor. Este documento o substitui.
*   [run-job.ts](../../dataflow.server/features/runs/run-job.ts): `RunJob` e `runJob`, o que o perf chama.
*   [worker.ts](../../dataflow.server/supervisor/workers/worker.ts): a amostragem de memória de hoje (100 ms, RSS do worker) e os nomes de uso (`startRssBytes`, `peakRssBytes`, `cpuMs`).
*   [database-drivers.test.ts](../../dataflow.server/tests/integration/database-drivers.test.ts): os drivers contra containers, a referência para as strings de conexão.
*   [flow-file.ts](../../dataflow.core/src/flows/flow-file.ts): `flowFromYaml`, `validateFlowFile`, `toExecutableFlow`.
*   [flow-runner.ts](../../dataflow.core/src/engine/flow-runner.ts), [run-record.type.ts](../../dataflow.core/src/types/run-record.type.ts), [component-run.type.ts](../../dataflow.core/src/types/component-run.type.ts): o engine e o que ele devolve.
*   [connection-access.ts](../../dataflow.core/src/connections/connection-access.ts) e [connection-types.ts](../../dataflow.core/src/connections/connection-types.ts): os perfis de conexão.

### Future Improvements

*   **Comparação com execuções anteriores**: mediana das últimas K execuções da mesma máquina e cenário, tolerância `max(X %, k × dispersão)`, "ruído alto demais para julgar", `--baseline`; com ela, limites nas réguas e `--strict`.
*   **Mais cenários**: Lookup com duas origens, Mongo Delete, TypeScript que chama a API fake, flows aninhados em profundidade.
*   **Réguas de fila e workers**: quando Fire and Forget e workers múltiplos existirem, um modo que passe pelo server.
*   **Relatório no editor**: as runs do perf numa tela do editor, com o mesmo histórico.

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
*   **Proposed Changes**: Regenerado por `bun install`. Ganha o workspace `dataflow.perf` e suas dependências (item 7); nenhum pacote de terceiros que já não esteja no lockfile.

##### 3. `./.dockerignore` (Modify)

*   **Type / Scope**: Build da imagem do server.
*   **Proposed Changes**: Logo após `dataflow.editor/*` / `!dataflow.editor/package.json`, três linhas: `# only the manifest: bun install --frozen-lockfile needs every workspace's package.json`, `dataflow.perf/*`, `!dataflow.perf/package.json`.

##### 4. `./dataflow.server/Dockerfile` (Modify)

*   **Type / Scope**: Build da imagem do server.
*   **Proposed Changes**: `COPY dataflow.perf/package.json dataflow.perf/` imediatamente após `COPY dataflow.editor/package.json dataflow.editor/`. O comentário `(.dockerignore keeps out node_modules, .env files, tests and the editor)` passa a terminar em `tests, the editor and the perf package)`. O `--filter '@dataflow/server'` já deixa o perf fora do `node_modules` da imagem.

##### 5. `./.gitignore` (Modify)

*   **Type / Scope**: Arquivos locais ignorados.
*   **Proposed Changes**: `dataflow.perf/results/*` e `!dataflow.perf/results/.gitkeep`.

##### 6. `./dataflow.server/package.json` (Modify)

*   **Type / Scope**: Manifesto do server.
*   **Proposed Changes**: Campo `"exports": {"./run-job": "./features/runs/run-job.ts", "./runner/*": "./shared/runner/*.ts"}`, logo após `"imports"`. Nada mais muda: ninguém importa `@dataflow/server` hoje, então acrescentar `exports` sem `"."` não quebra nenhum consumidor. Os módulos exportados continuam resolvendo seus próprios `#shared/*` e `#features/*` e suas dependências (`mssql`, `mongodb`, `drizzle-orm`) pelo `package.json` e pelo `node_modules` do server, porque o Bun e o `tsc` resolvem pelo caminho real do arquivo.

#### O pacote

##### 7. `./dataflow.perf/package.json` (Create)

*   **Type / Scope**: Manifesto do workspace.
*   **Proposed Changes**:
    *   `"name": "@dataflow/perf"`, `"private": true`, `"version": "0.1.0"`, `"type": "module"`; sem `engines` (como o server).
    *   `"imports"`: `"#perf/*": "./src/*.ts"`, `"#scenarios/*": "./scenarios/*.ts"`, `"#fake-api/*": "./fake-api/*.ts"`.
    *   `"scripts"`: `"perf": "bun src/cli.ts"`, `"test": "bun test"`, `"typecheck": "tsc --noEmit"`, `"fake-api": "bun fake-api/server.ts"`.
    *   `"dependencies"`: `"@dataflow/core": "workspace:*"`, `"@dataflow/server": "workspace:*"`, `"mongodb": "^7.8.0"`, `"mssql": "^12.7.13"`, `"yaml": "^2.9.1"`.
    *   `"devDependencies"`: `"@types/bun": "^1.4.4"`, `"@types/mssql": "^12.3.0"`, `"typescript": "~7.0.2"`.

##### 8. `./dataflow.perf/tsconfig.json` (Create)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: As mesmas opções do `dataflow.server/tsconfig.json` (`ES2022`, `ESNext`, `bundler`, `strict`, `noEmit`, `skipLibCheck`, `isolatedModules`, `noUnusedLocals`, `noUnusedParameters`, `types: ["bun"]`). As importações `@dataflow/server/run-job` e `@dataflow/server/runner/*` resolvem pelo `exports` do server com `moduleResolution: bundler`, sem extensão e sem flag extra. Sem `preserveSymlinks`: o `tsc` segue o link do workspace e type-checa os arquivos do server que o perf importa dentro do programa do perf, com estas opções; por isso elas têm de continuar iguais às do server. `include`: `src`, `scenarios`, `fake-api`, `tests`.

##### 9. `./dataflow.perf/README.md` (Create)

*   **Type / Scope**: Documentação do pacote.
*   **Proposed Changes**: Como rodar (`bun run perf`, as quatro flags, flags sempre depois do nome do script), o que precisa (Docker Desktop com 6 GB para containers nos cenários de banco, portas 14330/27030/5195 livres), onde ficam os resultados, como limpar (`docker compose -p dataflow-perf down -v`, apagar `results/`), como criar um cenário (pasta, `scenario.ts`, YAML pelo Download do editor usando `connection: 'perf-sqlserver'` ou `'perf-mongodb'`, `data.ts` com `DATA_VERSION`), como desenvolver a API fake (`bun run fake-api`), e os avisos (Apple Silicon emulado, memória).

##### 10. `./dataflow.perf/results/.gitkeep` (Create)

*   **Type / Scope**: Pasta dos resultados.
*   **Proposed Changes**: Arquivo vazio para a pasta existir no clone.

##### 11. `./dataflow.perf/docker-compose.perf.yml` (Create)

*   **Type / Scope**: Containers do perf.
*   **Proposed Changes**: `name: dataflow-perf`. Serviços `mssql` e `mongodb` como na seção Containers: imagens `mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04` e `mongo:8.0.9`, `deploy.resources.limits` (`cpus: "2"`, `memory: 2560M`; `cpus: "1"`, `memory: 1024M`), portas `14330:1433` e `27030:27017`, volumes nomeados `mssql` e `mongodb`, healthchecks com os comandos da seção Containers (`interval: 5s`, `retries: 36` para o `mssql`), `restart: unless-stopped`. Variáveis do SQL Server: `ACCEPT_EULA: "Y"`, `MSSQL_PID: Express`, `MSSQL_SA_PASSWORD: Perf-Passw0rd!` (a mesma constante `SA_PASSWORD` de `src/stack.ts`; o teste `stack.test.ts` confere que são iguais). Comentário no topo dizendo que é independente do `docker-compose.yml` da raiz.

#### A API fake

##### 12. `./dataflow.perf/fake-api/params.ts` (Create)

*   **Type / Scope**: Tipo compartilhado.
*   **Proposed Changes**: `type FakeApiParams = {delayMs: number; jitterMs: number; failRate: number; seed: number}` e `DEFAULT_PARAMS = {delayMs: 0, jitterMs: 0, failRate: 0, seed: 1}`. `parseParams(url: URL): FakeApiParams`: cada chave lida da query string, número inválido ou ausente vira o padrão, `failRate` limitado a `[0, 1]`, milissegundos negativos viram 0. `fakeApiUrl(base: string, path: string, params: Partial<FakeApiParams>): string`: escreve só as chaves passadas, em ordem alfabética (assim `parseParams(new URL(fakeApiUrl(...)))` devolve os mesmos valores com os padrões preenchidos).

##### 13. `./dataflow.perf/fake-api/random.ts` (Create)

*   **Type / Scope**: PRNG determinístico.
*   **Proposed Changes**: `mulberry32(seed: number): () => number` e `hashSeed(...parts: (number | string)[]): number` (FNV-1a de 32 bits sobre os textos). Usado pela API fake (atraso e falha do item `id` saem de `mulberry32(hashSeed(seed, id))`) e, pelo alias `#fake-api/random`, pelos `data.ts` dos cenários. Sem importações.

##### 14. `./dataflow.perf/fake-api/server.ts` (Create)

*   **Type / Scope**: Servidor HTTP (Bun), processo local.
*   **Proposed Changes**: `createFakeApi(port: number): {port: number; stop(): void}` com `Bun.serve` (porta 0 escolhe uma livre; `port` devolvido é a efetiva); quando executado diretamente (`import.meta.main`), usa `PORT` (padrão 5195) e fica no ar até ser encerrado. Rotas: `GET /health` → `200 {ok: true}`; `GET /items/:id` → espera `delayMs + jitter` (`jitter` em `[-jitterMs, +jitterMs]` de `mulberry32(hashSeed(seed, id))`), e com probabilidade `failRate` (do mesmo PRNG) devolve `503 {error: 'injected failure'}`, senão `200 {id, name, price, updatedAt}` gerado pelo mesmo PRNG; `GET /_stats` → `{requests, failures, p50Ms, p95Ms}`; `POST /_reset` → `204`. Latências medidas por `performance.now()` em volta da espera, guardadas num array zerado pelo `/_reset`.

#### O orquestrador e a medição

##### 15. `./dataflow.perf/src/scenario.ts` (Create)

*   **Type / Scope**: Tipos do pacote.
*   **Proposed Changes**:
    *   `type ServiceName = 'mssql' | 'mongodb' | 'fake-api'`; `type Direction = 'lower-is-better' | 'higher-is-better'`; `type Ruler = {metric: string; direction: Direction}`.
    *   `type LoadContext = {size: number; seed: number; log(line: string): void; sqlserver?: {query(sql: string, parameters?: Record<string, unknown>): Promise<Record<string, unknown>[]>; bulk(table: string, columns: {name: string; type: import('mssql').ISqlType; nullable?: boolean}[], rows: unknown[][]): Promise<void>}; mongo?: import('mongodb').Db; fakeApi?: {reset(): Promise<void>; stats(): Promise<FakeApiStats>}}` (só os serviços do cenário vêm preenchidos; `sqlserver.query` já roda no banco `perf`).
    *   `type Scenario = {id: string; description: string; services: ServiceName[]; size: number; quickSize: number; seed: number; runs?: number; timeoutMs: number; dataVersion: number; throughputNode: string; rulers: Ruler[]; load(ctx: LoadContext): Promise<void>; reset(ctx: LoadContext): Promise<void>; input?(size: number, seed: number): unknown}`.
    *   `type FakeApiStats = {requests: number; failures: number; p50Ms: number; p95Ms: number}`.
    *   `type Sample = {iteration: number; warmup: boolean; record: RunRecord; memory: {startRssBytes: number; peakRssBytes: number; endRssBytes: number; heapStartBytes: number; heapEndBytes: number; samples: number}; cpu: {cpuMs: number; userMs: number; systemMs: number}; fakeApi?: FakeApiStats}` (o filho escreve tudo menos `warmup` e `fakeApi`, que o orquestrador anexa).
    *   `type RulerResult = {metric: string; direction: Direction; median?: number; min?: number; max?: number; previous?: number}` (`median` ausente = indisponível).

##### 16. `./dataflow.perf/src/scenarios.ts` (Create)

*   **Type / Scope**: Registro.
*   **Proposed Changes**: Importa os cinco `scenario.ts` e exporta `SCENARIOS: Scenario[]` na ordem de execução (os sem Docker primeiro: `in-memory-pipeline`, `flow-invoker-fanout`, `http-slow-api`, depois `mongodb-pipeline-aggregate`, `sqlserver-to-mongodb`) e `scenarioById(id: string): Scenario | undefined`. Não imprime nem sai.

##### 17. `./dataflow.perf/src/cli.ts` (Create)

*   **Type / Scope**: Ponto de entrada.
*   **Proposed Changes**: `util.parseArgs` com `allowPositionals` e as opções `runs` (string → inteiro), `quick`, `size`, `list`. Id desconhecido ou flag inválida: lista os ids válidos no stderr e sai com 2. Uma vez: `gitInfo()` e `checkDocker()` (só se algum cenário escolhido tem `mssql` ou `mongodb`), `machineInfo(docker)`. Por cenário, nesta ordem: `warnIfEmulated(docker)` → `ensureServices(services)` (só `mssql`/`mongodb`) → `startFakeApi()` se `fake-api` está em `services` → `openLoadContext(scenario)` → `ensureData(ctx, scenario, size, seed)` → `printPlan(scenario, options, lastResult(hostname, id, size)?.rulers)` → para cada run (aquecimento, depois 1..N): `resetTargets(ctx, scenario)` → `measureOnce(...)` → `summarize(rulers, samples sem o aquecimento e sem status 'failed', scenario, previous)` → `appendResult(line)` → `printScenario(line)` → `ctx.close()` e `fakeApi.stop()`. No fim, `printSummary(lines)`. `SIGINT`/`SIGTERM`/`SIGBREAK` como o `scripts/dev.ts`: encerra o filho e a API fake (`taskkill /T /F` no Windows), grava a linha com `partial: true`, sai com 130. Código de saída: 0; 1 se algum run medido terminou `failed`; 2 em erro de infraestrutura (Docker ausente, memória insuficiente, carga falhou, filho morreu com 2).

##### 18. `./dataflow.perf/src/stack.ts` (Create)

*   **Type / Scope**: Docker e API fake.
*   **Proposed Changes**: Constantes `PACKAGE_ROOT`, `COMPOSE_FILE`, `PERF_PORTS = {mssql: 14330, mongodb: 27030, fakeApi: 5195}`, `SA_PASSWORD = 'Perf-Passw0rd!'`, `MONGO_URL = 'mongodb://127.0.0.1:27030'`, `FAKE_API_URL = 'http://127.0.0.1:5195'`, `IMAGES = {mssql: 'mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04', mongodb: 'mongo:8.0.9'}`, `SERVICE_LIMITS: Record<'mssql' | 'mongodb', {cpus: number; memoryBytes: number}>` (iguais ao compose). `checkDocker(): Promise<{memTotalBytes: number; arch: string; version: string}>` via `docker info --format json` (campos `MemTotal`, `Architecture`, `ServerVersion`); lança com a correção quando o Docker não responde ou quando a soma dos `memoryBytes` dos serviços passa de `MemTotal` (quanto falta e onde mudar no Docker Desktop). `ensureServices(services)`: `docker compose -f COMPOSE_FILE up -d --wait --wait-timeout 180 <serviços>` com a saída repassada; falha vira erro com `docker compose -p dataflow-perf logs <serviço>` sugerido. `startFakeApi(): Promise<{stop(): void}>`: `Bun.spawn([process.execPath, join(PACKAGE_ROOT, 'fake-api/server.ts')], {env: {...process.env, PORT: '5195'}})`, espera `GET /health` responder (até 10 s), erro com a causa se a porta estiver ocupada; `stop` encerra o processo. `warnIfEmulated(docker)` avisa quando `arch` é `aarch64`/`arm64` e `mssql` está nos serviços. Tudo com `Bun.spawn`, `stdout: 'pipe'`.

##### 19. `./dataflow.perf/src/load.ts` (Create)

*   **Type / Scope**: Carga e reset dos dados (o `data.ts` de cada cenário é o gerador; este módulo é quem o chama).
*   **Proposed Changes**: `openLoadContext(scenario, size, seed): Promise<LoadContext & {close(): Promise<void>}>`: para `mssql`, um `ConnectionPool` do `mssql` em `master` (`Server=127.0.0.1,14330;Database=master;User Id=sa;Password=...;Encrypt=false;TrustServerCertificate=true`), `IF DB_ID('perf') IS NULL CREATE DATABASE perf`, e depois `sqlserver.query`/`sqlserver.bulk` ligados a `perf` (um segundo pool); `bulk` usa `sql.Table` + `request.bulk` em blocos de 10 000 linhas. Para `mongodb`, `new MongoClient(MONGO_URL).db('perf')`. Para `fake-api`, `fetch` em `/_reset` e `/_stats`. `dataMarker(scenario, size, seed): string` = `` `${dataVersion}:${seed}:${size}` ``. `ensureData(ctx, scenario, size, seed)`: sem `mssql`/`mongodb` nos serviços, não faz nada; senão lê o marcador (`SELECT marker FROM dbo._perf_meta WHERE scenario = @id` / `db.collection('_perf_meta').findOne({_id: id})`), e se for igual ao marcador de `max(size, scenario.size)` imprime "data matches, load skipped" e volta; senão chama `scenario.load(ctx)` com `ctx.size = max(size, scenario.size)` e grava o marcador por último (`dbo._perf_meta(scenario nvarchar(64) PRIMARY KEY, marker nvarchar(64), at datetime2)` / `{_id, marker, at}`). `resetTargets(ctx, scenario)`: `scenario.reset(ctx)`.

##### 20. `./dataflow.perf/src/measure.ts` (Create)

*   **Type / Scope**: O lado do orquestrador da medição.
*   **Proposed Changes**: `measureOnce(scenario, {size, seed, iteration, warmup, fakeApi?}): Promise<Sample>`: `Bun.spawn([process.execPath, join(import.meta.dir, 'run-once.ts'), id, String(size), String(seed), String(iteration)], {cwd: PACKAGE_ROOT, stdout: 'pipe', stderr: 'inherit'})`; espera o fim com um timer de `scenario.timeoutMs + 30_000` que mata o filho e lança; lê o stdout inteiro, faz `JSON.parse` da última linha não vazia, define `warmup`, anexa `fakeApi` de `ctx.fakeApi.stats()` quando o cenário usa a API fake. Expõe `currentChild` para o `cli.ts` encerrar no Ctrl+C. Código de saída 2 do filho vira erro com a mensagem do stderr.

##### 21. `./dataflow.perf/src/memory-sampler.ts` (Create)

*   **Type / Scope**: Worker de amostragem.
*   **Proposed Changes**: Corpo de uma thread de `node:worker_threads`: ao carregar, liga um `setInterval` de 10 ms que guarda `Math.max(peak, process.memoryUsage.rss())` e conta as amostras, e manda `{type: 'ready'}`; ao receber `{type: 'stop'}` responde `{peakRssBytes, samples}` e o processo de medição a encerra (`terminate`). Um módulo à parte porque o `Worker` precisa de um arquivo próprio.

##### 22. `./dataflow.perf/src/run-once.ts` (Create)

*   **Type / Scope**: O processo de medição.
*   **Proposed Changes**: Lê `id, size, seed, iteration` de `process.argv`. `loadFlowFiles(id)` e `executableFlows(files, id)` de `flows.ts`. Monta o `RunJob` (tipo de `@dataflow/server/run-job`): `{id: crypto.randomUUID(), mode: 'execution', flow: main, parameters: {size: String(size)}, input: scenario.input?.(size, seed), secrets: PERF_SECRETS, variables: {}, connections: PERF_CONNECTIONS, flows, projectName: 'perf', flowName: main.flow}`. Pré-aquecimento conforme a seção do processo de medição, por serviço do cenário, com `querySqlServer`, `aggregateMongoDb`, `sendHttp` de `@dataflow/server/runner/*` e `prepareScript(code, {}, {}, {})` por nó `typescript` do flow principal. Depois: `Bun.gc(true)`; `memoryUsage()` inicial; a thread de `memory-sampler.ts`, esperando o `ready`; `process.cpuUsage()`; `const record = await runJob(job, {signal: new AbortController().signal})` (o `runJob` já devolve um `RunRecord` `failed` quando o engine lança); `cpuUsage(start)`; `stop` no worker e leitura final de RSS e heap; `closeSqlServerPools()` e `closeMongoClients()` de `@dataflow/server/runner/sqlserver-driver` e `.../mongodb-driver`; `Bun.write(Bun.stdout, JSON.stringify(sample) + '\n')`; `process.exit(0)`. Qualquer exceção fora do `runJob`: mensagem no stderr e `exit(2)`.

##### 23. `./dataflow.perf/src/flows.ts` (Create)

*   **Type / Scope**: Flows e conexões.
*   **Proposed Changes**: `loadFlowFiles(scenarioId): {path: string; text: string; file: FlowFile}[]` (lê `scenarios/<id>/flows/*.yaml` em ordem de nome, `flowFromYaml`, lança com o caminho e os erros se `ok: false` ou se o arquivo não tem `id`); `executableFlows(files, scenarioId): {main: ExecutableFlow; flows: Record<string, ExecutableFlow>}` (`toExecutableFlow(file, 'perf')`; `main` é o de `id === scenarioId`, erro se não houver; `flows` tem todos, inclusive o principal); `PERF_CONNECTIONS: Record<string, ConnectionProfileData>` e `PERF_SECRETS: Record<string, string>` com os valores de `stack.ts`. Usado pelo `run-once.ts` e pelo teste.

##### 24. `./dataflow.perf/src/metrics.ts` (Create)

*   **Type / Scope**: Extratores.
*   **Proposed Changes**: `type Extractor = (sample: Sample, scenario: Scenario) => number | undefined`; `metricOf(name: string, sample: Sample, scenario: Scenario): number | undefined`: as métricas fixas da tabela do Technical Plan; `envelopesPerSecond` soma os `outputs` do componente cujo `label` é `scenario.throughputNode` (`undefined` se não houver ou se `durationMs` for 0); `component.<label>.<activeMs|waitingMs|peakBytes>` resolvido por `record.components` (o `label` é o que fica entre o primeiro e o último `.`; `undefined` se não houver componente ou campo); `fakeApi.<requests|failures|p50Ms|p95Ms>` de `sample.fakeApi`.

##### 25. `./dataflow.perf/src/stats.ts` (Create)

*   **Type / Scope**: Mediana e dispersão.
*   **Proposed Changes**: `median(values: number[]): number`, `spread(values): {min: number; max: number}`; `summarize(rulers: Ruler[], samples: Sample[], scenario: Scenario, previous?: RulerResult[]): RulerResult[]`: o chamador já tirou o aquecimento e os runs `failed`; com `samples` vazio ou alguma amostra `undefined` para a métrica, a linha sai sem `median`/`min`/`max` (indisponível); `previous` é a `median` da mesma métrica na lista anterior, quando houver.

##### 26. `./dataflow.perf/src/report.ts` (Create)

*   **Type / Scope**: Texto no terminal.
*   **Proposed Changes**: `printPlan(scenario: Scenario, options: {runs: number; quick: boolean; size: number}, previous?: RulerResult[])` (a estimativa de tempo é a `median` de `durationMs` em `previous`), `printScenario(line: ResultLine)` (cabeçalho; tabela das réguas com métrica, direção, mediana, mín, máx, anterior, ou "indisponível"; tabela dos componentes por mediana de `component.<label>.activeMs` e `waitingMs`, ordenada por `activeMs`; linha da API fake; status por run com o número de amostras de memória; "high noise" quando `(max − min) ÷ median` de `durationMs` passa de 0,10), `printRun(sample, runs)` (uma linha por run, enquanto rodam), `printSummary(lines: ResultLine[], notRun: string[])` (os cenários que a infraestrutura impediu aparecem como "not run"). Colunas alinhadas com `padEnd`, bytes em KB abaixo de 1 MB e em MB acima, com uma casa, tempos em ms abaixo de 10 s e em s acima. Texto puro, sem cores; as mensagens em inglês, como o resto do código do repositório.

##### 27. `./dataflow.perf/src/results.ts` (Create)

*   **Type / Scope**: JSONL.
*   **Proposed Changes**: `type ResultLine` com a forma da seção Resultados e `SCHEMA_VERSION = 1`; `resultsPath(hostname: string, dir = join(PACKAGE_ROOT, 'results')): string` (`hostname` reduzido a `[a-z0-9-]`); `appendResult(line: ResultLine, dir?)`; `lastResult(hostname: string, scenarioId: string, size: number, dir?): ResultLine | undefined` (última linha do arquivo com esse cenário e tamanho e `partial: false`).

##### 28. `./dataflow.perf/src/machine.ts` (Create)

*   **Type / Scope**: Fatos da máquina e do commit.
*   **Proposed Changes**: `gitInfo(): {sha: string; dirty: boolean}` (`git rev-parse HEAD`, `git status --porcelain`); `machineInfo(docker?: {version: string}): ResultLine['machine']` = `{hostname: os.hostname(), cpuModel: os.cpus()[0].model, cores: os.cpus().length, totalMemBytes: os.totalmem(), platform: os.platform(), release: os.release(), bunVersion: Bun.version, dockerVersion: docker?.version, limits: SERVICE_LIMITS}`. Sem hashes.

#### Cenários

##### 29. `./dataflow.perf/scenarios/in-memory-pipeline/scenario.ts`, `flows/in-memory-pipeline.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário sem container.
*   **Proposed Changes**: `services: []`, `size: 10_000`, `quickSize: 1_000`, `seed: 1`, `timeoutMs: 120_000`, `throughputNode: 'Start'`, `input(size, seed)` devolve o array de `data.ts`: `{id: number; name: string; amount: number; category: 'a' | 'b'; createdAt: string}` (`DATA_VERSION = 1`). Flow: Start (`acceptsInput: true`) → Mapper (`fields: [{target: 'total', value: '$amount * 1.1', expression: true}, {target: 'year', value: '$createdAt.slice(0, 4)', expression: true}]`; itens de lista com `spread: true` são planos, `{target, value, expression}`, como em `dataflow.core/tests/helpers.ts`) → Filter (`condition: '$amount > 0'`) → Router (`cases: [{label: 'a', condition: "$category === 'a'"}]`, a saída `a` vai ao TypeScript e a saída `else` direto ao End, porque uma porta de entrada aceita uma aresta só e apenas o End aceita várias) → TypeScript (`override: true`, `code`: `function process($input) { return { ...$input, total: Math.round($input.total) }; }`; sem Override o retorno iria para `DATA.result`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `cpuPercent` (lower). `load` e `reset` vazios. As chaves de config são as de `dataflow.core/src/components/{mapper,filter,router,typescript}.ts`.

##### 30. `./dataflow.perf/scenarios/flow-invoker-fanout/scenario.ts`, `flows/flow-invoker-fanout.yaml`, `flows/perf-child-mapper.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário sem container, dois flows.
*   **Proposed Changes**: `services: []`, `size: 20_000`, `quickSize: 2_000`, `seed: 1`, `timeoutMs: 180_000`, `throughputNode: 'Start'`, `input` = array de `{id: number; amount: number}` (`DATA_VERSION = 1`). Principal: Start (`acceptsInput: true`) → Flow Invoker (`config: {flowId: 'perf-child-mapper', parameters: [], sendEnvelope: true}`) → End. Filho (`id: perf-child-mapper`): Start (`acceptsInput: true`) → Mapper (`fields: [{target: 'double', value: '$amount * 2', expression: true}]`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `component.Flow Invoker.waitingMs` (lower).

##### 31. `./dataflow.perf/scenarios/sqlserver-to-mongodb/scenario.ts`, `flows/sqlserver-to-mongodb.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com dois bancos.
*   **Proposed Changes**: `services: ['mssql', 'mongodb']`, `size: 50_000`, `quickSize: 5_000`, `seed: 1`, `timeoutMs: 300_000`, `throughputNode: 'SQL Server Query'`. `data.ts`: linhas `{id: number; name: string; email: string; balance: number; since: Date}` (`DATA_VERSION = 1`). `load`: `DROP TABLE IF EXISTS dbo.Customer`, `CREATE TABLE dbo.Customer (id int PRIMARY KEY, name nvarchar(80), email nvarchar(120), balance decimal(12,2), since datetime2)`, `ctx.sqlserver.bulk('dbo.Customer', colunas, linhas)`. `reset`: `deleteMany({})` em `customers` e `createIndex({id: 1}, {unique: true})` (idempotente). Flow: Start (`parameters: [{name: 'size', type: 'number', default: '50000'}]`; o `default` é texto, como `startConfig` lê, e o tipo `number` faz `$PARAMETERS.size` chegar como número) → SQL Server Query (`connection: 'perf-sqlserver'`, `sql: 'SELECT id, name, email, balance, since FROM dbo.Customer WHERE id <= @size ORDER BY id'`, `parameters: [{name: 'size', value: '$PARAMETERS.size', expression: true}]`) → Mapper (`fields: [{target: 'fullName', value: '$name.toUpperCase()', expression: true}, {target: 'balanceCents', value: 'Math.round($balance * 100)', expression: true}]`) → MongoDB Upsert (`connection: 'perf-mongodb'`, `database: ''`, `collection: 'customers'`, `filter: [{field: 'id', value: '$id', expression: true}]`, `source: 'data'`, `batchSize: 500`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `memoryDeltaBytes` (lower), `component.SQL Server Query.waitingMs` (lower), `component.MongoDB Upsert.waitingMs` (lower).

##### 32. `./dataflow.perf/scenarios/mongodb-pipeline-aggregate/scenario.ts`, `flows/mongodb-pipeline-aggregate.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com MongoDB.
*   **Proposed Changes**: `services: ['mongodb']`, `size: 100_000`, `quickSize: 10_000`, `seed: 1`, `timeoutMs: 300_000`, `throughputNode: 'MongoDB Pipeline'`. `data.ts`: documentos `{orderId: number; customerId: number; status: 'paid' | 'cancelled'; total: number; items: {sku: string; qty: number}[]; placedAt: Date}` com `placedAt` entre 2025-01-01 e 2025-12-31 e `customerId` em `[1, size / 20]` (`DATA_VERSION = 1`). `load`: `drop()` da coleção `orders`, `insertMany` em blocos de 10 000 (`ordered: false`), índice em `{orderId: 1}`. `reset` vazio (só leitura). Flow: Start (`parameters: [{name: 'size', type: 'number', default: '100000'}]`) → MongoDB Pipeline (`connection: 'perf-mongodb'`, `database: ''`, `collection: 'orders'`, pipeline: `[{$match: {orderId: {$lte: $PARAMETERS.size}}}, {$group: {_id: '$customerId', total: {$sum: '$total'}, orders: {$sum: 1}, cancelled: {$sum: {$cond: [{$eq: ['$status', 'cancelled']}, 1, 0]}}}}]`; o texto do pipeline é uma expressão JS avaliada por envelope (`pipelineExpression` de `mongodb-pipeline.ts`), por isso `$PARAMETERS.size` entra direto) → Filter (`condition: '$cancelled < $orders'`) → Aggregate (`size: 500`, `field: 'items'`) → TypeScript (`override: true`, `function process($input) { return { count: $input.items.length, total: $input.items.reduce((sum, i) => sum + i.total, 0) }; }`) → Sort (`keys: [{value: '$total', direction: 'desc'}]`) → Limit (`mode: 'top'`, `count: 100`) → End. O `throughputNode` conta os grupos que saem do pipeline (≈ `size` ÷ 20), não os documentos lidos; a coluna de tamanho da tabela de cenários é o que o banco lê. Réguas: `durationMs` (lower), `memoryDeltaBytes` (lower), `component.Aggregate.peakBytes` (lower), `component.Sort.peakBytes` (lower), `component.MongoDB Pipeline.waitingMs` (lower).

##### 33. `./dataflow.perf/scenarios/http-slow-api/scenario.ts`, `flows/http-slow-api.yaml`, `data.ts` (Create)

*   **Type / Scope**: Cenário com a API fake.
*   **Proposed Changes**: `services: ['fake-api']`, `size: 2_000`, `quickSize: 200`, `seed: 7`, `timeoutMs: 180_000`, `throughputNode: 'Start'`, `input` = array de `{id: number}` (`DATA_VERSION = 1`). `scenario.ts` exporta `FAKE_API_PARAMS: Partial<FakeApiParams> = {delayMs: 20, jitterMs: 10, failRate: 0.02, seed: 7}`. `load` vazio; `reset`: `ctx.fakeApi.reset()`. Flow: Start (`acceptsInput: true`) → HTTP Request (`method: 'GET'`, `url: {value: '`http://127.0.0.1:5195/items/${$id}?delayMs=20&failRate=0.02&jitterMs=10&seed=7`', expression: true}` (um template literal avaliado por envelope; com `expression: false` o `$id` iria literal na URL), `concurrency: 8`, `failOnError: true`, `onError: 'divert'`, porta de erro ligada a um Discard) → Mapper (`fields: [{target: 'price', value: '$response.body.price', expression: true}]`) → End. Réguas: `durationMs` (lower), `envelopesPerSecond` (higher), `component.HTTP Request.waitingMs` (lower), `fakeApi.p95Ms` (lower), `fakeApi.failures` (lower).

#### Testes (rodam no `bun run test` da raiz, sem Docker)

##### 34. `./dataflow.perf/tests/flows.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Para cada cenário de `SCENARIOS`: todos os YAML passam por `flowFromYaml` com `ok: true` (falha com o caminho e os erros); existe um flow com `id` igual ao id do cenário; cada `config.flowId` de um Flow Invoker aponta para um `id` presente na pasta; cada `config.connection` não vazio está em `PERF_CONNECTIONS`; `componentIssues(type, config)` do core não devolve problema para nenhum nó; todo item de lista com `spread` (campos do Mapper, parâmetros do SQL Server, filtro do Upsert, parâmetros do Flow Invoker) é plano, com `expression` booleano no próprio item (o `componentIssues` não pega a forma aninhada, e ela faria o engine tratar o objeto como valor literal); existe um componente com `label === throughputNode`; no `http-slow-api`, `parseParams(new URL(url do nó HTTP Request com '${$id}' trocado por '1'))` é igual a `{...DEFAULT_PARAMS, ...FAKE_API_PARAMS}`; `runJob` com o `RunJob` que o `run-once.ts` monta e um `signal` já abortado resolve com `status === 'failed'` sem lançar (o engine aceita o flow e falha de forma controlada pelo sinal e pela falta dos containers).

##### 35. `./dataflow.perf/tests/metrics.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Uma `Sample` fabricada com dois componentes: `envelopesPerSecond` usa o `throughputNode`; `memoryDeltaBytes` é pico menos início; `component.X.activeMs` de um label inexistente é `undefined`; `fakeApi.*` é `undefined` sem `fakeApi`; label com ponto no nome resolve.

##### 36. `./dataflow.perf/tests/stats.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Mediana de N par e ímpar; `spread`; `summarize` deixa a linha sem `median` quando uma amostra não tem a métrica ou quando `samples` está vazio; `previous` preenchido a partir de uma lista anterior.

##### 37. `./dataflow.perf/tests/fake-api.test.ts` (Create)

*   **Type / Scope**: Teste de integração local (sem Docker).
*   **Proposed Changes**: `const api = createFakeApi(0)`; o mesmo `id` com a mesma `seed` dá o mesmo atraso e a mesma decisão de falha em duas rodadas após `/_reset`, mesmo com as requisições disparadas em ordem diferente; `failRate: 0` nunca falha; `/_stats` conta requisições e falhas; `parseParams` ignora valores inválidos e limita `failRate`; `parseParams(new URL(fakeApiUrl(base, path, p)))` devolve `{...DEFAULT_PARAMS, ...p}`. `api.stop()` no fim.

##### 38. `./dataflow.perf/tests/results.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Com `dir` numa pasta temporária: `appendResult` escreve uma linha JSON por chamada com o `SCHEMA_VERSION` atual; `lastResult` devolve a última do cenário e tamanho pedidos e ignora `partial: true`; `historyOf` e `latestPerScenario` devolvem o histórico de um cenário e o último resultado de cada um; `resultsPath` reduz um `hostname` com espaços e maiúsculas a `[a-z0-9-]`.

##### 39. `./dataflow.perf/tests/stack.test.ts` (Create)

*   **Type / Scope**: Teste unitário.
*   **Proposed Changes**: Lê o `docker-compose.perf.yml` com `yaml` e confere: `name: dataflow-perf`; nenhuma porta publicada igual a 5180, 5190 ou 5432, e as publicadas são as de `PERF_PORTS`; `MSSQL_SA_PASSWORD` igual a `SA_PASSWORD`; `deploy.resources.limits.memory` de cada serviço, convertido de `M`/`G` para bytes, igual a `SERVICE_LIMITS[serviço].memoryBytes`; cada `image` igual a `IMAGES[serviço]` e sem `latest`.

#### Acrescentados depois da primeira execução

##### 40. `./dataflow.perf/src/compact.ts` (Create)

*   **Type / Scope**: Registro compacto.
*   **Proposed Changes**: `type CompactComponent` (de `ComponentRun`: `nodeId`, `label`, `type`, `status`, `durationMs`, `activeTimeMs`, `waitingMs`, `memory`, `inputs`, `outputs`, mais `subRuns` como contagem, `errors` e `firstError` com até 300 caracteres) e `type CompactRecord` (o `RunRecord` com esses componentes). `compactRecord(record)` é idempotente. O `run-once.ts` compacta antes de escrever a amostra; `Sample.record` passa a ser `CompactRecord`.

##### 41. `./dataflow.perf/report/index.html`, `report/style.css`, `report/model.ts`, `report/app.ts`, `report/tsconfig.json` (Create)

*   **Type / Scope**: A página do relatório (estática, sem dependências, tema claro ou escuro do sistema).
*   **Proposed Changes**: `index.html` carrega `style.css` e `app.js` como script clássico (`defer`), não como módulo: o Chrome recusa `<script type="module">` numa página aberta como arquivo. `model.ts`: o tipo `ReportLine` e as funções `parseResults`, `summaries`, `sizesOf`, `executionsOf`, `changeOf` (limiar de 2 %), `noise`, `compareMetrics`, `compareComponents`, `seriesOf`, `defaultSelection`. `app.ts`: lê `results.jsonl` do servidor ou, aberto como arquivo, pelo seletor ou arrastando o arquivo; monta as três vistas a partir do hash; todo texto vindo dos resultados é escapado. `tsconfig.json` próprio, com a `lib` DOM, que o resto do pacote não tem; o `typecheck` do pacote roda os dois.

##### 42. `./dataflow.perf/src/report-site.ts` e `./dataflow.perf/src/format.ts` (Create); `./dataflow.perf/src/stack.ts` (Modify)

*   **Type / Scope**: Montagem e servidor da página; formatação compartilhada.
*   **Proposed Changes**: `buildReport(dir?)`: empacota `report/app.ts` com `Bun.build` (alvo navegador, formato IIFE) e copia `index.html` e `style.css` para `results/report/`. `allResults(dir?)`: junta os `*.jsonl`. `serveReport(port?, dir?)`: monta a página e serve `/`, `app.js`, `style.css` e `/results.jsonl` em `127.0.0.1`, e devolve 404 para qualquer outro caminho. `format.ts`: `formatMetric` e `formatMs`, sem imports, usados pelo terminal e pela página. `PERF_PORTS.report = 5196`. O `cli.ts` ganha `--serve` (serve até o Ctrl+C, abrindo no cenário quando há um só) e `--open` (abre o navegador; depois de uma execução, serve e abre); no fim de toda execução monta a página e diz como abri-la.

##### 43. `./dataflow.perf/tests/compact.test.ts`, `tests/model.test.ts`, `tests/report-site.test.ts` (Create)

*   **Type / Scope**: Testes unitários.
*   **Proposed Changes**: `compactRecord` mantém o que as métricas leem, conta os erros, é idempotente e deixa a linha 50 vezes menor. O modelo: linhas quebradas são puladas, a ordem é a das datas, a última execução de cada cenário vem com a anterior do mesmo tamanho, as métricas e os componentes são comparados contra a referência na direção certa, e um `ResultLine` real é atribuível a `ReportLine`. O site: a página montada não carrega nada de fora e o `app.js` é um bundle só; os `.jsonl` são juntados; o servidor entrega a página e os resultados e devolve 404 para o resto.

### Verification Plan

*   **Compilation/Build**: `bun install` (lockfile só com o workspace novo); `bun run typecheck` na raiz, incluindo o perf (as importações `@dataflow/server/run-job` e `@dataflow/server/runner/*` resolvem pelo `exports`); `bun run --cwd=dataflow.server typecheck` continua passando com o `exports`; `docker compose --profile server build` continua passando com o Dockerfile alterado.
*   **Unit Tests**: `bun run test` na raiz roda os testes do perf sem Docker; `bun test --cwd=dataflow.perf` isolado.
*   **Static Analysis & Linting**: Não há linter na raiz hoje; o typecheck com `noUnusedLocals` e `noUnusedParameters` é o que existe.
*   **Test Coverage Requirement**: Nenhuma meta numérica. O que precisa estar coberto: validação dos flows de todos os cenários, extratores, mediana e dispersão, determinismo da API fake, formato do JSONL, invariantes do compose.
*   **E2E/Integration (manual, com Docker)**:
    1. `bun run perf --list` lista cinco cenários.
    2. `bun run perf in-memory-pipeline --quick` termina em menos de 1 minuto sem tocar no Docker, grava uma linha em `results/` e mostra o pico de memória acima do início e cerca de uma amostra de memória a cada 10 ms do run (a thread amostrou durante o flow; na primeira execução, 492 a 526 amostras em runs de 5,4 a 5,7 s).
    3. `bun run perf sqlserver-to-mongodb` sobe só `mssql` e `mongodb` (`docker ps` não mostra nada da API fake), carrega os dados uma vez (a segunda execução, e também `--quick`, imprimem "data matches, load skipped"), e `docker compose -p dataflow ps` do dev fica como estava.
    4. `bun run perf` completo com os containers já em execução: tempo total anotado no relatório (meta: abaixo de 15 minutos; informativo).
    5. `Ctrl+C` no meio de um cenário deixa uma linha com `partial: true`, os containers em execução e nenhum processo da API fake vivo.
    6. Com `bun run dev` rodando ao mesmo tempo, o editor em :5180 continua funcionando durante o passo 3.
    7. `bun run perf http-slow-api --quick` duas vezes: `fakeApi.failures` igual nas duas; a segunda mostra a coluna "anterior" preenchida.
    8. `bun run perf --serve --open` abre a visão geral; clicar num cenário mostra o histórico e as duas últimas execuções comparadas; tirar uma pela caixa da tabela muda o hash e a comparação; aberta como arquivo, a página pede o `.jsonl` e, com ele, mostra o mesmo. A linha nova do JSONL tem poucos KB por cenário.
    9. Acrescentar um driver fictício ao `runJob` do server e conferir, pelo stderr de um run, que o `run-once.ts` o recebeu sem alteração no perf; reverter.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
