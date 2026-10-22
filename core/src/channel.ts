/**
 * Async queue between two ports. The writer waits when the queue is full (backpressure),
 * so only a few envelopes are in transit, whatever the size of the file.
 */
export class Channel<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private closed = false
  private waitingForItem: (() => void) | null = null
  private waitingForSpace: (() => void) | null = null

  constructor(private readonly capacity = 64) {}

  private aborted = false

  async send(item: T): Promise<void> {
    if (this.aborted) return
    while (this.items.length >= this.capacity) {
      if (this.aborted) return
      await new Promise<void>(resolve => (this.waitingForSpace = resolve))
    }
    this.items.push(item)
    this.wake()
  }

  close() {
    this.closed = true
    this.wake()
  }

  /** Run interrupted: drops what is in the queue and releases whoever is waiting on either side. */
  abort() {
    this.aborted = true
    this.items.length = 0
    this.close()
    const r = this.waitingForSpace
    this.waitingForSpace = null
    r?.()
  }

  private wake() {
    const r = this.waitingForItem
    this.waitingForItem = null
    r?.()
  }

  async* [Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.items.length > 0) {
        const item = this.items.shift()!
        const r = this.waitingForSpace
        this.waitingForSpace = null
        r?.()
        yield item
        continue
      }
      if (this.closed) return
      await new Promise<void>(resolve => (this.waitingForItem = resolve))
    }
  }
}

/** Unconnected input: sends nothing. */
export async function* empty<T>(): AsyncIterable<T> {}
