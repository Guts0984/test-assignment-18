'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const CONTROL =
  'min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base aria-[invalid=true]:border-red-600';

type Common = { readonly label: string; readonly error?: string | undefined };

const Frame = ({
  label,
  error,
  id,
  children,
}: Common & { readonly id: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={id} className="text-sm font-medium text-slate-700">
      {label}
    </label>
    {children}
    {error ? (
      <p id={`${id}-error`} role="alert" className="text-sm text-red-700">
        {error}
      </p>
    ) : null}
  </div>
);

const aria = (id: string, error: string | undefined) => ({
  id,
  'aria-invalid': error !== undefined,
  'aria-describedby': error ? `${id}-error` : undefined,
});

export const Input = ({
  label,
  error,
  ...props
}: Common & InputHTMLAttributes<HTMLInputElement> & { readonly ref?: Ref<HTMLInputElement> }) => {
  const id = useId();
  return (
    <Frame label={label} error={error} id={id}>
      <input {...props} {...aria(id, error)} className={CONTROL} />
    </Frame>
  );
};

export const Select = ({
  label,
  error,
  children,
  ...props
}: Common &
  SelectHTMLAttributes<HTMLSelectElement> & { readonly ref?: Ref<HTMLSelectElement> }) => {
  const id = useId();
  return (
    <Frame label={label} error={error} id={id}>
      <select {...props} {...aria(id, error)} className={CONTROL}>
        {children}
      </select>
    </Frame>
  );
};

export const TextArea = ({
  label,
  error,
  ...props
}: Common &
  TextareaHTMLAttributes<HTMLTextAreaElement> & { readonly ref?: Ref<HTMLTextAreaElement> }) => {
  const id = useId();
  return (
    <Frame label={label} error={error} id={id}>
      <textarea rows={5} {...props} {...aria(id, error)} className={CONTROL} />
    </Frame>
  );
};
