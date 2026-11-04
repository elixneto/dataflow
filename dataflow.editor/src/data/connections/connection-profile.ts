import type { ConnectionTypeName } from '@dataflow/core';

/*
 * A connection profile: a reusable connection (database, API, storage, messaging) of a project, used by its flows.
 * Its config holds the fields of its type; sensitive values are names of the project's secrets. The rules
 * (validateProfile) are @dataflow/core's, the same the server enforces.
 */

export { NAME_MAX, validateProfile, type ProfileFields } from '@dataflow/core';

export type ConnectionProfile = {
  id: string;
  projectId: string;
  name: string;
  type: ConnectionTypeName;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
  /** who that is, by name (the server's users), when known */
  updatedByName?: string;
};
