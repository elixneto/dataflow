/** A variable an expression can use at a component (suggested in the editor): `$customer.name`, `$PARAMETERS.limit`... */
export type AvailableVariable = {
  path: string;
  /** string, number, boolean, object, array, null, secret... */
  type: string;
  /** short sample of the value seen in the last run (never for secrets) */
  example?: string;
};
