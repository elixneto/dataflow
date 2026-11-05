# Continuação do egm-draft do dataflow.perf

Estado em 2026-11-05, thread "Improve the Flow Invoker component".

## O que já existe

- `docs/designs/dataflow-perf.md`: o concepts brief do egm-brainstorm, publicado como RFC (commit d036f09 em v0). No fim do egm-draft, o design final substitui esse arquivo.
- `docs/designs/dataflow-perf.draft.md`: o `design_draft.md` do egm-draft, com a primeira seção escrita (Overview, The Problem, Goals, Non-Goals, Open Questions). Ainda não aprovada pelo autor.

## Decisões do autor que o design precisa respeitar (todas no brief, seção "Key Decisions")

1. Pacote `dataflow.perf` no workspace, fora do deploy (não entra na imagem do server).
2. `bun run perf` e `bun run perf <cenário>`; relatório só em texto no terminal.
3. Engine no próprio processo (`flowRunner` do core), um processo Bun novo por run, sem API, fila nem supervisor. Server, Postgres e portas 5180/5190/5432 do dev intocados.
4. Drivers importados de `dataflow.server/shared/runner` (sqlserver-driver, mongodb-driver, send-http, evaluate, prepare-script).
5. Flows de cenário são JSON estáticos dentro do perf; nunca vão para o banco nem para o editor. Mapas `connections` e `flows` passados direto ao `flowRunner`.
6. Memória como delta: início, pico amostrado durante a run (10 a 20 ms), fim.
7. Sem comparação com execuções anteriores nesta versão; resultados guardados em JSONL em `dataflow.perf/results/` (gitignore) para permitir depois.
8. Containers num `docker-compose.perf.yml` próprio (`name: dataflow-perf`, portas e volumes próprios), que ficam de pé entre execuções; só sobem os serviços que o cenário precisa.
9. SQL Server imagem 2022 com `MSSQL_PID=Express`, tag fixa.
10. Réguas configuráveis por cenário, com direção; métrica inexistente aparece como "indisponível".

## Próximos passos do egm-draft (SKILL.md do plugin google/elephant-goldfish-model)

- Gate de aprovação da seção 1 (Overview & Goals).
- Step 3: Technical Plan (com diagrama em texto).
- Step 4: Alternatives Considered (a partir de "Alternatives Weighed" do brief).
- Step 5: Detailed Implementation (todos os arquivos, sem código).
- Step 6: reconciliar com o brief, gravar em `docs/designs/dataflow-perf.md`, apagar o `.draft.md`, recomendar `egm-review`.

## Como a sessão anterior rodou o EGM sem o plugin

Clonou `https://github.com/google/elephant-goldfish-model` numa pasta temporária e leu `skills/egm-brainstorm/SKILL.md`, `skills/egm-draft/SKILL.md`, `skills/egm-draft/references/design_doc.md` e `agents/*.md`. Os seis revisores Goldfish foram subagentes em paralelo, cada um lendo o arquivo da sua persona. Se o plugin estiver instalado (`claude plugin install egm@egm`), usar `/egm:egm-draft docs/designs/dataflow-perf.draft.md`.
