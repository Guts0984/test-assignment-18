import { Suspense, type ReactNode } from 'react';
import { Providers } from '@/app';
import { Header } from '@/widgets/header';
import '@/app/globals.css';

export const metadata = { title: 'Online school', description: 'Courses in cohorts' };
export const viewport = { width: 'device-width', initialScale: 1 };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <Suspense>{children}</Suspense>
        </Providers>
      </body>
    </html>
  );
}
