/** A script's `process` function, ready to call (the runner transpiles and isolates it; see PrepareScript). */
export type ScriptFunction = (input: unknown) => Promise<unknown>;
