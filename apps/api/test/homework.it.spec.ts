import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from './attacker/app';
import { expectError } from './attacker/expect';
import { handIn, studyingCohort } from './attacker/study';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ env: { UPLOAD_MAX_BYTES: '2048' } });
});
afterAll(async () => {
  await api.stop();
});

type View = {
  id: string;
  status: string;
  isLate: boolean;
  body: string;
  file: { name: string } | null;
  reviews: { verdict: string; comment: string }[];
};

describe('homework', () => {
  it('goes through submit, return, resubmit and accept, with the late mark decided by the server', async () => {
    api.clock.set(NOW);
    const study = await studyingCohort(api);
    const [first = ''] = study.homework;
    const deadline = NOW.getTime() + 7 * 86_400_000;
    const submit = (body: string) => handIn(study.first, first, { body });
    const claim = () => study.mentorHttp.post('/api/mentor/queue/claim', {});

    api.clock.set(new Date(deadline));
    const onTime = (await submit('first')).body as View;
    expect(onTime).toMatchObject({ status: 'submitted', isLate: false });
    api.clock.set(new Date(deadline + 1));
    expect((await submit('replaced')).body).toMatchObject({ isLate: true, body: 'replaced' });

    await claim();
    expectError(await submit('during review'), 'SUBMISSION_LOCKED');
    const review = (verdict: string, comment: string) =>
      study.mentorHttp.post(`/api/mentor/submissions/${onTime.id}/review`, { verdict, comment });
    expectError(await review('returned', ''), 'VALIDATION_FAILED');
    expect((await review('returned', 'Handle the empty list')).status).toBe(204);

    const again = (await submit('fixed')).body as View;
    expect(again.reviews).toMatchObject([
      { verdict: 'returned', comment: 'Handle the empty list' },
    ]);
    await claim();
    expect((await review('accepted', 'Good')).status).toBe(204);
    expectError(await submit('after acceptance'), 'SUBMISSION_LOCKED');

    const cabinet = (await study.first.http.get('/api/cabinet')).body as {
      timeZone: string;
      courses: {
        progress: { accepted: number; total: number };
        lessons: { homework: { submission: View | null } }[];
      }[];
    };
    expect(cabinet.courses[0]?.progress).toMatchObject({ accepted: 1, total: 3 });
    expect(cabinet.courses[0]?.lessons[0]?.homework.submission?.status).toBe('accepted');
    expect((await study.mentorHttp.get('/api/mentor/students')).body).toMatchObject({
      total: 1,
      items: [{ accepted: 1, submitted: 1, total: 3 }],
    });
    await assertInvariants(api.db);
  });

  it('stores a file and returns it only as a download', async () => {
    const study = await studyingCohort(api);
    const content = Buffer.from('%PDF-1.7 homework');
    const reply = await handIn(study.first, study.homework[0] ?? '', {
      body: '',
      file: { name: '../../Моя робота.pdf', content },
    });
    expect(reply.body).toMatchObject({ file: { name: 'Моя робота.pdf' } });
    const { id } = reply.body as View;
    for (const http of [study.first.http, study.mentorHttp]) {
      const file = await http.get(`/api/submissions/${id}/file`);
      expect(file.status).toBe(200);
      expect(file.text).toBe(content.toString());
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(file.headers['content-type']).toBe('application/octet-stream');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('keeps an earlier file on resubmission unless it is replaced or removed', async () => {
    const study = await studyingCohort(api);
    const [first = ''] = study.homework;
    const pdf = (text: string) => ({ name: `${text}.pdf`, content: Buffer.from(`%PDF-${text}`) });
    await handIn(study.first, first, { file: pdf('one') });
    const kept = await handIn(study.first, first, { body: 'only the text changed' });
    expect(kept.body).toMatchObject({ body: 'only the text changed', file: { name: 'one.pdf' } });
    // A file alone is an answer: the text may be emptied while the file stays.
    expect((await handIn(study.first, first, { body: '' })).body).toMatchObject({
      file: { name: 'one.pdf' },
    });
    const replaced = await handIn(study.first, first, { file: pdf('two') });
    expect(replaced.body).toMatchObject({ file: { name: 'two.pdf' } });
    expectError(
      await handIn(study.first, first, { body: '', removeFile: 'true' }),
      'VALIDATION_FAILED',
    );
    expectError(await handIn(study.first, first, { removeFile: 'yes' }), 'VALIDATION_FAILED');
    const removed = await handIn(study.first, first, { body: 'text', removeFile: 'true' });
    expect(removed.body).toMatchObject({ file: null });
    expect(
      await api.db.submissionFile.count({ where: { submission: { homeworkId: first } } }),
    ).toBe(0);
  });

  it('takes only a form, so no other body can empty an answer', async () => {
    const study = await studyingCohort(api);
    const [first = ''] = study.homework;
    const file = { name: 'work.pdf', content: Buffer.from('%PDF-work') };
    await handIn(study.first, first, { body: 'my answer', file });
    const path = `/api/homework/${first}/submission`;
    const typed = (type: string, raw: string) =>
      study.first.http.send('PUT', path, { raw, headers: { 'content-type': type } });
    for (const reply of [
      await study.first.http.send('PUT', path, { body: { body: '' } }),
      await typed('text/plain', 'new text'),
      await typed('application/x-www-form-urlencoded', 'body=new'),
      await typed('multipart/mixed; boundary=x', '--x--'),
      await study.first.http.send('PUT', path),
    ]) {
      expectError(reply, 'UNSUPPORTED_MEDIA_TYPE');
    }
    expect(
      await api.db.submission.findFirstOrThrow({ where: { homeworkId: first } }),
    ).toMatchObject({ body: 'my answer', version: 1 });
  });

  it('refuses hostile uploads with a clear error and stores nothing', async () => {
    const study = await studyingCohort(api);
    const [first = ''] = study.homework;
    const upload = (name: string, content: Buffer) =>
      handIn(study.first, first, { file: { name, content } });
    expectError(await upload('page.html', Buffer.from('<script>')), 'VALIDATION_FAILED');
    expectError(await upload('fake.pdf', Buffer.from('<script>')), 'VALIDATION_FAILED');
    expectError(await upload('big.txt', Buffer.alloc(2_049, 97)), 'PAYLOAD_TOO_LARGE');
    expectError(await handIn(study.first, first, { body: '' }), 'VALIDATION_FAILED');
    const withNul = `a${String.fromCharCode(0)}b`;
    expectError(await handIn(study.first, first, { body: withNul }), 'VALIDATION_FAILED');
    expectError(
      await study.first.http.send('PUT', `/api/homework/${first}/submission`, {
        raw: '--broken',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }),
      'MALFORMED_REQUEST',
    );
    expectError(
      await study.first.http.send('PUT', `/api/homework/${first}/submission`, {
        body: { body: 'json', status: 'accepted' },
      }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect(await api.db.submission.count({ where: { cohortId: study.cohort.id } })).toBe(0);
  });

  it('ignores attempts to set the verdict, lateness or owner through the form', async () => {
    const study = await studyingCohort(api);
    const boundary = 'b';
    const field = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    for (const [name, value] of [
      ['status', 'accepted'],
      ['isLate', 'false'],
      ['studentId', study.mentor.id],
    ] as const) {
      const reply = await study.first.http.send(
        'PUT',
        `/api/homework/${study.homework[0] ?? ''}/submission`,
        {
          raw: `${field('body', 'x')}${field(name, value)}--${boundary}--\r\n`,
          headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        },
      );
      expectError(reply, 'VALIDATION_FAILED');
    }
  });
});
