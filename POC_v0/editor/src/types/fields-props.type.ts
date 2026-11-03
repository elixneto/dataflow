import type {Config} from '#types/config.type';

export type FieldsProps = {
  /** id for unique labels and inputs (it is not the node id: the window uses another one) */
  id: string;
  /** id of the node in the flow */
  nodeId: string;
  config: Config;
  setConfig: (key: string, value: unknown) => void;
  /** the component receives rows from another one (not only from the Start) */
  receivesRows: boolean;
};
