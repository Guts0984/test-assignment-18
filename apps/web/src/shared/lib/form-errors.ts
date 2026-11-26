import { type FieldError } from '@school/shared/errors/api-error';

export type MappedErrors = {
  readonly fields: readonly FieldError[];
  /** Shown above the form: failures that belong to no field on it. */
  readonly form: string | null;
};

/** Splits a failure into errors for the form's own fields and one message for the rest. */
export const mapApiError = (
  error: { readonly message: string; readonly fields?: readonly FieldError[] },
  known: readonly string[],
  rename: Readonly<Record<string, string>> = {},
): MappedErrors => {
  const renamed = (error.fields ?? []).map((item) => ({
    ...item,
    path: rename[item.path] ?? item.path,
  }));
  const fields = renamed.filter((item) => known.includes(item.path));
  const rest = renamed.filter((item) => !known.includes(item.path));
  if (fields.length > 0 && rest.length === 0) return { fields, form: null };
  const details = rest.map((item) => `${item.path}: ${item.message}`).join('; ');
  return { fields, form: details ? `${error.message} (${details})` : error.message };
};
