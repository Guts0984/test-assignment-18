'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { gatewayConfigInputSchema } from '@school/shared/schemas/gateway';
import { useForm } from 'react-hook-form';
import { useGatewaySet } from '@/shared/api';
import { useApiErrors } from '@/shared/lib';
import { Alert, Button, Input } from '@/shared/ui';

export const GatewayForm = ({ baseUrl }: { baseUrl: string }) => {
  const form = useForm({
    resolver: zodResolver(gatewayConfigInputSchema),
    defaultValues: { baseUrl, key: '' },
  });
  const errors = useApiErrors(form.setError, ['baseUrl', 'key']);
  const save = useGatewaySet({
    mutation: {
      onSuccess: () => {
        form.resetField('key');
      },
      onError: errors.show,
    },
  });
  const { errors: fields } = form.formState;
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        errors.clear();
        void form.handleSubmit((data) => {
          save.mutate({ data });
        })(event);
      }}
    >
      {errors.formError ? <Alert>{errors.formError}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">Saved.</Alert> : null}
      <Input label="Address" error={fields.baseUrl?.message} {...form.register('baseUrl')} />
      <Input
        label="Key"
        type="password"
        autoComplete="off"
        error={fields.key?.message}
        {...form.register('key')}
      />
      <Button type="submit" pending={save.isPending}>
        Save
      </Button>
    </form>
  );
};
