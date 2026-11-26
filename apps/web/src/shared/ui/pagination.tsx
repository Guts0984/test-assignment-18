import { Button } from './button';

export const Pagination = ({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => {
          onChange(page - 1);
        }}
      >
        Previous
      </Button>
      <span className="text-sm text-slate-600">
        Page {page} of {pages} · {total} total
      </span>
      <Button
        variant="secondary"
        disabled={page >= pages}
        onClick={() => {
          onChange(page + 1);
        }}
      >
        Next
      </Button>
    </nav>
  );
};
