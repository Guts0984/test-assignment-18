'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createCourseSchema } from '@school/shared/schemas/manage';
import { useForm } from 'react-hook-form';
import { useCoursesCreate, useCoursesUpdate, type CourseDtoOutput } from '@/shared/api';
import { useApiErrors } from '@/shared/lib';
import { Alert, Button, Input, TextArea } from '@/shared/ui';

export const CourseForm = ({ course }: { course?: CourseDtoOutput }) => {
  const form = useForm({
    resolver: zodResolver(createCourseSchema),
    defaultValues: {
      title: course?.title ?? '',
      direction: course?.direction ?? '',
      description: course?.description ?? '',
    },
  });
  const errors = useApiErrors(form.setError, ['title', 'direction', 'description']);
  const create = useCoursesCreate({
    mutation: {
      onSuccess: () => {
        form.reset();
      },
      onError: errors.show,
    },
  });
  const update = useCoursesUpdate({ mutation: { onError: errors.show } });
  const { errors: fields } = form.formState;
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        errors.clear();
        void form.handleSubmit((data) => {
          if (course) update.mutate({ id: course.id, data });
          else create.mutate({ data });
        })(event);
      }}
    >
      {errors.formError ? <Alert>{errors.formError}</Alert> : null}
      <Input label="Title" error={fields.title?.message} {...form.register('title')} />
      <Input label="Direction" error={fields.direction?.message} {...form.register('direction')} />
      <TextArea
        label="Description"
        error={fields.description?.message}
        {...form.register('description')}
      />
      <Button type="submit" pending={create.isPending || update.isPending}>
        {course ? 'Save course' : 'Create course'}
      </Button>
    </form>
  );
};
