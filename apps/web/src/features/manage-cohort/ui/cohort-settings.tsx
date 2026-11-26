'use client';

import { useState } from 'react';
import {
  useCohortsMentors,
  useCohortsUpdate,
  useRosterCapacity,
  type CohortDetailDtoOutput,
} from '@/shared/api';
import { parseMajor, toMajor } from '@/shared/lib';
import { Alert, Button, Input, Select } from '@/shared/ui';

export const CohortSettings = ({ cohort }: { cohort: CohortDetailDtoOutput }) => {
  const [capacity, setCapacity] = useState(String(cohort.capacity));
  const [price, setPrice] = useState(toMajor(cohort.priceMinor));
  const [mentorId, setMentorId] = useState(cohort.mentorId);
  const [priceError, setPriceError] = useState<string>();
  const mentors = useCohortsMentors();
  const resize = useRosterCapacity();
  const update = useCohortsUpdate();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form
        noValidate
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          resize.mutate({ id: cohort.id, data: { capacity: Number(capacity) } });
        }}
      >
        <Input
          label="Seats"
          inputMode="numeric"
          value={capacity}
          error={resize.error?.fields?.[0]?.message ?? resize.error?.message}
          onChange={(event) => {
            setCapacity(event.target.value);
          }}
        />
        <Button type="submit" variant="secondary" pending={resize.isPending}>
          Change seats
        </Button>
      </form>
      <form
        noValidate
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const priceMinor = parseMajor(price);
          setPriceError(priceMinor === null ? 'Enter an amount such as 250.50' : undefined);
          if (priceMinor !== null) update.mutate({ id: cohort.id, data: { priceMinor, mentorId } });
        }}
      >
        {update.error ? <Alert>{update.error.message}</Alert> : null}
        <Input
          label={`Price (${cohort.currency})`}
          inputMode="decimal"
          value={price}
          error={priceError}
          onChange={(event) => {
            setPrice(event.target.value);
          }}
        />
        <Select
          label="Mentor"
          value={mentorId}
          onChange={(event) => {
            setMentorId(event.target.value);
          }}
        >
          {mentors.data?.items.map((mentor) => (
            <option key={mentor.id} value={mentor.id}>
              {mentor.fullName}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" pending={update.isPending}>
          Save price and mentor
        </Button>
      </form>
    </div>
  );
};
