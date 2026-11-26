'use client';

import { useState, type ReactNode } from 'react';
import { useEnrollmentsHold } from '@/shared/api';
import { Alert, Button, Input } from '@/shared/ui';

/** Books a seat. When there is none, `whenFull` is offered instead. */
export const BookSeat = ({
  cohortId,
  full,
  whenFull,
  onBooked,
}: {
  cohortId: string;
  full: boolean;
  whenFull: ReactNode;
  onBooked: (enrollmentId: string, promoProblem: string | null) => void;
}) => {
  const [code, setCode] = useState('');
  const hold = useEnrollmentsHold({
    mutation: {
      onSuccess: (held) => {
        onBooked(held.id, held.promoError?.message ?? null);
      },
    },
  });
  const noSeats = full || hold.error?.code === 'NO_SEATS';
  const codeError = hold.error?.fields?.find((field) => field.path === 'promoCode')?.message;
  if (noSeats) {
    return (
      <div className="flex flex-col gap-2">
        <Alert tone="info">There are no free seats in this cohort.</Alert>
        {whenFull}
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const promoCode = code.trim();
        hold.mutate({ data: { cohortId, ...(promoCode ? { promoCode } : {}) } });
      }}
    >
      {hold.error && !codeError ? <Alert>{hold.error.message}</Alert> : null}
      <Input
        label="Promo code (optional)"
        value={code}
        error={codeError}
        onChange={(event) => {
          setCode(event.target.value);
        }}
      />
      <Button type="submit" pending={hold.isPending}>
        Book a seat for 15 minutes
      </Button>
    </form>
  );
};
