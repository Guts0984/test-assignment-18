import { Inject, Injectable } from '@nestjs/common';
import { cancelEnrollment } from '@school/db/repo/cancel';
import { changeCapacity } from '@school/db/repo/capacity';
import { transferEnrollment } from '@school/db/repo/transfer';
import { type Currency } from '@school/shared/money/money';
import { type EnrollmentStatus } from '@school/shared/status/enrollment';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { rejected } from '../../common/errors/rejections';
import { runBusiness } from '../../infra/business';
import { DEPS, type Deps } from '../../infra/deps';
import { isoDate } from '../catalog/domain';
import { cohortMoney, searchStudents } from './repo';

type Page = { readonly page: number; readonly pageSize: number };

const window = ({ page, pageSize }: Page) => ({ limit: pageSize, offset: (page - 1) * pageSize });

@Injectable()
export class RosterService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async students(schoolId: string, cohortId: string, query: Page & { q?: string | undefined }) {
    await this.requireCohort(schoolId, cohortId);
    const match = { contains: query.q ?? '', mode: 'insensitive' as const };
    const where = {
      cohortId,
      ...(query.q ? { student: { OR: [{ fullName: match }, { email: match }] } } : {}),
    };
    const { limit, offset } = window(query);
    const [rows, total] = await Promise.all([
      this.deps.db.enrollment.findMany({
        where,
        include: { student: true },
        orderBy: [{ student: { fullName: 'asc' } }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.deps.db.enrollment.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        enrollmentId: row.id,
        studentId: row.studentId,
        fullName: row.student.fullName,
        email: row.student.email,
        status: row.status as EnrollmentStatus,
        priceMinor: row.priceMinor,
        paidMinor: Number(row.balanceMinor),
        currency: row.currency as Currency,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async waitlist(schoolId: string, cohortId: string) {
    await this.requireCohort(schoolId, cohortId);
    const rows = await this.deps.db.$queryRaw<
      {
        student_id: string;
        full_name: string;
        email: string;
        status: 'waiting' | 'offered' | 'converted' | 'offer_expired' | 'left';
        joined_at: Date;
        offered_at: Date | null;
      }[]
    >`
      SELECT w.student_id, u.full_name, u.email, w.status, w.joined_at, w.offered_at
        FROM waitlist_entries w JOIN users u ON u.id = w.student_id
       WHERE w.cohort_id = ${cohortId}::uuid
       ORDER BY w.position`;
    return {
      items: rows.map((row) => ({
        studentId: row.student_id,
        fullName: row.full_name,
        email: row.email,
        status: row.status,
        joinedAt: row.joined_at.toISOString(),
        offeredAt: row.offered_at?.toISOString() ?? null,
      })),
    };
  }

  async payments(schoolId: string, cohortId: string, query: Page) {
    await this.requireCohort(schoolId, cohortId);
    const rows = await cohortMoney(this.deps.db, cohortId, window(query));
    return {
      items: rows.map((row) => ({
        id: row.id,
        enrollmentId: row.enrollment_id,
        studentName: row.full_name,
        kind: row.kind,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        at: row.at.toISOString(),
      })),
      total: rows[0]?.total ?? 0,
      ...query,
    };
  }

  async search(schoolId: string, query: Page & { q: string }) {
    const students = await searchStudents(this.deps.db, {
      schoolId,
      q: query.q,
      ...window(query),
    });
    const enrollments = await this.deps.db.enrollment.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, cohort: { schoolId } },
      include: { cohort: { include: { course: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return {
      items: students.map((student) => ({
        studentId: student.id,
        fullName: student.full_name,
        email: student.email,
        enrollments: enrollments
          .filter((row) => row.studentId === student.id)
          .map((row) => ({
            enrollmentId: row.id,
            cohortId: row.cohortId,
            courseTitle: row.cohort.course.title,
            startDate: isoDate(row.cohort.startDate),
            status: row.status as EnrollmentStatus,
          })),
      })),
      total: students[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async capacity(user: Principal, cohortId: string, capacity: number) {
    await this.requireCohort(schoolOf(user), cohortId);
    const outcome = await runBusiness(this.deps, (unit) =>
      changeCapacity(unit, { cohortId, capacity, actor: { kind: 'manager', id: user.id } }),
    );
    if (outcome !== 'CHANGED') throw rejected(outcome);
  }

  async transfer(user: Principal, enrollmentId: string, targetCohortId: string) {
    const schoolId = schoolOf(user);
    await this.requireEnrollment(schoolId, enrollmentId);
    await this.requireCohort(schoolId, targetCohortId);
    const outcome = await runBusiness(this.deps, (unit) =>
      transferEnrollment(unit, {
        enrollmentId,
        targetCohortId,
        actor: { kind: 'manager', id: user.id },
      }),
    );
    if (typeof outcome === 'string') throw rejected(outcome);
    return outcome;
  }

  async exclude(user: Principal, enrollmentId: string, policy: 'rule' | 'full') {
    await this.requireEnrollment(schoolOf(user), enrollmentId);
    const outcome = await runBusiness(this.deps, (unit) =>
      cancelEnrollment(unit, {
        enrollmentId,
        actor: { kind: 'manager', id: user.id },
        policy,
      }),
    );
    if (outcome !== 'CANCELLED') throw rejected(outcome);
  }

  private async requireCohort(schoolId: string, id: string): Promise<void> {
    if ((await this.deps.db.cohort.count({ where: { id, schoolId } })) === 0) {
      throw rejected('NOT_FOUND');
    }
  }

  private async requireEnrollment(schoolId: string, id: string): Promise<void> {
    const count = await this.deps.db.enrollment.count({ where: { id, cohort: { schoolId } } });
    if (count === 0) throw rejected('NOT_FOUND');
  }
}
