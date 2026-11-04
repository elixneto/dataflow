import { z } from 'zod';
import { secretValueError } from '@dataflow/core';
import { fieldErrors } from '#shared/use-cases/field-errors';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';
import type { UseCaseHandler } from '#shared/use-cases/use-case-handler';
import { fail, success, type UseCaseResult } from '#shared/use-cases/use-case-result';
import { validate } from '#shared/use-cases/validate';
import { toSecretView, type SecretView } from '../secret';
import { replaceSecretValue, SecretRepository } from '../secret-store';

export const SetSecretValueCommand = z.object({ id: z.uuid('Invalid'), value: z.string() });

/** Replaces a secret's value (encrypted again with the current key; the old value is not shown, nor returned). */
export class SetSecretValueHandler implements UseCaseHandler<SecretView> {
  async handle(input: unknown, ctx: UseCaseContext): Promise<UseCaseResult<SecretView>> {
    const parsed = validate(SetSecretValueCommand, input);
    if (!parsed.ok) {
      return parsed;
    }

    const secret = await new SecretRepository(ctx.db, ctx.orgId).findById(parsed.value.id);
    if (!secret) {
      return fail('not-found', 'Secret not found.');
    }

    const invalid = fieldErrors({ value: secretValueError(parsed.value.value) });
    if (invalid) {
      return invalid;
    }

    const updated = await replaceSecretValue(ctx, secret, parsed.value.value);
    return updated ? success(toSecretView(updated)) : fail('not-found', 'Secret not found.');
  }
}
