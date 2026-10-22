/**
 * Async queue between two ports. The writer waits when the queue is full (backpressure),
 * so only a few <T> (envelopes) are in transit, whatever the size of the file.
 */
export class Channel<T> implements AsyncIterable<T> {

    private readonly items: T[] = [];

    private isClosed = false;
    private waitingForItemFn: (() => void) | null = null;
    private waitingForSpaceFn: (() => void) | null = null;

    constructor(private readonly capacity = 64) {
    }

    private aborted = false;

    async send(item: T): Promise<void> {
        if (this.aborted) {
            return;
        }

        while (this.items.length >= this.capacity) {
            if (this.aborted) {
                return;
            }

            await new Promise<void>(resolve => (this.waitingForSpaceFn = resolve));
        }

        this.items.push(item);
        this.wake();
    }

    close() {
        this.isClosed = true;
        this.wake();
    }

    /** Run interrupted: drops what is in the queue and releases whoever is waiting on either side */
    abort() {
        this.aborted = true;
        this.items.length = 0;

        this.close();

        const resolveFunction = this.waitingForSpaceFn;
        this.waitingForSpaceFn = null;
        resolveFunction?.();
    }

    private wake() {
        const resolveFunction = this.waitingForItemFn;
        this.waitingForItemFn = null;
        resolveFunction?.();
    }

    async* [Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
            if (this.items.length > 0) {
                const item = this.items.shift()!;
                const resolveFunction = this.waitingForSpaceFn;
                this.waitingForSpaceFn = null;
                resolveFunction?.();

                yield item;

                continue;
            }

            if (this.isClosed) {
                return;
            }

            await new Promise<void>(resolve => (this.waitingForItemFn = resolve));
        }
    }
}

/** Unconnected input: sends nothing. */
export async function* empty<T>(): AsyncIterable<T> {
}
