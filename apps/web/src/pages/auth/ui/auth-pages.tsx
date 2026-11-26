'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { homeOf, safeNext } from '@/entities/session';
import { LoginForm, RegisterForm } from '@/features/auth';
import { type AccountDtoOutput } from '@/shared/api';
import { useSearchText } from '@/shared/lib';
import { Card, Page } from '@/shared/ui';

const useEnter = () => {
  const router = useRouter();
  const search = useSearchText();
  const client = useQueryClient();
  return (account: AccountDtoOutput) => {
    client.clear();
    router.push(safeNext(new URLSearchParams(search).get('next'), homeOf(account.role)));
  };
};

export const LoginPage = () => {
  const enter = useEnter();
  return (
    <Page title="Sign in">
      <Card>
        <LoginForm onSignedIn={enter} />
        <p className="text-sm">
          New here?{' '}
          <Link className="underline" href="/register">
            Create an account
          </Link>
        </p>
      </Card>
    </Page>
  );
};

export const RegisterPage = () => {
  const enter = useEnter();
  return (
    <Page title="Create account">
      <Card>
        <RegisterForm onSignedIn={enter} />
      </Card>
    </Page>
  );
};
