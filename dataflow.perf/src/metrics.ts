import type { Metric, RunMetric, Sample, Scenario } from '#perf/scenario';

type Extractor = (sample: Sample, scenario: Scenario) => number | undefined;

const outputsOf = (sample: Sample, label: string) => {
    const component = sample.record.components.find(c => c.label === label);
    return component ? Object.values(component.outputs).reduce((sum, n) => sum + n, 0) : undefined;
};

const FIXED: Record<RunMetric, Extractor> = {
    durationMs: s => s.record.durationMs,
    envelopesPerSecond: (s, scenario) => {
        const envelopes = outputsOf(s, scenario.throughputNode);
        return envelopes === undefined || !s.record.durationMs ? undefined : (envelopes / s.record.durationMs) * 1000;
    },
    cpuMs: s => s.cpu.cpuMs,
    cpuPercent: s => (s.record.durationMs ? (s.cpu.cpuMs / s.record.durationMs) * 100 : undefined),
    memoryStartBytes: s => s.memory.startRssBytes,
    memoryPeakBytes: s => s.memory.peakRssBytes,
    memoryEndBytes: s => s.memory.endRssBytes,
    memoryDeltaBytes: s => s.memory.peakRssBytes - s.memory.startRssBytes,
};

const COMPONENT_FIELDS = {
    activeMs: 'activeTimeMs',
    waitingMs: 'waitingMs',
} as const;

function componentMetric(name: string, sample: Sample): number | undefined {
    const last = name.lastIndexOf('.');
    const label = name.slice('component.'.length, last);
    const field = name.slice(last + 1);
    const component = sample.record.components.find(c => c.label === label);
    if (!component) {
        return undefined;
    }

    if (field === 'peakBytes') {
        return component.memory?.peakBytes;
    }

    const key = COMPONENT_FIELDS[field as keyof typeof COMPONENT_FIELDS];
    return key ? component[key] : undefined;
}

export function metricOf(name: Metric, sample: Sample, scenario: Scenario): number | undefined {
    if (name in FIXED) {
        return FIXED[name as RunMetric](sample, scenario);
    }

    if (name.startsWith('component.') && name.lastIndexOf('.') > 'component.'.length) {
        return componentMetric(name, sample);
    }

    if (name.startsWith('fakeApi.')) {
        const value = sample.fakeApi?.[name.slice('fakeApi.'.length) as keyof NonNullable<Sample['fakeApi']>];
        return typeof value === 'number' ? value : undefined;
    }

    return undefined;
}
