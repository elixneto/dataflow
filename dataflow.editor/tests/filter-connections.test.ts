import { describe, expect, test } from 'bun:test';
import type { ConnectionProfile } from '../src/data/connections/connection-profile';
import { countByGroup, filterConnections, GROUP_FILTERS } from '../src/data/connections/filter-connections';
import { matchesSearch } from '../src/lib/search';

const profile = (name: string, type: ConnectionProfile['type'], config: Record<string, string>): ConnectionProfile => ({
  id: name,
  projectId: 'p',
  name,
  type,
  config,
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: 'ana',
});

const profiles = [
  profile('Orders database', 'sqlserver', { host: 'sql.example.com', database: 'orders' }),
  profile('Conexão Parceiro', 'http-client', { auth: 'bearer' }),
  profile('Exports bucket', 's3', { bucket: 'exports', region: 'us-east-1' }),
  profile('Orders events', 'kafka', { bootstrapServers: 'broker1:9092' }),
];

const names = (filtered: ConnectionProfile[]) => filtered.map(p => p.name);

describe('connections filter', () => {
  test('by group only', () => {
    expect(names(filterConnections(profiles, { group: 'database', search: '' }))).toEqual(['Orders database']);
    expect(names(filterConnections(profiles, { group: 'all', search: '' }))).toHaveLength(4);
  });

  test('by text: name, type label or summary, ignoring case', () => {
    expect(names(filterConnections(profiles, { group: 'all', search: 'ORDERS' }))).toEqual(['Orders database', 'Orders events']);
    expect(names(filterConnections(profiles, { group: 'all', search: 'amazon s3' }))).toEqual(['Exports bucket']);
    expect(names(filterConnections(profiles, { group: 'all', search: 'broker1' }))).toEqual(['Orders events']);
  });

  test('both together; accents do not matter', () => {
    expect(names(filterConnections(profiles, { group: 'messaging', search: 'orders' }))).toEqual(['Orders events']);
    expect(names(filterConnections(profiles, { group: 'all', search: 'conexao' }))).toEqual(['Conexão Parceiro']);
    expect(names(filterConnections(profiles, { group: 'all', search: 'parcéiro' }))).toEqual(['Conexão Parceiro']);
  });

  test('no match', () => {
    expect(filterConnections(profiles, { group: 'storage', search: 'kafka' })).toEqual([]);
  });

  test('counts per group follow the text search', () => {
    expect(countByGroup(profiles, '')).toEqual({ all: 4, api: 1, storage: 1, database: 1, messaging: 1 });
    expect(countByGroup(profiles, 'orders')).toEqual({ all: 2, api: 0, storage: 0, database: 1, messaging: 1 });
  });

  test('the group filter: all first, then the four groups', () => {
    expect(GROUP_FILTERS).toEqual(['all', 'api', 'storage', 'database', 'messaging']);
  });
});

describe('search', () => {
  test('any text contains the search, ignoring case and accents; empty matches all', () => {
    expect(matchesSearch('', 'anything')).toBe(true);
    expect(matchesSearch('URL', 'api-base-url')).toBe(true);
    expect(matchesSearch('producao', 'name', 'Produção')).toBe(true);
    expect(matchesSearch('token', 'api-base-url', 'https://x')).toBe(false);
  });
});
