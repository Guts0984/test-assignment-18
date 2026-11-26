'use client';

import { useWaitlistLeave } from '@/shared/api';
import { Alert, Button } from '@/shared/ui';

export const LeaveWaitlist = ({ cohortId, label }: { cohortId: string; label: string }) => {
  const leave = useWaitlistLeave();
  return (
    <div className="flex flex-col gap-1">
      {leave.error ? <Alert>{leave.error.message}</Alert> : null}
      <Button
        variant="secondary"
        pending={leave.isPending}
        onClick={() => {
          leave.mutate({ id: cohortId });
        }}
      >
        {label}
      </Button>
    </div>
  );
};
