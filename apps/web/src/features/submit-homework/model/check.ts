import { FILE_TYPES, MAX_ANSWER_LENGTH } from '@school/shared/schemas/homework';

export const ACCEPTED_FILES = Object.keys(FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** The same rules the server applies, so mistakes show at the field before uploading. */
export const checkAnswer = (input: {
  readonly body: string;
  readonly file: { readonly name: string; readonly size: number } | null;
  /** An earlier file that stays attached. */
  readonly keepsFile?: boolean;
}): { readonly body?: string; readonly file?: string } => {
  const { body, file } = input;
  if (body.trim() === '' && !file && input.keepsFile !== true) {
    return { body: 'Write an answer or attach a file' };
  }
  if (body.length > MAX_ANSWER_LENGTH) return { body: 'The answer is too long' };
  if (!file) return {};
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!Object.hasOwn(FILE_TYPES, extension)) {
    return { file: 'Attach a PDF, ZIP, DOCX, PNG, JPEG or text file' };
  }
  return file.size > MAX_FILE_BYTES ? { file: 'The file is larger than 10 MB' } : {};
};
