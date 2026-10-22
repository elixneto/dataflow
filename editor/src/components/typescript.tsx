import {FileCode2} from 'lucide-react'
import {typescriptConfig, typescript} from '@dataflow/core'
import {CodeEditor} from '@/ui/code-editor'
import type {FieldsProps, ComponentDef} from './types'

// Visual part of the TypeScript component. The logic is the core's; the runner compiles and runs the code.

/** Return type declared on the process function (e.g. `Promise<Data[]>`), read from the code; without a type, undefined. */
function processReturnType(code: string): string | undefined {
  const start = code.search(/\bfunction\s+process\s*\(/)
  if (start < 0) return undefined
  let i = code.indexOf('(', start)
  // close the parameters' parentheses (they may have types with parentheses inside)
  for (let depth = 0; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) break
  }
  const rest = code.slice(i + 1)
  const colon = rest.match(/^\s*:/)
  if (!colon) return undefined
  // the type goes up to the body's {: the first { outside <>, () and []
  let depth = 0
  for (let j = colon[0].length; j < rest.length; j++) {
    const c = rest[j]
    if ('<(['.includes(c)) depth++
    else if ('>)]'.includes(c)) depth--
    else if (c === '{' && depth === 0) return rest.slice(colon[0].length, j).trim() || undefined
  }
  return undefined
}

function TypescriptCard({config}: FieldsProps) {
  const returnType = processReturnType(typescriptConfig(config).code)
  return returnType
    ? <p className="truncate font-mono text-xs text-primary" title={returnType}>{returnType}</p>
    : <p className="text-xs italic text-muted-foreground">No return type</p>
}

function TypescriptPanel({nodeId, config, setConfig}: FieldsProps) {
  const {code} = typescriptConfig(config)
  return (
    <div className="flex min-h-[420px] flex-1 !shrink flex-col gap-3">
      <div className="relative min-h-[300px] flex-1">
        <CodeEditor value={code} onValue={v => setConfig('code', v)} path={nodeId} label="TypeScript code"/>
      </div>
    </div>
  )
}

function TypescriptDocs() {
  return (
    <>
      <p>TypeScript code that processes the envelopes. The code must have the <code>process</code> function; other functions and types may live in the same code and be called by it.</p>
      <pre>{`async function process($input: Data): Promise<Data | Data[] | null> {
  return {...$input, total: sum($input.items)}
}

function sum(items: {value: number}[]) {
  return items.reduce((s, i) => s + i.value, 0)
}`}</pre>
      <h4>Input</h4>
      <p>1 envelope port. process is called once per envelope and <code>$input</code> is its <code>DATA</code>. To process many at once (e.g. one API call every 500), put an Aggregate before it: then <code>$input.items</code> is the list.</p>
      <h4>Return</h4>
      <p><b>Override off</b> (default): the return value, whatever it is (object, list, text, number), goes to the key in the envelope (<code>$result</code>, the name can be changed) and the envelope moves on with the rest of <code>DATA</code>.</p>
      <p><b>Override on</b>: the return value becomes the whole <code>DATA</code>. An object = 1 envelope; a list of objects = 1 envelope per item; <code>null</code> = no envelope.</p>
      <h4>Globals</h4>
      <p><code>$PARAMETERS</code>, <code>$SECRETS</code>, <code>$WORKFLOW_CURRENT_RUN</code> and <code>log(...)</code>, which writes to the Logs tab. <code>fetch</code>, <code>URL</code>, <code>setTimeout</code> and similar are also available. There is no <code>require</code>, <code>import</code>, disk or <code>process.env</code>.</p>
      <h4>Time</h4>
      <p>Each process call has up to 30 s (5 s of continuous processing); past that, it is an error.</p>
      <h4>Errors</h4>
      <p>An exception in process is an error of the envelope and follows the card's "On error" policy. Code that does not compile or has no <code>process</code> function makes the component fail.</p>
    </>
  )
}

export const TYPESCRIPT: ComponentDef = {
  type: typescript.type,
  label: 'TypeScript',
  description: 'Processes the envelopes with code',
  category: 'code',
  icon: FileCode2,
  inputs: typescript.inputs,
  outputs: typescript.outputs,
  usesOverride: true,
  defaultOutputKey: typescript.defaultOutputKey,
  defaultConfig: {code: typescriptConfig({}).code},
  windowSize: {w: 760, h: 620},
  Card: TypescriptCard,
  Panel: TypescriptPanel,
  Docs: TypescriptDocs,
  validate: config => typescript.validate(config),
}
