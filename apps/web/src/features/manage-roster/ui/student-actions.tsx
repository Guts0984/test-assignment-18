'use client';

import { useState } from 'react';
import { useCohortsList, useRosterExclude, useRosterTransfer } from '@/shared/api';
import { formatDay } from '@/shared/lib';
import { Alert, Button, Select } from '@/shared/ui';

/** Move a student to another cohort of the course, or exclude them with a refund. */
export const StudentActions = ({
  enrollmentId,
  courseId,
  cohortId,
}: {
  enrollmentId: string;
  courseId: string;
  cohortId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [policy, setPolicy] = useState<'rule' | 'full'>('rule');
  const cohorts = useCohortsList({ courseId, pageSize: 100 }, { query: { enabled: open } });
  const transfer = useRosterTransfer();
  const exclude = useRosterExclude();
  const failure = transfer.error ?? exclude.error;
  if (!open) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Manage…
      </Button>
    );
  }
  return (
    <div className="flex min-w-56 flex-col gap-2">
      {failure ? <Alert>{failure.message}</Alert> : null}
      {transfer.data && transfer.data.surchargeMinor > 0 ? (
        <Alert tone="info">A seat is reserved until the student pays the difference.</Alert>
      ) : null}
      <Select
        label="Move to cohort"
        value={target}
        onChange={(event) => {
          setTarget(event.target.value);
        }}
      >
        <option value="">Choose a cohort</option>
        {cohorts.data?.items
          .filter((cohort) => cohort.id !== cohortId)
          .map((cohort) => (
            <option key={cohort.id} value={cohort.id}>
              {formatDay(cohort.startDate)} ({cohort.seatsTaken}/{cohort.capacity})
            </option>
          ))}
      </Select>
      <Button
        variant="secondary"
        disabled={!target}
        pending={transfer.isPending}
        onClick={() => {
          transfer.mutate({ id: enrollmentId, data: { targetCohortId: target } });
        }}
      >
        Move student
      </Button>
      <Select
        label="Refund on exclusion"
        value={policy}
        onChange={(event) => {
          setPolicy(event.target.value === 'full' ? 'full' : 'rule');
        }}
      >
        <option value="rule">By the refund rule</option>
        <option value="full">Everything paid</option>
      </Select>
      <Button
        variant="danger"
        pending={exclude.isPending}
        onClick={() => {
          exclude.mutate({ id: enrollmentId, data: { refundPolicy: policy } });
        }}
      >
        Exclude student
      </Button>
    </div>
  );
};
