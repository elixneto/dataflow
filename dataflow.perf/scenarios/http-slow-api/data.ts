/* The HTTP scenario's input: one item id per request. */

export const DATA_VERSION = 1;

export const itemIds = (size: number): { id: number }[] => Array.from({ length: size }, (_, i) => ({ id: i + 1 }));
