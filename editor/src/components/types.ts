import type {ComponentType} from 'react'
import type {LucideIcon} from 'lucide-react'
import type {PortType} from '@dataflow/core'

export type Category = 'source' | 'transformation' | 'code' | 'entity' | 'flow'

/** Configuration of a component in the flow. Each component reads what it needs from it. */
export type Config = Record<string, unknown>

export type FieldsProps = {
  /** id for unique labels and inputs (it is not the node id: the window uses another one) */
  id: string
  /** id of the node in the flow */
  nodeId: string
  config: Config
  setConfig: (key: string, value: unknown) => void
  /** the component receives rows from another one (not only from the Start) */
  receivesRows: boolean
}

export type ValidationContext = {
  receivesRows: boolean
}

/**
 * Definition of a palette component. Each component lives in its own file in `components/`;
 * its logic (validate/execute) lives in the core.
 */
export type ComponentDef = {
  type: string
  label: string
  description: string
  category: Category
  icon: LucideIcon
  /** type of each input, in order (in-0, in-1...) */
  inputs: PortType[]
  /** name of each input, shown next to the port (e.g. main/lookup of the Lookup) */
  inputLabels?: string[]
  /** type of each output, in order (out-0, out-1...) */
  outputs: PortType[]
  /** name of each output, shown next to the port (e.g. true/false of the Filter); without it, the outputs have no name */
  outputLabels?: string[]
  /** outputs that may stay unconnected (e.g. the Filter's false) */
  optionalOutputs?: string[] | ((config: Config) => string[])
  /**
   * Outputs that depend on the configuration (e.g. one Router case = one output), all of envelopes.
   * When present, it applies instead of `outputs` and `outputLabels`.
   */
  outputsFromConfig?: (config: Config) => {label: string}[]
  /** component that cannot fail per envelope (e.g. Union): no "On error" and no error port */
  noError?: boolean
  /** number of inputs chosen on the card (−/+), stored in config[key]; all of the type of inputs[0] */
  variableInputs?: {min: number; max: number; key: string}
  /** number of outputs chosen on the card (−/+), stored in config[key]; all of the type of outputs[0] (e.g. Copy) */
  variableOutputs?: {min: number; max: number; key: string}
  /** input that may stay unconnected */
  optionalInputs?: boolean
  defaultConfig?: Config
  /** window size the first time it opens (e.g. TypeScript, which has a code editor) */
  windowSize?: {w: number; h: number}
  /** shows Override in the window (the output carries only what the component produces) */
  usesOverride?: boolean
  /** default name of the key the component adds to DATA (the node can change it) */
  defaultOutputKey?: string
  /** what shows inside the card on the canvas */
  Card?: ComponentType<FieldsProps>
  /** what shows in the window's Configuration tab; without it, uses the Card */
  Panel?: ComponentType<FieldsProps>
  /** explanation of the component in the Notes tab (inputs, outputs, examples) */
  Docs?: ComponentType
  /** configuration issues (short messages, without the component's name) */
  validate?: (config: Config, ctx: ValidationContext) => string[]
}
