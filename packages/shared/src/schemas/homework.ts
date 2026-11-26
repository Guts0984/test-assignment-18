import { z } from 'zod';
import { SUBMISSION_STATUSES } from '../status/submission';
import { ENROLLMENT_STATUSES } from '../status/enrollment';
import { idSchema, instantSchema, pageOf, pageShape, text } from './common';
import { lessonSchema } from './catalog';

export const MAX_ANSWER_LENGTH = 20_000;

export const FILE_TYPES = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
} as const;

export const submitSchema = z.strictObject({ body: text(0, MAX_ANSWER_LENGTH).default('') });

export const reviewSchema = z
  .strictObject({
    verdict: z.enum(['accepted', 'returned']),
    comment: text(0, 5_000).default(''),
    score: z.number().int().min(0).max(100).nullable().default(null),
  })
  .refine((review) => review.verdict === 'accepted' || review.comment !== '', {
    error: 'Say what has to be changed',
    path: ['comment'],
  });

export const claimSchema = z.strictObject({ submissionId: idSchema.optional() });

export const reviewViewSchema = z.object({
  verdict: z.enum(['accepted', 'returned']),
  comment: z.string(),
  score: z.number().int().nullable(),
  reviewedAt: instantSchema,
});

export const submissionSchema = z.object({
  id: idSchema,
  homeworkId: idSchema,
  status: z.enum(SUBMISSION_STATUSES),
  body: z.string(),
  submittedAt: instantSchema,
  isLate: z.boolean(),
  file: z.object({ name: z.string(), sizeBytes: z.number().int() }).nullable(),
  /** Newest first. */
  reviews: z.array(reviewViewSchema),
});

export const cabinetCourseSchema = z.object({
  enrollmentId: idSchema,
  cohortId: idSchema,
  courseTitle: z.string(),
  status: z.enum(ENROLLMENT_STATUSES),
  cohortTimeZone: z.string(),
  progress: z.object({
    accepted: z.number().int(),
    total: z.number().int(),
    requiredPercent: z.number().int(),
  }),
  lessons: z.array(
    lessonSchema.extend({
      homework: z
        .object({
          id: idSchema,
          title: z.string(),
          deadlineAt: instantSchema,
          submission: submissionSchema.nullable(),
        })
        .nullable(),
    }),
  ),
  certificate: z.object({ id: idSchema, number: z.number().int() }).nullable(),
});

export const cabinetSchema = z.object({
  /** The student's own zone; instants are shown in it. */
  timeZone: z.string(),
  serverNow: instantSchema,
  courses: z.array(cabinetCourseSchema),
});

export const queueItemSchema = z.object({
  submissionId: idSchema,
  courseTitle: z.string(),
  studentName: z.string(),
  homeworkTitle: z.string(),
  submittedAt: instantSchema,
  isLate: z.boolean(),
});

export const queueQuerySchema = z.strictObject(pageShape);
export const queuePageSchema = pageOf(queueItemSchema);

export const mentorReviewsSchema = z.object({
  limit: z.number().int(),
  items: z.array(queueItemSchema),
});

export const mentorSubmissionSchema = submissionSchema.extend({
  courseTitle: z.string(),
  homeworkTitle: z.string(),
  studentName: z.string(),
  deadlineAt: instantSchema,
});

export const claimResultSchema = z.object({ submissionId: idSchema });

export const mentorStudentSchema = z.object({
  enrollmentId: idSchema,
  studentName: z.string(),
  email: z.string(),
  courseTitle: z.string(),
  cohortId: idSchema,
  status: z.enum(ENROLLMENT_STATUSES),
  accepted: z.number().int(),
  submitted: z.number().int(),
  total: z.number().int(),
});
export const mentorStudentQuerySchema = z.strictObject({
  cohortId: idSchema.optional(),
  ...pageShape,
});
export const mentorStudentPageSchema = pageOf(mentorStudentSchema);

export type SubmissionView = z.infer<typeof submissionSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type Cabinet = z.infer<typeof cabinetSchema>;
