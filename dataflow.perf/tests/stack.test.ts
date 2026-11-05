import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { COMPOSE_FILE, COMPOSE_PROJECT, IMAGES, PERF_PORTS, SA_PASSWORD, SERVICE_LIMITS } from '#perf/stack';

/* The compose file and the constants of stack.ts must agree, and the perf stack must never touch the dev ports. */

type Service = { image: string; ports: string[]; environment?: Record<string, string>; deploy: { resources: { limits: { cpus: string; memory: string } } } };

const compose = parse(readFileSync(COMPOSE_FILE, 'utf8')) as { name: string; services: Record<string, Service> };

const bytes = (text: string) => {
  const [, amount, unit] = text.match(/^(\d+)([MG])$/) ?? [];
  return Number(amount) * 1024 ** (unit === 'G' ? 3 : 2);
};

describe('docker-compose.perf.yml', () => {
  test('its own project, with only the database services', () => {
    expect(compose.name).toBe(COMPOSE_PROJECT);
    expect(Object.keys(compose.services).sort()).toEqual(Object.keys(SERVICE_LIMITS).sort());
  });

  test('publishes only the perf ports, never the dev ones', () => {
    const published = Object.values(compose.services).flatMap(s => s.ports.map(p => Number(p.split(':')[0])));
    expect(published.sort()).toEqual([PERF_PORTS.mssql, PERF_PORTS.mongodb].sort());
    for (const port of [5180, 5190, 5432]) {
      expect(published).not.toContain(port);
    }
  });

  test('images, limits and the SA password match stack.ts; no image floats on latest', () => {
    for (const [name, service] of Object.entries(compose.services)) {
      const key = name as keyof typeof SERVICE_LIMITS;
      expect(service.image).toBe(IMAGES[key]);
      expect(service.image).not.toMatch(/:latest$|^[^:]+$/);
      expect(bytes(service.deploy.resources.limits.memory)).toBe(SERVICE_LIMITS[key].memoryBytes);
      expect(Number(service.deploy.resources.limits.cpus)).toBe(SERVICE_LIMITS[key].cpus);
    }

    expect(compose.services.mssql!.environment!.MSSQL_SA_PASSWORD).toBe(SA_PASSWORD);
  });
});
