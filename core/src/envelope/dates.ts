/**
 * Dates travel in the envelope as Date objects (a SQL Server date column, a MongoDB date), never as text that looks
 * like a date: whether a value is a date is its type, not its format. This check also accepts a Date made in another
 * realm (an expression or a script in node:vm), where `instanceof Date` is false.
 */
export const isDate = (value: unknown): value is Date => Object.prototype.toString.call(value) === '[object Date]';
