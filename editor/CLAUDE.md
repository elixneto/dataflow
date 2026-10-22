# dataflow/editor — aplicação dos fluxos (React)

Projetos, editor visual dos fluxos, execuções, segredos e arquivos.

## Stack e comandos

- Vite + React 19 + TypeScript + Tailwind 4 + React Flow (`@xyflow/react`) + lucide-react.
- `npm run start` → http://localhost:5180/ · `npm run build` → `dist/` · `npm run typecheck`.
- `base: '/'`: a aplicação fica na raiz. Em produção, o `dist/` pode ser servido por qualquer servidor estático, com `/api` repassado para o runner.
- `.npmrc` aponta para o npm público.
- Validar/Executar chamam o runner (`../runner`, Bun, porta 5190): em dev o Vite repassa `/api` para ele. Para subir os dois juntos: `npm run start` na raiz do repositório.
- A lógica dos componentes (validar/executar) fica em `../core` (alias `@dataflow/core`); aqui só a parte visual.

## Estrutura

| Pasta | O que é |
|---|---|
| `src/componentes/` | `tipos.ts` (contrato visual `ComponenteDef`: portas, `Card`, `Painel`, `validar`), `catalogo.ts` (paleta, cores, `POR_TIPO`, Início/Fim) e a parte visual de cada componente. |
| `src/execucao/` | Conversão editor → runner, chamada ao runner e o painel com o resultado da execução (por componente: tempo, contagens, logs, amostras). |
| `src/editor/` | Prancheta (React Flow), nó genérico, comentário, paleta, barra, histórico (Ctrl+Z), validação da montagem e as **janelas** de configuração: clique só seleciona; duplo clique abre a janela do componente (uma por componente, várias abertas, arrastáveis, Esc fecha). O Início abre os parâmetros do workflow. |
| `src/mock/` | Projetos (`projetos.ts`, chave `dataflow-projetos-v1`) e fluxos (`fluxos.ts`, chave `dataflow-fluxos-v2`; cada fluxo tem `projetoId` e `pasta`, caminho dentro do projeto; o projeto guarda as pastas vazias) no localStorage, com os exemplos. Vira chamada à API quando o backend existir. Execuções, segredos e arquivos já vêm do runner. |
| `src/paginas/` | Rotas: `/` projetos, `/projetos/:id` (abas Fluxos, Execuções, Segredos, Arquivos; `?aba=`), `/projetos/:id/fluxos/:fluxoId` editor, `/projetos/:id/execucoes/:execucaoId` detalhe. `/editor/:id` antigo redireciona. |

## Convenções

As mesmas do [CLAUDE.md da raiz](../CLAUDE.md).
