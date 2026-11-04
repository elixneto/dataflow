/** what an envelope that fails in a component does: throw (stops the run, the default), continue (goes on as it came in), divert (goes out through the error port) */
export type ErrorPolicy = 'throw' | 'continue' | 'divert';
