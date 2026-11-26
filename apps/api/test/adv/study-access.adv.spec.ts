import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { signedIn } from '../attacker/people';
import { handIn, studyingCohort } from '../attacker/study';
import { issueFor } from '../attacker/certificates';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

const victim = async () => {
  const study = await studyingCohort(api);
  const reply = await handIn(study.first, study.homework[0] ?? '', {
    file: { name: 'secret.txt', content: Buffer.from('the private answer') },
  });
  return { ...study, submissionId: (reply.body as { id: string }).id };
};

describe('homework of others', () => {
  it('is closed to another student', async () => {
    const target = await victim();
    const thief = await studyingCohort(api);
    expectError(
      await thief.first.http.get(`/api/submissions/${target.submissionId}/file`),
      'NOT_FOUND',
    );
    expectError(await handIn(thief.first, target.homework[0] ?? ''), 'NOT_FOUND');
    expect((await thief.first.http.get('/api/cabinet')).text).not.toContain(target.cohort.id);
  });

  it('is closed to another mentor, even of the same school', async () => {
    const target = await victim();
    const colleague = await signedIn(api, 'mentor', target.school.id);
    const outsider = (await studyingCohort(api)).mentorHttp;
    const { submissionId } = target;
    for (const mentor of [colleague.http, outsider]) {
      expectError(await mentor.get(`/api/mentor/submissions/${submissionId}`), 'NOT_FOUND');
      expectError(await mentor.get(`/api/submissions/${submissionId}/file`), 'NOT_FOUND');
      expectError(
        await mentor.post('/api/mentor/queue/claim', { submissionId }),
        'NOTHING_TO_REVIEW',
      );
      expectError(
        await mentor.post(`/api/mentor/submissions/${submissionId}/review`, {
          verdict: 'accepted',
        }),
        'NOT_FOUND',
      );
      expectError(
        await mentor.post(`/api/mentor/submissions/${submissionId}/release`),
        'NOT_FOUND',
      );
      const queue = await mentor.get('/api/mentor/queue');
      expect(queue.text).not.toContain(submissionId);
      const students = await mentor.get(`/api/mentor/students?cohortId=${target.cohort.id}`);
      expect(students.body).toMatchObject({ total: 0 });
    }
  });

  it('is open to the school’s manager and closed to a foreign one', async () => {
    const target = await victim();
    const own = await signedIn(api, 'manager', target.school.id);
    expect((await own.http.get(`/api/submissions/${target.submissionId}/file`)).status).toBe(200);
    const foreign = await signedIn(api, 'manager', (await studyingCohort(api)).school.id);
    expectError(
      await foreign.http.get(`/api/submissions/${target.submissionId}/file`),
      'NOT_FOUND',
    );
  });
});

describe('certificates', () => {
  it('belong to their student, and verify only through the exact secret link', async () => {
    const holder = await studyingCohort(api, { lessons: 1 });
    const certificate = await issueFor(api, holder);
    const list = (await holder.first.http.get('/api/certificates')).body as {
      items: { id: string; number: number; verifyUrl: string }[];
    };
    const [item] = list.items;
    const token = item?.verifyUrl.split('/verify/')[1] ?? '';
    expect(token.length).toBeGreaterThanOrEqual(40);

    const pdf = await holder.first.http.get(`/api/certificates/${certificate.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.text.startsWith('%PDF-')).toBe(true);

    const thief = await studyingCohort(api);
    expectError(await thief.first.http.get(`/api/certificates/${certificate.id}/pdf`), 'NOT_FOUND');
    expect((await thief.first.http.get('/api/certificates')).body).toEqual({ items: [] });

    const anyone = client(api.url);
    expect((await anyone.get(`/api/verify/${token}`)).body).toMatchObject({
      number: certificate.number,
      courseTitle: 'TypeScript',
    });
    // Nothing sequential or derivable opens it.
    const guesses = [
      String(certificate.number).padStart(43, '0'),
      certificate.id.replaceAll('-', '').padEnd(43, '0'),
      holder.course.id.replaceAll('-', '').padEnd(43, '1'),
      `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`,
      token.toUpperCase(),
      `${token}x`,
      token.slice(0, -1),
    ];
    for (const guess of guesses) {
      expectError(await anyone.get(`/api/verify/${guess}`), 'NOT_FOUND');
    }
    const random = await burst(200, (i) =>
      anyone.get(`/api/verify/${Buffer.alloc(32, i).toString('base64url')}`),
    );
    expect(new Set(random.map((r) => r.status))).toEqual(new Set([404]));
    expectError(await anyone.get('/api/verify/1'), 'VALIDATION_FAILED');
  });
});
