'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NAVIGATION, useSession } from '@/entities/session';
import { useAuthLogout } from '@/shared/api';
import { usePath } from '@/shared/lib';
import { Button } from '@/shared/ui';

export const Header = () => {
  const { account } = useSession();
  const pathname = usePath();
  const router = useRouter();
  const client = useQueryClient();
  const logout = useAuthLogout({
    mutation: {
      onSuccess: () => {
        client.clear();
        router.push('/');
      },
    },
  });
  const links = account ? NAVIGATION[account.role] : ([['/', 'Catalog']] as const);
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <nav aria-label="Main" className="flex flex-1 flex-wrap gap-x-4">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className="flex min-h-11 items-center text-sm font-medium text-slate-700 aria-[current=page]:text-blue-700 aria-[current=page]:underline"
            >
              {label}
            </Link>
          ))}
        </nav>
        {account ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">{account.fullName}</span>
            <Button
              variant="secondary"
              pending={logout.isPending}
              onClick={() => {
                logout.mutate();
              }}
            >
              Sign out
            </Button>
          </div>
        ) : account === null ? (
          <div className="flex gap-3 text-sm font-medium">
            <Link href="/login" className="flex min-h-11 items-center">
              Sign in
            </Link>
            <Link href="/register" className="flex min-h-11 items-center">
              Create account
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
};
