'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { usePath } from '@/shared/lib';
import { Alert, Page } from '@/shared/ui';
import { type SessionRole } from '../model/roles';
import { useSession } from '../model/use-session';

/**
 * Shows a page to its role only. This is a convenience: the server enforces every permission.
 */
export const RequireRole = ({ role, children }: { role: SessionRole; children: ReactNode }) => {
  const { account } = useSession();
  const pathname = usePath();
  if (account === undefined) {
    return (
      <Page title="Loading…">
        <p role="status">Checking your session…</p>
      </Page>
    );
  }
  if (account?.role === role) return <>{children}</>;
  return (
    <Page title="Sign in">
      <Alert tone="info">
        This page is for a {role}.{' '}
        <Link className="underline" href={`/login?next=${encodeURIComponent(pathname)}`}>
          Sign in
        </Link>
      </Alert>
    </Page>
  );
};
