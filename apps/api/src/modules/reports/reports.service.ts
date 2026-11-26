import { Inject, Injectable } from '@nestjs/common';
import { type Report, type ReportQuery } from '@school/shared/schemas/report';
import { DEPS, type Deps } from '../../infra/deps';
import * as repo from './repo';

@Injectable()
export class ReportsService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async report(schoolId: string, query: ReportQuery): Promise<Report> {
    const filter = { ...query, schoolId };
    const { db } = this.deps;
    const [courses, money, waitlist, homework, certificates] = await Promise.all([
      repo.occupancy(db, filter),
      repo.money(db, filter),
      repo.waitlistConversion(db, filter),
      repo.homeworkOnTime(db, filter),
      repo.certificatesIssued(db, filter),
    ]);
    const sum = (pick: (row: (typeof courses)[number]) => number) =>
      courses.reduce((total, row) => total + pick(row), 0);
    return {
      occupancy: {
        cohorts: sum((row) => row.cohorts),
        seatsTaken: sum((row) => row.taken),
        capacity: sum((row) => row.capacity),
        byCourse: courses.map((row) => ({
          courseId: row.course_id,
          title: row.title,
          cohorts: row.cohorts,
          seatsTaken: row.taken,
          capacity: row.capacity,
        })),
      },
      money: money.map((row) => ({
        currency: row.currency,
        paidMinor: Number(row.paid),
        refundedMinor: Number(row.refunded),
      })),
      waitlist: waitlist[0] ?? { part: 0, total: 0 },
      homeworkOnTime: homework[0] ?? { part: 0, total: 0 },
      certificatesIssued: certificates[0]?.total ?? 0,
    };
  }
}
