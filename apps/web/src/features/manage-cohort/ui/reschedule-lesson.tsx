'use client';

import { useState } from 'react';
import { useCohortsReschedule } from '@/shared/api';
import { Button, Input } from '@/shared/ui';

export const RescheduleLesson = ({
  lessonId,
  localDate,
  localTime,
}: {
  lessonId: string;
  localDate: string;
  localTime: string;
}) => {
  const [date, setDate] = useState(localDate);
  const [time, setTime] = useState(localTime);
  const move = useCohortsReschedule();
  const errorAt = (path: string) =>
    move.error?.fields?.find((field) => field.path === path)?.message;
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        move.mutate({ id: lessonId, data: { localDate: date, localTime: time } });
      }}
    >
      <Input
        label="Date"
        type="date"
        value={date}
        error={errorAt('localDate') ?? (move.error?.fields ? undefined : move.error?.message)}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />
      <Input
        label="Time"
        type="time"
        value={time}
        error={errorAt('localTime')}
        onChange={(event) => {
          setTime(event.target.value);
        }}
      />
      <Button type="submit" variant="secondary" pending={move.isPending}>
        Move
      </Button>
    </form>
  );
};
