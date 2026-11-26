'use client';

import { useState } from 'react';
import { useEnrollmentsCancel, useEnrollmentsRefundPreview } from '@/shared/api';
import { formatMoney } from '@/shared/lib';
import { Alert, Button, QueryState } from '@/shared/ui';

/** Shows how much comes back before anything is cancelled. */
export const CancelEnrollment = ({ enrollmentId }: { enrollmentId: string }) => {
  const [open, setOpen] = useState(false);
  const preview = useEnrollmentsRefundPreview(enrollmentId, {
    query: { enabled: open, staleTime: 0, gcTime: 0 },
  });
  const cancel = useEnrollmentsCancel({
    mutation: {
      onSuccess: () => {
        setOpen(false);
      },
    },
  });
  if (!open) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Cancel participation…
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {cancel.error ? <Alert>{cancel.error.message}</Alert> : null}
      <QueryState query={preview}>
        {(refund) => (
          <p data-testid="refund-preview">
            You will get back <strong>{formatMoney(refund.amountMinor, refund.currency)}</strong>
            {refund.paidMinor > 0
              ? ` (${refund.percent}% of ${formatMoney(refund.paidMinor, refund.currency)})`
              : ''}
            .
          </p>
        )}
      </QueryState>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!preview.data}
          pending={cancel.isPending}
          onClick={() => {
            cancel.mutate({ id: enrollmentId });
          }}
        >
          Confirm cancellation
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
          }}
        >
          Keep my place
        </Button>
      </div>
    </div>
  );
};
