'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@school/shared/schemas/auth';
import { useForm } from 'react-hook-form';
import { useAuthLogin, type AccountDtoOutput } from '@/shared/api';
import { useApiErrors } from '@/shared/lib';
import { Alert, Button, Input } from '@/shared/ui';

export const LoginForm = ({ onSignedIn }: { onSignedIn: (account: AccountDtoOutput) => void }) => {
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const errors = useApiErrors(form.setError, ['email', 'password']);
  const login = useAuthLogin({ mutation: { onSuccess: onSignedIn, onError: errors.show } });
  const { errors: fields } = form.formState;
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        errors.clear();
        void form.handleSubmit((data) => {
          login.mutate({ data });
        })(event);
      }}
    >
      {errors.formError ? <Alert>{errors.formError}</Alert> : null}
      <Input
        label="E-mail"
        type="email"
        autoComplete="username"
        error={fields.email?.message}
        {...form.register('email')}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        error={fields.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" pending={login.isPending}>
        Sign in
      </Button>
    </form>
  );
};
