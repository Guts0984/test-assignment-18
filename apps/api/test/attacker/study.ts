import { createEnrollment, createUser } from '@school/db/testing/factories';
import { type TestApi } from './app';
import { sellingCohort } from './money';
import { signInAs, type Student } from './students';

/**
 * A running cohort with `lessons` lessons, each with homework due a week later, and `count`
 * paid students.
 */
export const studyingCohort = async (
  api: TestApi,
  options: { readonly students?: number; readonly lessons?: number } = {},
) => {
  const sale = await sellingCohort(api, { capacity: options.students ?? 1 });
  const base = api.clock.now().getTime();
  const homework: string[] = [];
  for (let seq = 1; seq <= (options.lessons ?? 3); seq += 1) {
    const startsAt = new Date(base + (seq - 1) * 3_600_000);
    const lesson = await api.db.lesson.create({
      data: {
        cohortId: sale.cohort.id,
        seq,
        localDate: new Date(startsAt.toISOString().slice(0, 10)),
        localTime: '19:00',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 1_800_000),
        homework: {
          create: {
            cohortId: sale.cohort.id,
            title: `Homework ${seq}`,
            deadlineAt: new Date(startsAt.getTime() + 7 * 86_400_000),
          },
        },
      },
      include: { homework: true },
    });
    homework.push(lesson.homework?.id ?? '');
  }
  const students: (Student & { enrollmentId: string })[] = [];
  for (let i = 0; i < (options.students ?? 1); i += 1) {
    const user = await createUser(api.db);
    const enrollment = await createEnrollment(api.db, sale.cohort, {
      status: 'paid',
      studentId: user.id,
    });
    students.push({
      id: user.id,
      enrollmentId: enrollment.id,
      http: await signInAs(api, user.id, api.copies[i % api.copies.length]?.url),
    });
  }
  const mentor = await signInAs(api, sale.mentor.id);
  const [first] = students;
  if (!first) throw new Error('fixture');
  return { ...sale, homework, students, first, mentorHttp: mentor };
};

/** Hands in homework as the web form does. */
export const handIn = (
  student: Student,
  homeworkId: string,
  input: { readonly body?: string; readonly file?: { name: string; content: Buffer } } = {},
) => {
  const boundary = 'test-boundary-7MA4YWxkTrZu0gW';
  const parts: Buffer[] = [];
  const field = (head: string, content: Buffer) => {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; ${head}\r\n\r\n`),
      content,
      Buffer.from('\r\n'),
    );
  };
  field('name="body"', Buffer.from(input.body ?? 'My answer'));
  if (input.file) {
    field(
      `name="file"; filename="${input.file.name}"\r\nContent-Type: application/octet-stream`,
      input.file.content,
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return student.http.send('PUT', `/api/homework/${homeworkId}/submission`, {
    raw: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
};
