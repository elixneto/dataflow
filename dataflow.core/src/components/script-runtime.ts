/*
 * What a TypeScript component (and the project's scripts it imports) can use besides the language itself: the names the
 * runner puts in the script's context (dataflow.server, shared/runner/prepare-script.ts) and, for the code editor, their
 * types as a declaration file. No DOM: there is no window, document or storage where the code runs, so the editor does
 * not offer them. Both sides read this list, and a test checks that the runner provides exactly these names.
 */

/** the globals of the script's context, besides the language's own (Promise, JSON, Math, Date...) */
export const SCRIPT_RUNTIME_GLOBALS = [
  '$PARAMETERS', '$SECRETS', '$VARIABLES', '$FLOW_CURRENT_RUN', 'log', 'console',
  'fetch', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams', 'AbortController', 'FormData', 'Blob',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone', 'crypto', 'setTimeout', 'clearTimeout',
] as const;

/** the types of the runtime's web globals (the run's own, $PARAMETERS and the rest, are in SCRIPT_GLOBALS) */
export const SCRIPT_RUNTIME_TYPES = `
type HeadersInit = Headers | Record<string, string> | [string, string][]
type BodyInit = string | Blob | FormData | URLSearchParams | ArrayBuffer | ArrayBufferView
interface AbortSignal {
  readonly aborted: boolean
  readonly reason: any
  throwIfAborted(): void
}
declare var AbortSignal: {
  prototype: AbortSignal
  abort(reason?: any): AbortSignal
  timeout(milliseconds: number): AbortSignal
}
interface AbortController {
  readonly signal: AbortSignal
  abort(reason?: any): void
}
declare var AbortController: {prototype: AbortController; new (): AbortController}
interface Blob {
  readonly size: number
  readonly type: string
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  slice(start?: number, end?: number, contentType?: string): Blob
}
declare var Blob: {prototype: Blob; new (parts?: (string | Blob | ArrayBuffer | ArrayBufferView)[], options?: {type?: string}): Blob}
interface FormData {
  append(name: string, value: string | Blob, fileName?: string): void
  delete(name: string): void
  get(name: string): string | Blob | null
  getAll(name: string): (string | Blob)[]
  has(name: string): boolean
  set(name: string, value: string | Blob, fileName?: string): void
  forEach(callback: (value: string | Blob, key: string) => void): void
  entries(): IterableIterator<[string, string | Blob]>
  [Symbol.iterator](): IterableIterator<[string, string | Blob]>
}
declare var FormData: {prototype: FormData; new (): FormData}
interface Headers {
  append(name: string, value: string): void
  delete(name: string): void
  get(name: string): string | null
  getSetCookie(): string[]
  has(name: string): boolean
  set(name: string, value: string): void
  forEach(callback: (value: string, key: string) => void): void
  entries(): IterableIterator<[string, string]>
  keys(): IterableIterator<string>
  values(): IterableIterator<string>
  [Symbol.iterator](): IterableIterator<[string, string]>
}
declare var Headers: {prototype: Headers; new (init?: HeadersInit): Headers}
interface Body {
  readonly body: unknown
  readonly bodyUsed: boolean
  arrayBuffer(): Promise<ArrayBuffer>
  blob(): Promise<Blob>
  formData(): Promise<FormData>
  json(): Promise<any>
  text(): Promise<string>
}
interface RequestInit {
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
  signal?: AbortSignal | null
  redirect?: 'follow' | 'error' | 'manual'
}
interface Request extends Body {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly signal: AbortSignal
  clone(): Request
}
declare var Request: {prototype: Request; new (input: string | URL | Request, init?: RequestInit): Request}
interface ResponseInit {
  status?: number
  statusText?: string
  headers?: HeadersInit
}
interface Response extends Body {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly redirected: boolean
  readonly url: string
  clone(): Response
}
declare var Response: {
  prototype: Response
  new (body?: BodyInit | null, init?: ResponseInit): Response
  json(data: any, init?: ResponseInit): Response
  error(): Response
}
/** an HTTP call (its waiting counts as Waiting in the component's metrics) */
declare function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
interface URLSearchParams {
  readonly size: number
  append(name: string, value: string): void
  delete(name: string): void
  get(name: string): string | null
  getAll(name: string): string[]
  has(name: string): boolean
  set(name: string, value: string): void
  sort(): void
  toString(): string
  forEach(callback: (value: string, key: string) => void): void
  entries(): IterableIterator<[string, string]>
  keys(): IterableIterator<string>
  values(): IterableIterator<string>
  [Symbol.iterator](): IterableIterator<[string, string]>
}
declare var URLSearchParams: {prototype: URLSearchParams; new (init?: string | Record<string, string> | [string, string][] | URLSearchParams): URLSearchParams}
interface URL {
  hash: string
  host: string
  hostname: string
  href: string
  readonly origin: string
  password: string
  pathname: string
  port: string
  protocol: string
  search: string
  readonly searchParams: URLSearchParams
  username: string
  toString(): string
  toJSON(): string
}
declare var URL: {prototype: URL; new (url: string | URL, base?: string | URL): URL; canParse(url: string | URL, base?: string | URL): boolean}
interface TextEncoder {
  readonly encoding: string
  encode(input?: string): Uint8Array
}
declare var TextEncoder: {prototype: TextEncoder; new (): TextEncoder}
interface TextDecoder {
  readonly encoding: string
  decode(input?: ArrayBuffer | ArrayBufferView, options?: {stream?: boolean}): string
}
declare var TextDecoder: {prototype: TextDecoder; new (label?: string, options?: {fatal?: boolean; ignoreBOM?: boolean}): TextDecoder}
declare function atob(data: string): string
declare function btoa(data: string): string
declare function structuredClone<T = any>(value: T): T
declare var crypto: {randomUUID(): string}
/** a timer (until it fires, it counts as Waiting in the component's metrics) */
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number
declare function clearTimeout(id: number | undefined): void
/** writes to the component's log, like log */
declare var console: {
  log(...parts: unknown[]): void
  info(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
  debug(...parts: unknown[]): void
}
`;
