import { type ReactNode } from 'react';

export const Page = ({ title, children }: { title: string; children: ReactNode }) => (
  <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
    <h1 className="text-2xl font-semibold break-words">{title}</h1>
    {children}
  </main>
);

export const Card = ({ children, label }: { children: ReactNode; label?: string }) => (
  <section
    aria-label={label}
    className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
  >
    {children}
  </section>
);

const TONES = {
  info: 'border-blue-300 bg-blue-50 text-blue-900',
  success: 'border-green-300 bg-green-50 text-green-900',
  error: 'border-red-300 bg-red-50 text-red-900',
} as const;

export const Alert = ({
  tone = 'error',
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={`rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}
  >
    {children}
  </div>
);

export const Badge = ({ children }: { children: ReactNode }) => (
  <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
    {children}
  </span>
);

/** Loading and failure states of a query; renders its children once data is there. */
export const QueryState = <T,>({
  query,
  children,
}: {
  query: { data: T | undefined; error: { message: string } | null; isPending: boolean };
  children: (data: T) => ReactNode;
}) => {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) return <Alert>{query.error.message}</Alert>;
  return <p role="status">Loading…</p>;
};

/** A table that scrolls inside itself, so the page never scrolls sideways. */
export const Table = ({
  headers,
  children,
  caption,
}: {
  headers: readonly string[];
  children: ReactNode;
  caption: string;
}) => (
  <div className="w-full overflow-x-auto">
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col" className="border-b border-slate-300 px-2 py-2">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-2">
        {children}
      </tbody>
    </table>
  </div>
);
