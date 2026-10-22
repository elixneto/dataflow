# dataflow — fluxos de dados visuais, envelope a envelope (tudo em JavaScript)

Visão geral, conceitos e como rodar: [README.md](README.md). Arquitetura do motor: [docs/arquitetura.md](docs/arquitetura.md).

| Pasta | O que é | Detalhes |
|---|---|---|
| `editor/` | Aplicação (Vite + React + React Flow) na raiz: projetos → fluxos (editor), execuções, segredos, arquivos | ver [editor/CLAUDE.md](editor/CLAUDE.md) |
| `core/` | Motor em TypeScript sem React nem Node: contrato, envelope, componentes (lógica), execução envelope a envelope | usado pelo editor (alias `@dataflow/core`) e pelo runner |
| `runner/` | Runner em Bun + Hono (porta 5190): execuções, segredos e arquivos por projeto, expressions e scripts no `node:vm` | roda à parte; o editor fala com ele por `/api` |

## Comandos (na raiz)

- `npm run instalar` — instala as dependências das três partes (uma vez).
- `npm run start` — sobe **runner e editor juntos** (concurrently, um terminal); abre em http://localhost:5180/ (lista de projetos).
- `npm test` — testes do core e do runner (`bun test`). `npm run typecheck` — as três partes. `npm run build` — build do editor.
- Cada parte tem um `.npmrc` apontando para o npm público, para instalar igual mesmo com outro registry configurado na máquina.

## Componente novo

1. Lógica em `core/src/componentes/<nome>.ts` (`validar` e `executar`) e registro em `core/src/componentes/index.ts`.
   - Se o componente acumula envelopes, informe com `ctx.guardando(qtd, envelope)` (vira a Memória das Métricas). Espera interna que não é entrada (promessa própria, fila interna) vai por `ctx.esperar` / `ctx.esperarCada`, para não contar como tempo ativo.
2. Parte visual em `editor/src/componentes/<nome>.tsx` (`Card`, `Painel`, `Documentacao`) e entrada na `PALETA` (`editor/src/componentes/catalogo.ts`).
3. O runner não precisa mudar (salvo componente que fala com fora, como o SQL Server Query: o driver fica no runner e o core recebe a função). O `npm run start` roda o Bun a partir da raiz, então o `--watch` recarrega o runner também quando o `core` muda.

## Segredos (`$SECRETS`) e arquivos

Por enquanto ficam no runner, fora do git: `runner/secrets.local.json` (texto no topo = compartilhado por todos os projetos; os de um projeto em `"projetos": {"<id>": {"NOME": "valor"}}`, lidos a cada execução) e `runner/arquivos.local/<projetoId>/`. A aba Segredos do projeto grava no arquivo pelo runner e nunca lê os valores de volta. Ficam em `$SECRETS` nas expressions, no TypeScript e na conexão do SQL Server Query.

## Convenções

- Domínio em português (tipos, props, textos da tela). Nomes dos componentes (Mapper, Filter...) e tudo que circula no envelope (`DATA`, `errors`, `input`) em inglês.
- Nada de texto explicativo dentro das janelas e dos cards: só rótulos curtos. Explicação vai na aba Notes (`Documentacao` do componente).
- Menor texto da tela: `text-sm`.
