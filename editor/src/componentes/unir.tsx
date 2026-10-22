import {Merge} from 'lucide-react'
import {unir} from '@dataflow/core'
import type {ComponenteDef} from './tipos'

// Parte visual do Unir. A lógica (executar) é a do core.

function DocumentacaoUnir() {
  return (
    <>
      <p>Reúne caminhos que se separaram (ex.: a saída normal e o tratamento de erro) numa saída só, para seguirem juntos pelo resto do fluxo. Não mexe no <code>DATA</code>. Para só terminar, não precisa: o End aceita várias ligações.</p>
      <h4>Entradas</h4>
      <p>De 2 a 100 portas de envelopes (−/+ no card). Toda entrada precisa estar ligada; diminuir tira as portas de baixo.</p>
      <h4>Saída</h4>
      <p>1 porta de envelopes: tudo que entra em qualquer porta sai por ela, como entrou.</p>
      <p>Cada envelope sai assim que chega, de qualquer entrada.</p>
      <p>Diferente do Join, que combina dois envelopes num só por uma chave: o Union só empilha.</p>
    </>
  )
}

export const UNIR: ComponenteDef = {
  tipo: unir.tipo,
  rotulo: 'Union',
  descricao: 'Junta várias entradas numa saída só',
  categoria: 'transformacao',
  icone: Merge,
  entradas: unir.entradas,
  saidas: unir.saidas,
  entradasVariaveis: unir.entradasVariaveis,
  semErro: true,
  configPadrao: {qtdEntradas: 2},
  Documentacao: DocumentacaoUnir,
}
