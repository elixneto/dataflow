import type {ExecutableWorkflow} from '#types/executable-workflow.type';
import type {ParameterType, ParameterValue} from '#types/parameter.type';

function convert(value: string, type: ParameterType): ParameterValue {
    if (type === 'number') {
        return Number(value);
    }

    if (type === 'boolean') {
        return value === 'true';
    }

    return value;
}

/** Resolves the parameters: trigger value, otherwise the default; a required one without a value prevents the run. */
export function resolveParameters(wf: ExecutableWorkflow, values: Record<string, string> = {}) {
    const parameters: Record<string, ParameterValue> = {};
    const missing: string[] = [];

    for (const p of wf.parameters) {
        const value = values[p.name] ?? p.default;

        if (p.required && (value === undefined || value === '')) {
            missing.push(p.name);
        }

        parameters[p.name] = convert(value ?? '', p.type);
    }
    return {parameters, missing};
}
