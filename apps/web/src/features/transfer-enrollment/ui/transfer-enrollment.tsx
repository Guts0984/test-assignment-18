'use client';

import { useState } from 'react';
import { useEnrollmentsTransfer, useEnrollmentsTransferOptions } from '@/shared/api';
import { formatDay, formatMoney } from '@/shared/lib';
import { Alert, Button, QueryState } from '@/shared/ui';

export const TransferEnrollment = ({
  enrollmentId,
  onMoved,
}: {
  enrollmentId: string;
  onMoved: (newEnrollmentId: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const options = useEnrollmentsTransferOptions(enrollmentId, { query: { enabled: open } });
  const transfer = useEnrollmentsTransfer({
    mutation: {
      onSuccess: (moved) => {
        onMoved(moved.id);
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
        Move to another cohort…
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {transfer.error ? <Alert>{transfer.error.message}</Alert> : null}
      <QueryState query={options}>
        {({ items }) =>
          items.length === 0 ? (
            <p>There is no other cohort of this course to move to.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((option) => (
                <li
                  key={option.cohortId}
                  className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    Starts {formatDay(option.startDate)} · {option.freeSeats} free ·{' '}
                    {option.differenceMinor > 0
                      ? `pay ${formatMoney(option.differenceMinor, option.currency)} more`
                      : option.differenceMinor < 0
                        ? `${formatMoney(-option.differenceMinor, option.currency)} comes back`
                        : 'same price'}
                  </span>
                  <Button
                    disabled={option.freeSeats === 0}
                    pending={transfer.isPending}
                    onClick={() => {
                      transfer.mutate({
                        id: enrollmentId,
                        data: { targetCohortId: option.cohortId },
                      });
                    }}
                  >
                    Move here
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </div>
  );
};
