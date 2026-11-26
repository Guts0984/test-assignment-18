'use client';

import { CURRENCIES } from '@school/shared/money/money';
import { useState } from 'react';
import { useCohortsCreate, useCohortsMentors, useCoursesList } from '@/shared/api';
import { Alert, Button, Input, Select } from '@/shared/ui';
import {
  FIELD_OF_PATH,
  toCohortInput,
  type CohortFields,
  type FieldProblems,
} from '../model/cohort-form';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ZONES = ['Europe/Kyiv', 'Europe/Warsaw', 'America/New_York'];

const INITIAL: CohortFields = {
  courseId: '',
  mentorId: '',
  startDate: '',
  timeZone: 'Europe/Kyiv',
  capacity: '20',
  price: '',
  currency: 'UAH',
  weekdays: [2, 4],
  localTime: '19:00',
  count: '12',
};

export const CreateCohort = ({ onCreated }: { onCreated: (id: string) => void }) => {
  const [fields, setFields] = useState(INITIAL);
  const [problems, setProblems] = useState<FieldProblems>({});
  const [search, setSearch] = useState('');
  const courses = useCoursesList({ pageSize: 100, ...(search ? { q: search } : {}) });
  const mentors = useCohortsMentors();
  const create = useCohortsCreate({
    mutation: {
      onSuccess: (cohort) => {
        onCreated(cohort.id);
      },
      onError: (error) => {
        setProblems(
          Object.fromEntries(
            (error.fields ?? []).map((item) => [
              FIELD_OF_PATH[item.path] ?? item.path,
              item.message,
            ]),
          ),
        );
      },
    },
  });
  const bind = (name: Exclude<keyof CohortFields, 'weekdays'>) => ({
    value: fields[name],
    error: problems[name],
    onChange: (event: { target: { value: string } }) => {
      setFields({ ...fields, [name]: event.target.value });
    },
  });
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const result = toCohortInput(fields);
        setProblems('problems' in result ? result.problems : {});
        if ('input' in result) create.mutate({ data: result.input });
      }}
    >
      {create.error && !create.error.fields ? (
        <div className="sm:col-span-2">
          <Alert>{create.error.message}</Alert>
        </div>
      ) : null}
      <Input
        label="Find a course"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <Select label="Course" {...bind('courseId')}>
        <option value="">Choose a course</option>
        {courses.data?.items.map((course) => (
          <option key={course.id} value={course.id}>
            {course.title}
          </option>
        ))}
      </Select>
      <Select label="Mentor" {...bind('mentorId')}>
        <option value="">Choose a mentor</option>
        {mentors.data?.items.map((mentor) => (
          <option key={mentor.id} value={mentor.id}>
            {mentor.fullName}
          </option>
        ))}
      </Select>
      <Input label="First day" type="date" {...bind('startDate')} />
      <Select label="Time zone of the cohort" {...bind('timeZone')}>
        {ZONES.map((zone) => (
          <option key={zone}>{zone}</option>
        ))}
      </Select>
      <Input label="Seats" inputMode="numeric" {...bind('capacity')} />
      <Input label="Price" inputMode="decimal" {...bind('price')} />
      <Select label="Currency" {...bind('currency')}>
        {CURRENCIES.map((currency) => (
          <option key={currency}>{currency}</option>
        ))}
      </Select>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium">Lesson days</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((day, index) => (
            <label key={day} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={fields.weekdays.includes(index + 1)}
                onChange={(event) => {
                  const others = fields.weekdays.filter((value) => value !== index + 1);
                  setFields({
                    ...fields,
                    weekdays: event.target.checked ? [...others, index + 1] : others,
                  });
                }}
              />
              {day}
            </label>
          ))}
        </div>
        {problems.weekdays ? (
          <p role="alert" className="text-sm text-red-700">
            {problems.weekdays}
          </p>
        ) : null}
      </fieldset>
      <Input label="Local start time" type="time" {...bind('localTime')} />
      <Input label="Number of lessons" inputMode="numeric" {...bind('count')} />
      <div className="sm:col-span-2">
        <Button type="submit" pending={create.isPending}>
          Create cohort
        </Button>
      </div>
    </form>
  );
};
