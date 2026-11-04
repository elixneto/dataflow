/*
 * A project's secrets: values flows and connections use without anyone seeing them again. The value is write-only:
 * typed when the secret is created or replaced, never shown afterwards; the server stores it encrypted (AES-256-GCM
 * with the instance's keyring). Flows read a secret as SECRETS['name']; the name rule is @dataflow/core's.
 */

export { SECRET_NAME, secretNameError, secretValueError } from '@dataflow/core';

export type Secret = {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
  /** who that is, by name (the server's users), when known */
  updatedByName?: string;
};
