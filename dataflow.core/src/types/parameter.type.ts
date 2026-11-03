type ParameterValueByType = {text: string; number: number; boolean: boolean};

/** The parameter's type, as stored in its definition and chosen in the panel. */
export type ParameterType = keyof ParameterValueByType;

/** The parameter's value after conversion (e.g. type 'number' and default '10' → 10). */
export type ParameterValue = ParameterValueByType[ParameterType];
