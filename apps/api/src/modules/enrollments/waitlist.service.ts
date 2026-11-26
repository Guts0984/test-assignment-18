import { Inject, Injectable } from '@nestjs/common';
import { joinWaitlist, leaveWaitlist } from '@school/db/repo/waitlist';
import { type WaitlistEntryView } from '@school/shared/schemas/enrollment';
import { rejected } from '../../common/errors/rejections';
import { runBusiness } from '../../infra/business';
import { DEPS, type Deps } from '../../infra/deps';
import { isoDate } from '../catalog/domain';

type Row = {
  readonly cohort_id: string;
  readonly title: string;
  readonly start_date: Date;
  readonly status: 'waiting' | 'offered';
  readonly place: number | null;
  readonly enrollment_id: string | null;
};

@Injectable()
export class WaitlistService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(studentId: string): Promise<{ items: WaitlistEntryView[] }> {
    const rows = await this.deps.db.$queryRaw<Row[]>`
      SELECT w.cohort_id, co.title, c.start_date, w.status, w.enrollment_id,
             CASE WHEN w.status = 'waiting' THEN (
               SELECT count(*)::int FROM waitlist_entries a
                WHERE a.cohort_id = w.cohort_id AND a.status = 'waiting'
                  AND a.position <= w.position) END AS place
        FROM waitlist_entries w
        JOIN cohorts c ON c.id = w.cohort_id
        JOIN courses co ON co.id = c.course_id
       WHERE w.student_id = ${studentId}::uuid AND w.status IN ('waiting', 'offered')
       ORDER BY c.start_date, w.cohort_id`;
    return {
      items: rows.map((row) => ({
        cohortId: row.cohort_id,
        courseTitle: row.title,
        startDate: isoDate(row.start_date),
        status: row.status,
        place: row.place,
        enrollmentId: row.enrollment_id,
      })),
    };
  }

  async join(studentId: string, cohortId: string) {
    const outcome = await runBusiness(this.deps, (unit) =>
      joinWaitlist(unit, { cohortId, studentId }),
    );
    if (outcome !== 'JOINED') throw rejected(outcome);
    return this.list(studentId);
  }

  async leave(studentId: string, cohortId: string) {
    const outcome = await runBusiness(this.deps, (unit) =>
      leaveWaitlist(unit, { cohortId, studentId }),
    );
    if (outcome !== 'LEFT') throw rejected(outcome);
    return this.list(studentId);
  }
}
