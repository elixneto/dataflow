# dataflow

Fluxos de dados visuais, **envelope a envelope**. Você monta o fluxo ligando componentes numa prancheta (ler de um banco, filtrar, cruzar, transformar com código, chamar outro fluxo) e o runner executa em pipeline: cada envelope passa de componente em componente até chegar ao End, com controle de vazão, tratamento de erro por envelope e métricas por componente.

Inspirado no SnapLogic e no Pentaho Kettle, tudo em JavaScript: editor em React, motor em TypeScript e runner em Bun.

> Estado: protótipo funcional. Projetos e fluxos ficam no navegador (localStorage); execuções, segredos e arquivos ficam no runner, na sua máquina. Veja [o que ainda não foi feito](docs/arquitetura.md#11-ainda-não-feito).

## Componentes

| Seção | Componente | O que faz |
|---|---|---|
| Data Sources | **Data Grid** | Tabela digitada (ou colada do Excel) que solta um envelope por linha |
| | **SQL Server Query** | Consulta somente leitura, em streaming, com parâmetros `@nome` |
| Scripting | **TypeScript** | `async function process($input)` por envelope, num sandbox |
| Transformation | **Mapper** | Grava campos no envelope (texto ou expression) |
| | **Filter** | Separa em `true` e `false` por uma condição |
| | **Router** | Manda cada envelope para o primeiro caso verdadeiro |
| | **Lookup** | Acha o par numa outra entrada pela chave |
| | **Union** / **Copy** | Junta caminhos / manda o mesmo envelope para vários |
| | **Aggregate** | Junta envelopes em lotes |
| Flow | **Workflow Invoker** | Chama outro fluxo, passando os parâmetros do Start dele |

Cada componente tem a explicação completa na aba **Notes** da janela dele, dentro do editor.

## Rodando

Precisa de [Node.js](https://nodejs.org) 20+ e [Bun](https://bun.sh) 1.2+.

```bash
npm run instalar   # dependências das três partes (uma vez)
npm run start      # runner (porta 5190) + editor (porta 5180)
```

Abra http://localhost:5180. O projeto **Exemplos** tem um fluxo de exemplo para cada componente; abra um e clique em **Executar**.

Outros comandos: `npm test` (testes do core e do runner), `npm run typecheck`, `npm run build` (build do editor em `editor/dist`).

### Segredos e arquivos

Cada projeto tem as abas **Segredos** e **Arquivos**. Os segredos ficam em `runner/secrets.local.json` e os arquivos em `runner/arquivos.local/`, os dois fora do git. A tela grava o segredo pelo runner e nunca lê o valor de volta. Nos componentes, use `$SECRETS.NOME`.

Segredo compartilhado por todos os projetos pode ir direto no topo do arquivo:

```json
{
  "MEU_BANCO_SQL": "Server=localhost;Database=erp;User Id=leitura;Password=...;Encrypt=true;TrustServerCertificate=true",
  "projetos": {
    "exemplos": {"TOKEN_DA_API": "..."}
  }
}
```

### Segurança

O runner executa código escrito no editor (expressions e o componente TypeScript) num `node:vm`, que separa o escopo mas **não é uma barreira de segurança**, e ainda não tem autenticação. Rode-o só na sua máquina ou numa rede de confiança.

## Estrutura

| Pasta | O que é |
|---|---|
| `core/` | Motor: contrato, envelope, componentes (lógica) e execução. Sem React nem Node. |
| `runner/` | Runner em Bun + Hono: API de execuções, segredos e arquivos; sandbox de expressions e scripts; driver do SQL Server. |
| `editor/` | Aplicação React: projetos, pastas, editor visual, janelas dos componentes e resultado das execuções. |
| `docs/` | [Arquitetura](docs/arquitetura.md) |

## Criando um componente

1. A lógica em `core/src/componentes/<nome>.ts` (`validar` e `executar`), registrada em `core/src/componentes/index.ts`.
2. A parte visual em `editor/src/componentes/<nome>.tsx` (card, janela e Notes), na `PALETA` de `editor/src/componentes/catalogo.ts`.
3. Um teste em `core/src/motor.test.ts` e um fluxo de exemplo em `editor/src/mock/fluxos.ts`.

Os detalhes do contrato estão na [arquitetura](docs/arquitetura.md#7-contrato-do-componente-core).

## Licença

[MIT](LICENSE)
