/**
 * Fila assíncrona entre duas portas. Quem escreve espera quando a fila enche (controle de vazão),
 * então só uns poucos envelopes ficam em trânsito, seja qual for o tamanho do arquivo.
 */
export class Canal<T> implements AsyncIterable<T> {
  private readonly itens: T[] = []
  private fechado = false
  private esperandoItem: (() => void) | null = null
  private esperandoEspaco: (() => void) | null = null

  constructor(private readonly capacidade = 64) {}

  private abortado = false

  async enviar(item: T): Promise<void> {
    if (this.abortado) return
    while (this.itens.length >= this.capacidade) {
      if (this.abortado) return
      await new Promise<void>(resolve => (this.esperandoEspaco = resolve))
    }
    this.itens.push(item)
    this.acordar()
  }

  fechar() {
    this.fechado = true
    this.acordar()
  }

  /** Execução interrompida: descarta o que está na fila e solta quem está esperando dos dois lados. */
  abortar() {
    this.abortado = true
    this.itens.length = 0
    this.fechar()
    const r = this.esperandoEspaco
    this.esperandoEspaco = null
    r?.()
  }

  private acordar() {
    const r = this.esperandoItem
    this.esperandoItem = null
    r?.()
  }

  async* [Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.itens.length > 0) {
        const item = this.itens.shift()!
        const r = this.esperandoEspaco
        this.esperandoEspaco = null
        r?.()
        yield item
        continue
      }
      if (this.fechado) return
      await new Promise<void>(resolve => (this.esperandoItem = resolve))
    }
  }
}

/** Entrada sem ligação: não manda nada. */
export async function* vazio<T>(): AsyncIterable<T> {}
