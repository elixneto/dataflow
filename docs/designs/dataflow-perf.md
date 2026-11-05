# dataflow.perf: cenários de performance para alertar regressão entre commits

* **Author:** Élix Neto
* **Date:** 2026-11-05

## Overview

Um conjunto de cenários de performance que qualquer pessoa que clonar o repositório pode rodar com `bun run perf`, e que nunca vai para o deploy do app. Cada cenário é um ou mais flows, com dados gerados de forma determinística, contra MongoDB, SQL Server e uma API HTTP fake (com atraso, falhas e paginação configuráveis), em containers próprios com limite de CPU e RAM. O engine roda isolado, num processo próprio (`flowRunner` do core), sem passar pela API, pela fila nem pelo supervisor, e sem tocar no server e no Postgres que o editor (:5180) usa. O relatório no terminal mostra os números de cada run contra as réguas do cenário. Ele não bloqueia nada.

**Decisões do autor após a revisão (2026-11-05):** memória medida como delta (antes e depois de cada run); sem comparação com execuções anteriores nesta versão; engine isolado no processo, com tudo o que o perf precisa rodando à parte do ambiente de dev.

O objetivo é prevenção: não há incidente de performance conhecido hoje. As metas (réguas) ainda não existem e vão sair dos números das primeiras execuções.

## Analysis

Seis revisores sem o contexto da conversa leram a hipótese e o código. Os pontos abaixo estão agrupados e ordenados pelo que mais muda o desenho.

### 1. O número de memória de hoje não serve para a régua (todos os revisores)

O pico de memória é medido no processo do worker (`supervisor/workers/worker.ts`, uma amostra a cada 100 ms), e o worker é reutilizado por até 100 runs (`process-pool.ts`, `maxRunsPerWorker = 100`). Por isso o pico de uma run inclui memória que sobrou das anteriores e depende de quando o GC rodou. Uma régua como "pico <= 256 MB" ou "mais pesado que o commit anterior" vai disparar por ruído.

**Decidido:** com o engine no próprio processo, cada run medida roda num processo Bun novo, então não sobra memória de runs anteriores. A régua usa o delta: memória antes da run, pico durante e memória depois. Só o "antes e depois" não basta, porque o GC pode liberar memória antes do "depois" e esconder o pico. Por isso o pico é amostrado durante a run (a cada 10 a 20 ms), e o relatório mostra pico menos início.

### 2. "Tempo" precisa dizer qual relógio usa

Existem três tempos diferentes. O `duration_ms` é o tempo do engine e o mais estável. A espera na fila (`started_at - queued_at`) depende do NOTIFY e do poll de 5 s do supervisor: um NOTIFY perdido soma 5 s e estoura uma régua de 10 s sozinho. E há o tempo de relógio medido pelo script. A régua principal deve ser o `duration_ms`. A fila aparece separada e não entra na comparação de regressão.

### 3. Comparar com "o commit anterior" gera alarme falso (adiado pelo autor)

Num notebook com Docker Desktop, a mesma run varia de 10 a 30% (temperatura, outros apps, VM do Docker). E regressões costumam entrar aos poucos, um pouco a cada commit. Comparar só com a execução anterior pega ruído e perde a deriva lenta. Os revisores convergiram em:

- 1 ou 2 runs de aquecimento descartadas (JIT, cache de plano do SQL Server, cache do Mongo, pools de conexão).
- N = 5 runs, mediana mais a dispersão (mín/máx ou IQR), guardando todas as amostras.
- Base de comparação: a mediana das últimas K execuções na mesma máquina e no mesmo cenário, com `--baseline <ref>` para escolher outra.
- Alertar só quando a mudança passa de max(X%, k vezes a dispersão). Quando a dispersão é maior que a tolerância, o relatório diz "ruído alto demais para julgar".
- Execução com alterações não commitadas fica marcada como `<sha>-dirty` e não entra na base.

### 4. "Máquina" e "comparável" precisam de definição

Comparar só por commit e máquina não basta. Mudar o cenário, o gerador de dados, a API fake ou os limites do Docker muda os números tanto quanto um commit do engine. Cada resultado guarda:

- a chave da máquina: modelo de CPU, núcleos, RAM, sistema, versão do Docker e do Bun, limites do compose;
- uma impressão digital do cenário: hash dos flows, seed, versão do gerador, réguas e configuração do stack;
- os digests das imagens. Hoje os testes usam `mssql/server:2022-latest`, e o `latest` muda sozinho.

Resultados só se comparam com a mesma chave e a mesma impressão digital. Se algo mudar, o relatório diz "nova base" em vez de "regressão".

### 5. Algumas réguas medem coisas que não existem

"Runs inline disparadas" depende do Fire and Forget, que não existe. "Workers usados" é sempre 1 por run hoje: o Flow Invoker roda os filhos no mesmo processo (`invoke-flow.ts`), e os filhos não têm linha própria nem medição de uso. As réguas devem ser um registro de extratores de métrica: cada um devolve um valor ou "indisponível", e o relatório mostra o indisponível como pulado, nunca como erro.

### 6. Flows de cenário guardam ids do banco

Um flow baixado do editor referencia conexões e o flow chamado por id (`config.flowId`, ids de perfil de conexão). **Decidido:** os flows de cenário são JSON estáticos dentro do `dataflow.perf`, montados no próprio processo, e nunca vão para o banco do server nem para o editor. Os ids são fixos no cenário: o perf passa ao `flowRunner` o mapa `connections` (id → perfil apontando para os containers do perf) e o mapa `flows` (id → flow) para o Flow Invoker.

### 7. O formato do flow vai mudar e quebrar os cenários

`validateFlowFile` recusa qualquer versão diferente de 1, e ainda não existe conversão de versões antigas. O perf deve ler os flows só pelas funções do core. Um teste unitário barato, rodando no `bun run test` normal, valida todos os flows de cenário. Assim uma mudança de formato quebra o teste do dia a dia, e não aparece meses depois numa execução de perf.

### 8. Acoplamento com o servidor

Superado pela decisão de rodar o engine no processo: o perf não fala com o servidor. **Decidido:** ele importa os drivers de `dataflow.server/shared/runner` (SQL Server, MongoDB, HTTP, `evaluate`, `prepareScript`). Esse é o único ponto de acoplamento, e um typecheck do perf no `bun run typecheck` pega quando ele quebrar.

### 9. Docker e lockfile

O `Dockerfile` do server copia só alguns `package.json` e roda `bun install --frozen-lockfile`. Um workspace novo `dataflow.perf` pode quebrar o build da imagem já no primeiro commit. É preciso copiar só o `package.json` dele e deixar o resto de fora pelo `.dockerignore`. O stack de perf precisa de arquivo e nome de projeto próprios (`docker-compose.perf.yml`, `name: dataflow-perf`), com portas e volumes diferentes. Assim ele roda junto com o dev, que usa 5432 e 5190, sem mexer no Postgres do dev. A imagem do server é sempre reconstruída a partir do código atual: uma imagem em cache mediria o código errado.

### 10. Custo de rodar

O SQL Server pede cerca de 2 GB de RAM e não tem imagem ARM64: no Mac com Apple Silicon roda emulado, lento e não comparável. O stack inteiro fica em 4 a 6 GB, mais o overhead do WSL2 no Windows. A primeira execução baixa imagens de vários GB e espera o SQL Server subir (30 a 60 s). Para alguém usar:

- cada cenário declara os serviços que precisa, e `bun run perf <cenário>` só sobe esses;
- os dados são gerados uma vez por seed e tamanho, num volume nomeado, conferidos por hash, e carregados em lote (bulk insert, `insertMany`), nunca pelo próprio dataflow;
- as coleções e tabelas de destino são zeradas entre iterações (upsert num destino cheio mede outra coisa);
- o tempo total fica abaixo de 10 a 15 minutos, com estimativa no início, `--quick` (sem aquecimento, N menor) e resultados parciais salvos no Ctrl+C;
- uma checagem inicial do Docker e da memória disponível, com a correção sugerida.

### 11. A API fake pode virar o gargalo

Um único processo Bun servindo atraso, jitter, paginação e rate limit pode saturar antes do engine e medir a si mesmo. Ela precisa de CPU própria. O relatório mostra os contadores e a latência dela. O jitter e a taxa de falha saem da seed do cenário, não de `Math.random`. Os parâmetros da query string viram interface e ficam num construtor tipado.

### 12. O contrapeso: isso é um subsistema inteiro antes de existir o problema (decidido: engine no próprio processo)

O revisor de YAGNI propôs uma v0 bem menor: um script com Testcontainers (reaproveitando `database-drivers.test.ts`), 3 cenários rodando o engine no próprio processo (`flowRunner` do core, sem API, fila e supervisor), 5 runs, uma linha JSON por execução e a variação contra a mediana das últimas 5. Sem pacote novo, sem compose de perf e sem DSL de réguas até os números se mostrarem estáveis. O argumento mais forte: passar pela fila e pelo worker soma ruído a todos os números, justamente o que atrapalha a comparação. O contra-argumento: Fire and Forget, workers e fila só aparecem passando pelo servidor.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * `bun run perf` e `bun run perf <cenário>`, com relatório em texto no terminal e um arquivo JSONL por máquina em `dataflow.perf/results/` (fora do git), com `schemaVersion`.
  * Cenários versionados no repositório: uma pasta por cenário com `scenario.ts` (réguas, N, dados, serviços), `flows/*.yaml` com nomes lógicos e `data.ts`.
  * Métricas por run: `duration_ms` do engine, espera na fila (só informativa), CPU, pico e crescimento de memória, envelopes por segundo (calculado), tempo ativo e de espera por componente.
  * Cada run mostra seus números contra as réguas do cenário (dentro ou fora), com mediana e dispersão das N runs. Código 0 por padrão; `--strict` sai com erro quando uma régua estoura.
  * Engine isolado: um processo Bun novo por run medida, bancos e API fake em containers próprios, sem tocar no server, no Postgres nem nas portas do dev.
  * O relatório aponta o componente cujo tempo ativo ou de espera mais mudou e inclui os ids das runs para abrir no editor.
  * Stack de perf isolado (`docker-compose.perf.yml`), com limites de CPU e RAM e imagens fixadas por digest.
* **Out-of-Scope Non-Goals:**
  * Carga na API ou no editor (muitos usuários ao mesmo tempo).
  * Várias máquinas ou carga distribuída.
  * Bloquear merge ou CI.
  * Simular falhas reais de rede; a lentidão vem só da API fake.
  * Monitorar produção.
  * Comparar resultados entre máquinas diferentes.
  * Réguas de Fire and Forget e de workers múltiplos até essas funções existirem.
  * Comparação com execuções anteriores e alerta de regressão entre commits (fica para depois; os resultados já são guardados para permitir isso).
  * Medir API, fila e supervisor.

## Alternatives Weighed

* **Perfil `lab` dentro do `docker-compose.yml` atual:** rejeitado pelos revisores, porque compartilha o volume do Postgres e as portas 5432/5190 com o dev.
* **Projeto Lab criado pelo seed de dev, com flows guardados só no banco:** substituído por flows versionados em arquivos com nomes lógicos, criados pela API no setup do perf. No banco eles não sobrevivem a uma mudança de formato e não ficam no git.
* **Comparar só com o commit anterior:** rejeitado. Gera alarme por ruído e perde deriva lenta.
* **Ler as métricas direto do Postgres:** rejeitado. Acopla o perf ao esquema, que já está na migração 6.
* **k6:** rejeitado pela revisão. Serve para muitos usuários contra uma API, o que está fora do escopo.
* **hyperfine ou mitata:** ainda em aberto. O hyperfine cobre N runs com mediana para um comando; o mitata, micro benchmarks de componentes. Nenhum dos dois cobre bancos nem histórico por máquina.
* **v0 mínima no próprio processo (sem servidor):** em aberto, ver a seção 12 da análise.

## Key Decisions & Staging for Next Steps

Já decidido com o autor:

1. Pacote `dataflow.perf`, acessível a quem clonar o repositório, fora do deploy.
2. `bun run perf` é o ponto de entrada; o relatório é texto no terminal por enquanto.
3. Histórico só na máquina, fora do git.
4. Alerta, não bloqueia.
5. Réguas configuráveis por cenário; as metas saem das primeiras execuções.

Para decidir antes do `egm-draft`:

6. Engine no próprio processo (`flowRunner`), um processo novo por run, sem servidor. Ambiente de dev intocado.
7. Memória como delta: início, pico amostrado durante a run e fim.
8. Sem comparação com execuções anteriores nesta versão.
9. Drivers importados de `dataflow.server/shared/runner`.
10. Flows de cenário são JSON estáticos dentro do perf, montados no processo; nunca vão para o banco do server nem para o editor.
11. Containers do perf num `docker-compose.perf.yml` próprio (`name: dataflow-perf`, portas e volumes próprios), que ficam de pé entre execuções. As imagens são baixadas uma vez por máquina; os dados de cada cenário são zerados entre iterações. Só sobem os serviços que o cenário escolhido precisa.
12. SQL Server na imagem 2022 com `MSSQL_PID=Express` e tag fixa.

Para decidir antes do `egm-draft`:

1. **SQL Server desde o início?** Pelo custo de 2 GB e por não ter imagem ARM64. Versões leves: o LocalDB só existe no Windows, fora do Docker; a edição Express usa a mesma imagem (`MSSQL_PID=Express`) com a mesma exigência de 2 GB, mas limita o buffer pool a cerca de 1,4 GB e o banco a 10 GB; o Azure SQL Edge (que tinha ARM64) foi descontinuado.
2. **Mudança no core que o perf exige:** conversão de versões antigas do flow antes de existir a versão 2.
