import {Copy} from 'lucide-react'
import {copy} from '@dataflow/core'
import type {ComponenteDef} from './tipos'

// Parte visual do Copy. A lógica (executar) é a do core.

function DocumentacaoCopy() {
  return (
    <>
      <p>O contrário do Union: manda cada envelope que chega para todas as saídas, para o mesmo dado seguir por caminhos diferentes (ex.: gravar a empresa no destino e, ao mesmo tempo, montar um relatório). Não mexe no <code>DATA</code>.</p>
      <h4>Entrada</h4>
      <p>1 porta de envelopes.</p>
      <h4>Saídas</h4>
      <p>De 2 a 10 portas de envelopes (−/+ no card). Toda saída precisa estar ligada; diminuir tira as portas de baixo.</p>
      <p>Cada saída recebe a sua cópia do envelope: o que um caminho muda não aparece no outro.</p>
      <p>O ritmo é o do caminho mais lento: o envelope só segue quando todas as saídas aceitaram.</p>
      <p>Diferente do Router, que manda cada envelope para uma saída só.</p>
      <h4>Desativado</h4>
      <p>Os envelopes saem só pela primeira saída.</p>
    </>
  )
}

export const COPY: ComponenteDef = {
  tipo: copy.tipo,
  rotulo: 'Copy',
  descricao: 'Manda cada envelope para todas as saídas',
  categoria: 'transformacao',
  icone: Copy,
  entradas: copy.entradas,
  saidas: copy.saidas,
  saidasVariaveis: copy.saidasVariaveis,
  semErro: true,
  configPadrao: {qtdSaidas: 2},
  Documentacao: DocumentacaoCopy,
}
