import {Channel} from '../channel';
import type {Envelope} from '#types/envelope.type';

/** Merges several sources into one, in the order the envelopes arrive (like Union). */
export async function* mergeSources(sources: AsyncIterable<Envelope>[]): AsyncIterable<Envelope> {
  const queue = new Channel<Envelope>();
  const pours = sources.map(async source => {
    for await (const doc of source) await queue.send(doc);
  });
  Promise.all(pours).finally(() => queue.close());
  yield* queue;
  await Promise.all(pours);
}
