# Arquitetura

Como o motor funciona por dentro. Para rodar e usar, veja o [README](../README.md).

## 1. Peças

| Peça | Onde | O que faz |
|---|---|---|
| **core** | `core/` | Contrato dos componentes, o envelope, a lógica de cada componente e o motor que executa um fluxo envelope a envelope. TypeScript puro: sem React, sem Node. |
| **runner** | `runner/` | Aplicação em Bun + Hono. Recebe o fluxo, executa com o core e entrega o que o core não faz sozinho: avaliar expressions e scripts num sandbox (`node:vm`), falar com bancos (SQL Server), ler segredos e arquivos do projeto e guardar as execuções. |
| **editor** | `editor/` | Aplicação React: projetos, pastas, o editor visual (React Flow), a janela de cada componente e o resultado das execuções. Usa o core para validar a montagem e chama o runner para executar. |

## 2. Conceitos

| Conceito | O que é |
|---|---|
| **Projeto** | Agrupa fluxos (em pastas), segredos e arquivos. |
| **Fluxo** (workflow) | Um Start, um End e componentes no meio, ligados por portas. Declara os **parâmetros** que espera, cada um com valor padrão. |
| **Execução** | Uma rodada de um fluxo, com o registro por componente. |
| **Componente** | Peça da paleta: portas tipadas, configuração (com expressions) e a função `executar`. |
| **Envelope** | O que passa de um componente para outro. |

## 3. O envelope

```json
{
  "WORKFLOW_CURRENT_RUN": {"id": "…", "mode": "execution", "project": "Vendas", "workflow": "Notas do dia", "startedAt": "2026-10-21T12:34:56Z"},
  "PARAMETERS": {"desde": "2026-10-01"},
  "DATA": {"cliente": {"id": 71, "nome": "Mercado Bom Preço"}}
}
```

1. **O Start sempre solta um envelope**, com `WORKFLOW_CURRENT_RUN`, `PARAMETERS` e o `DATA` vazio. Com "Recebe entrada", a entrada da chamada vira o `DATA` (lista: um envelope por item).
2. **Cada componente acrescenta ao `DATA`**: numa chave própria (ex.: `$resultado` do TypeScript, `$lookup` do Lookup) ou direto nos campos (Mapper, Data Grid, SQL Server Query).
3. **Override** (em cada componente que produz dado): a saída leva só o que ele produziu e descarta o resto do `DATA`.
4. **Um gera vários**: quem solta N envelopes a partir de 1 (Data Grid, SQL Server Query) copia o envelope que chegou em cada um.
5. Envelope que sai pela **porta de erro** ganha `DATA.errors`: lista de `{error, message, component}`, que acumula se falhar em mais de um componente.

## 4. Expressions

- `$WORKFLOW_CURRENT_RUN.id`, `$PARAMETERS.desde`, `$SECRETS.MEU_BANCO_SQL` e, direto, cada chave do `DATA`: `$cliente.nome`.
- Cada campo tem o botão `=`: desligado, o valor é texto puro; ligado, é JavaScript avaliado no runner, num `node:vm` com tempo máximo e só essas variáveis à vista.
- Expression que dá erro é erro daquele envelope (segue a política "Em caso de erro"), não da execução inteira.

## 5. Portas

| Tipo | O que passa |
|---|---|
| `envelope` | Vários envelopes, em sequência (o padrão) |
| `texto`, `numero`, `json` | Um valor só |
| `qualquer` | Coringa, liga com tudo |

- O editor só liga portas compatíveis. Cada saída liga em uma entrada só (o End é a exceção: aceita várias). Para mandar o mesmo envelope a vários lugares, use o **Copy**; para juntar caminhos, o **Union**.
- Componentes que podem falhar por envelope têm a política **Em caso de erro**: Interromper (padrão), Continuar (o envelope segue como entrou) ou Desviar (sai pela porta de erro).
- Ciclos são proibidos (seriam loop infinito de envelopes).

## 6. Pipeline e vazão

- Cada ligação vira uma fila assíncrona (`Canal`) com capacidade limitada; todos os componentes rodam ao mesmo tempo. O envelope 1 já está no Filter enquanto a consulta ainda lê o 2.
- **Controle de vazão**: quem escreve espera quando a fila enche, então a memória fica constante seja qual for o volume. O SQL Server Query chega a pausar o banco.
- **Acumuladores** (Lookup, Aggregate) seguram envelopes por natureza e informam quanto seguram (vira a Memória nas Métricas).

## 7. Contrato do componente (core)

```ts
type ComponenteLogica = {
  tipo: string
  entradas: TipoDePorta[]
  saidas: TipoDePorta[]
  saidasOpcionais?: string[] | ((config) => string[])     // podem ficar sem ligação (ex.: false do Filter)
  entradasVariaveis?: {min, max, chave}                   // ex.: Union
  saidasVariaveis?: {min, max, chave}                     // ex.: Copy
  chaveDeSaidaPadrao?: string                             // chave no DATA (o nó pode trocar)
  validar(config): string[]                               // montagem, sem dados
  executar(entradas, config, ctx): AsyncIterable<{porta, doc} | {erro, doc}>
}
```

O `ctx` dá ao componente: `valorDoCampo` (texto ou expression), `log`, `prepararScript` (TypeScript), `consultarSql`, `invocarWorkflow`, `esperar`/`esperarCada` (esperas que não contam como tempo ativo) e `guardando` (memória). O que fala com fora (sandbox, banco) é injetado pelo runner; o core só recebe a função.

## 8. Registro da execução

Por execução: run, parâmetros, status (`concluida`, `com-avisos`, `com-erros`, `falhou`), duração e erro. Por componente: status, início e fim, duração, **tempo ativo** (o tempo processando, sem contar a espera; como é uma thread só, é praticamente o CPU dele), **memória estimada** (pico de envelopes guardados e bytes pelo JSON), envelopes por porta, logs, amostra de entrada e saída (20 por porta) e, no Workflow Invoker, um resumo de cada execução chamada.

Hoje o runner guarda as últimas 50 em memória. O próximo passo é um banco (MongoDB, por exemplo) e cada execução num Worker do Bun próprio, que isola e permite medir CPU e RAM por execução.

## 9. Workflow Invoker

Roda outro fluxo por envelope, com os parâmetros do Start dele. O que chega ao End do filho sai do Invoker; falha do filho é erro do envelope (com Desviar, a porta de erro pode chamar um fluxo de tratamento). Chamada circular é barrada, a sequência para em 10 níveis, e parar a execução para os filhos. O filho recebe `WORKFLOW_CURRENT_RUN.parentId`.

## 10. Somente leitura no SQL Server Query

Três camadas: a consulta tem que ser um comando só, começando por `SELECT` ou `WITH`, sem palavras que escrevem, executam ou mexem na sessão (lida da esquerda para a direita, como o SQL Server: comentários e textos não enganam); roda dentro de uma transação que sempre faz rollback; e a conexão vai com `ApplicationIntent=ReadOnly`. Mesmo assim, use um login só com leitura.

## 11. Ainda não feito

- Banco para projetos, fluxos e execuções (hoje projetos e fluxos ficam no navegador; execuções, segredos e arquivos, no runner).
- Gatilhos: endpoint por fluxo e agendamento (cron).
- Autenticação no runner.
- Fontes e destinos além do SQL Server (CSV, HTTP, outros bancos).
