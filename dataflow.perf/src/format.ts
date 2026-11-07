export const formatMs = (value: number) =>
    value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value).toLocaleString('en-US')} ms`;

export function formatMetric(metric: string, value: number | undefined): string {
    if (value === undefined) {
        return '-';
    }

    if (metric.endsWith('Bytes')) {
        const size = Math.abs(value);
        return size < 1024 ** 2
            ? `${(value / 1024).toFixed(1)} KB`
            : size < 1024 ** 3
              ? `${(value / 1024 ** 2).toFixed(1)} MB`
              : `${(value / 1024 ** 3).toFixed(2)} GB`;
    }

    if (metric.endsWith('Percent')) {
        return `${Math.round(value)} %`;
    }

    if (metric === 'envelopesPerSecond') {
        return `${Math.round(value).toLocaleString('en-US')}/s`;
    }

    if (metric.endsWith('Ms')) {
        return formatMs(value);
    }

    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2);
}
