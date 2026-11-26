'use client';

import { useWaitlistJoin } from '@/shared/api';
import { Alert, Button } from '@/shared/ui';

export const JoinWaitlist = ({ cohortId }: { cohortId: string }) => {
  const join = useWaitlistJoin();
  const place = join.data?.items.find((item) => item.cohortId === cohortId)?.place;
  if (join.isSuccess) {
    return (
      <Alert tone="success">
        You are on the waiting list{place ? `, number ${place} in line` : ''}. We will e-mail you
        when a seat is yours.
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {join.error ? <Alert>{join.error.message}</Alert> : null}
      <Button
        variant="secondary"
        pending={join.isPending}
        onClick={() => {
          join.mutate({ id: cohortId });
        }}
      >
        Join the waiting list
      </Button>
    </div>
  );
};
