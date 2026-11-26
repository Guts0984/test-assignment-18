'use client';

import { useState } from 'react';
import { type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { type ApiFailure } from '@/shared/api';
import { mapApiError } from './form-errors';

/** Shows a server's refusal where it belongs in a React Hook Form form. */
export const useApiErrors = <T extends FieldValues>(
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  rename: Readonly<Record<string, string>> = {},
) => {
  const [formError, setFormError] = useState<string | null>(null);
  return {
    formError,
    clear: () => {
      setFormError(null);
    },
    show: (error: ApiFailure) => {
      const mapped = mapApiError(error, fields, rename);
      for (const item of mapped.fields) {
        setError(item.path as Path<T>, { type: 'server', message: item.message });
      }
      setFormError(mapped.form);
    },
  };
};
