'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createStaffSchema } from '@school/shared/schemas/staff';
import { useForm } from 'react-hook-form';
import { useStaffCreate } from '@/shared/api';
import { useApiErrors } from '@/shared/lib';
import { Alert, Button, Input, Select } from '@/shared/ui';

export const CreateStaff = () => {
  const form = useForm({
    resolver: zodResolver(createStaffSchema),
    defaultValues: { email: '', password: '', fullName: '', role: 'mentor' as const },
  });
  const errors = useApiErrors(form.setError, ['email', 'password', 'fullName', 'role']);
  const create = useStaffCreate({
    mutation: {
      onSuccess: () => {
        form.reset();
      },
      onError: errors.show,
    },
  });
  const { errors: fields } = form.formState;
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        errors.clear();
        void form.handleSubmit((data) => {
          create.mutate({ data });
        })(event);
      }}
    >
      {errors.formError ? (
        <div className="sm:col-span-2">
          <Alert>{errors.formError}</Alert>
        </div>
      ) : null}
      <Input label="Full name" error={fields.fullName?.message} {...form.register('fullName')} />
      <Input
        label="E-mail"
        type="email"
        error={fields.email?.message}
        {...form.register('email')}
      />
      <Input
        label="Initial password"
        type="password"
        autoComplete="new-password"
        error={fields.password?.message}
        {...form.register('password')}
      />
      <Select label="Role" error={fields.role?.message} {...form.register('role')}>
        <option value="mentor">Mentor</option>
        <option value="manager">Manager</option>
      </Select>
      <div className="sm:col-span-2">
        <Button type="submit" pending={create.isPending}>
          Add employee
        </Button>
      </div>
    </form>
  );
};
