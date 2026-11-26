import { Inject, Injectable } from '@nestjs/common';
import { type Prisma } from '@school/db/client';
import { rejected } from '../../common/errors/rejections';
import { DEPS, type Deps } from '../../infra/deps';
import { renderCertificate } from './pdf';

const INCLUDE = {
  enrollment: {
    include: { student: true, cohort: { include: { course: { include: { school: true } } } } },
  },
} satisfies Prisma.CertificateInclude;

@Injectable()
export class CertificatesService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(studentId: string) {
    const rows = await this.deps.db.certificate.findMany({
      where: { studentId },
      include: INCLUDE,
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        courseTitle: row.enrollment.cohort.course.title,
        number: row.number,
        issuedAt: row.issuedAt.toISOString(),
        verifyUrl: this.verifyUrl(row.verifyToken),
      })),
    };
  }

  async pdf(studentId: string, id: string) {
    const row = await this.deps.db.certificate.findFirst({
      where: { id, studentId },
      include: INCLUDE,
    });
    if (!row) throw rejected('NOT_FOUND');
    const { course } = row.enrollment.cohort;
    const content = await renderCertificate({
      studentName: row.enrollment.student.fullName,
      courseTitle: course.title,
      schoolName: course.school.name,
      number: row.number,
      issuedOn: row.issuedAt.toISOString().slice(0, 10),
      verifyUrl: this.verifyUrl(row.verifyToken),
    });
    return { content, number: row.number };
  }

  /** Public confirmation. Only the unguessable token finds a certificate. */
  async verify(token: string) {
    const row = await this.deps.db.certificate.findUnique({
      where: { verifyToken: token },
      include: INCLUDE,
    });
    if (!row) throw rejected('NOT_FOUND');
    const { course } = row.enrollment.cohort;
    return {
      studentName: row.enrollment.student.fullName,
      courseTitle: course.title,
      schoolName: course.school.name,
      number: row.number,
      issuedAt: row.issuedAt.toISOString(),
    };
  }

  private verifyUrl(token: string): string {
    return `${this.deps.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/verify/${token}`;
  }
}
