import { matchesSearch } from '@/lib/search';
import type { ConnectionProfile } from './connection-profile';
import { CONNECTION_GROUPS, connectionType, type ConnectionGroup } from './connection-types';

export type ConnectionFilter = { group: ConnectionGroup | 'all'; search: string };

/** whether the connection's name, type (e.g. "Amazon S3") or summary (host, URL, bucket...) contains the search */
function matches(profile: ConnectionProfile, search: string): boolean {
  const kind = connectionType(profile.type);
  return matchesSearch(search, profile.name, kind.label, kind.summary(profile.config));
}

/** the connections of the group (or all) that match the search, ignoring case and accents */
export function filterConnections(profiles: ConnectionProfile[], { group, search }: ConnectionFilter): ConnectionProfile[] {
  return profiles.filter(p => (group === 'all' || connectionType(p.type).group === group) && matches(p, search));
}

/** how many connections match the search in each group, and in all */
export function countByGroup(profiles: ConnectionProfile[], search: string): Record<ConnectionGroup | 'all', number> {
  const matching = profiles.filter(p => matches(p, search));
  const counts = { all: matching.length } as Record<ConnectionGroup | 'all', number>;
  for (const { group } of CONNECTION_GROUPS) {
    counts[group] = matching.filter(p => connectionType(p.type).group === group).length;
  }

  return counts;
}

/** the values of the group filter: all, then each group (the URL's ?group=) */
export const GROUP_FILTERS: readonly (ConnectionGroup | 'all')[] = ['all', ...CONNECTION_GROUPS.map(g => g.group)];
