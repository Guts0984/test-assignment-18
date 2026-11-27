import { Inject, Injectable } from '@nestjs/common';
import { submitHomework, type Upload } from '@school/db/repo/submission';
import { type Principal } from '../../common/auth/principal';
import { apiError } from '../../common/errors/api-error';
import { rejected } from '../../common/errors/rejections';
import { runBusiness } from '../../infra/business';
import { DEPS, type Deps } from '../../infra/deps';
import { safeFileName, sniffFile } from './file-type';
import { SUBMISSION_INCLUDE, toSubmissionView } from './view';

export type ReceivedFile = { readonly originalname: string; readonly buffer: Buffer };

const invalid = (path: string, message: string) =>
  apiError('VALIDATION_FAILED', 'Check the highlighted fields', [{ path, message }]);

const checkFile = (file: ReceivedFile): Upload => {
  // Multipart headers carry UTF-8 names that the parser reads as Latin-1.
  const fileName = safeFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
  const mimeType = sniffFile(fileName, file.buffer);
  if (!mimeType) throw invalid('file', 'Attach a PDF, ZIP, DOCX, PNG, JPEG or text file');
  return { fileName, mimeType, content: file.buffer };
};

@Injectable()
export class HomeworkService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async submit(
    studentId: string,
    homeworkId: string,
    answer: { readonly body: string; readonly removeFile: boolean },
    file: ReceivedFile | undefined,
  ) {
    const upload = file ? checkFile(file) : null;
    const outcome = await runBusiness(this.deps, (unit) =>
      submitHomework(unit, { ...answer, homeworkId, studentId, file: upload }),
    );
    if (outcome === 'EMPTY_SUBMISSION') {
      throw invalid('body', 'Write an answer or attach a file');
    }
    if (typeof outcome === 'string') throw rejected(outcome);
    this.deps.realtime.queueChanged([outcome.mentorId]);
    const stored = await this.deps.db.submission.findUniqueOrThrow({
      where: { id: outcome.submissionId },
      include: SUBMISSION_INCLUDE,
    });
    return toSubmissionView(stored);
  }

  /** The file of a submission, for its author, the cohort's mentor or the school's manager. */
  async file(user: Principal, submissionId: string) {
    const scope =
      user.role === 'student'
        ? { studentId: user.id }
        : user.role === 'mentor'
          ? { enrollment: { cohort: { mentorId: user.id } } }
          : { enrollment: { cohort: { schoolId: user.schoolId ?? '' } } };
    const submission = await this.deps.db.submission.findFirst({
      where: { id: submissionId, ...scope },
      include: { file: true },
    });
    if (!submission?.file) throw rejected('NOT_FOUND');
    return submission.file;
  }
}
