import type {ComponentType} from 'react';
import type {LucideIcon} from 'lucide-react';
import type {Category} from '#types/category.type';
import type {Config} from '#types/config.type';
import type {FieldsProps} from '#types/fields-props.type';
import type {ValidationContext} from '#types/validation-context.type';

/**
 * Definition of a palette component. Each component lives in its own file in `components/`;
 * its logic (validate/execute) lives in the core.
 */
export type ComponentDef = {
  type: string;
  label: string;
  description: string;
  category: Category;
  icon: LucideIcon;
  /** number of inputs (in-0, in-1...); every port carries envelopes */
  inputs: number;
  /** name of each input, shown next to the port (e.g. main/lookup of the Lookup) */
  inputLabels?: string[];
  /** number of outputs (out-0, out-1...), besides the error port */
  outputs: number;
  /** name of each output, shown next to the port (e.g. true/false of the Filter); without it, the outputs have no name */
  outputLabels?: string[];
  /** outputs that may stay unconnected (e.g. the Filter's false) */
  optionalOutputs?: string[] | ((config: Config) => string[]);
  /**
   * Outputs that depend on the configuration (e.g. one Router case = one output).
   * When present, it applies instead of `outputs` and `outputLabels`.
   */
  outputsFromConfig?: (config: Config) => {label: string}[];
  /** component that cannot fail per envelope (e.g. Union): no "On error" and no error port */
  noError?: boolean;
  /** number of inputs chosen on the card (−/+), stored in config[key]; replaces `inputs` */
  variableInputs?: {min: number; max: number; key: string};
  /** number of outputs chosen on the card (−/+), stored in config[key]; replaces `outputs` (e.g. Copy) */
  variableOutputs?: {min: number; max: number; key: string};
  /** input that may stay unconnected */
  optionalInputs?: boolean;
  defaultConfig?: Config;
  /** window size the first time it opens (e.g. TypeScript, which has a code editor) */
  windowSize?: {w: number; h: number};
  /** shows Override in the window (the output carries only what the component produces) */
  usesOverride?: boolean;
  /** default name of the key the component adds to DATA (the node can change it) */
  defaultOutputKey?: string;
  /** what shows inside the card on the canvas */
  Card?: ComponentType<FieldsProps>;
  /** what shows in the window's Configuration tab; without it, uses the Card */
  Panel?: ComponentType<FieldsProps>;
  /** explanation of the component in the Notes tab (inputs, outputs, examples) */
  Docs?: ComponentType;
  /** configuration issues (short messages, without the component's name) */
  validate?: (config: Config, ctx: ValidationContext) => string[];
};
