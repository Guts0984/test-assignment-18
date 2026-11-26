'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@school/shared/schemas/auth';
import { useForm } from 'react-hook-form';
import { authLogin, useAuthRegister, type AccountDtoOutput } from '@/shared/api';
import { browserTimeZone, useApiErrors } from '@/shared/lib';
import { Alert, Button, Input } from '@/shared/ui';

export const RegisterForm = ({
  onSignedIn,
}: {
  onSignedIn: (account: AccountDtoOutput) => void;
}) => {
  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', fullName: '', timeZone: browserTimeZone() },
  });
  const errors = useApiErrors(form.setError, ['email', 'password', 'fullName', 'timeZone']);
  const register = useAuthRegister({ mutation: { onError: errors.show } });
  const { errors: fields, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        errors.clear();
        void form.handleSubmit(async (data) => {
          await register
            .mutateAsync({ data })
            .then(() => authLogin({ email: data.email, password: data.password }))
            .then(onSignedIn)
            .catch(errors.show);
        })(event);
      }}
    >
      {errors.formError ? <Alert>{errors.formError}</Alert> : null}
      <Input
        label="Full name"
        autoComplete="name"
        error={fields.fullName?.message}
        {...form.register('fullName')}
      />
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        error={fields.email?.message}
        {...form.register('email')}
      />
      <Input
        label="Password (at least 10 characters)"
        type="password"
        autoComplete="new-password"
        error={fields.password?.message}
        {...form.register('password')}
      />
      <Input
        label="Your time zone"
        error={fields.timeZone?.message}
        {...form.register('timeZone')}
      />
      <Button type="submit" pending={isSubmitting}>
        Create account
      </Button>
    </form>
  );
};
