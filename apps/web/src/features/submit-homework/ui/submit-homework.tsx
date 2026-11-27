'use client';

import { useState } from 'react';
import { useHomeworkSubmit } from '@/shared/api';
import { Alert, Button, Input, TextArea } from '@/shared/ui';
import { ACCEPTED_FILES, checkAnswer } from '../model/check';

export const SubmitHomework = ({
  homeworkId,
  initialBody,
  late,
  attachedFile,
}: {
  homeworkId: string;
  initialBody: string;
  late: boolean;
  /** The name of the file already handed in. */
  attachedFile: string | null;
}) => {
  const [body, setBody] = useState(initialBody);
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [problems, setProblems] = useState<{ body?: string; file?: string }>({});
  const keepsFile = attachedFile !== null && !removeFile && !file;
  const submit = useHomeworkSubmit();
  const serverError = (path: string) =>
    submit.error?.fields?.find((field) => field.path === path)?.message;
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const found = checkAnswer({ body, file, keepsFile });
        setProblems(found);
        if (found.body ?? found.file) return;
        submit.mutate({
          id: homeworkId,
          data: {
            body,
            ...(file ? { file } : {}),
            ...(removeFile && !file ? { removeFile: 'true' as const } : {}),
          },
        });
      }}
    >
      {late ? (
        <Alert tone="info">The deadline has passed. The work will be marked as late.</Alert>
      ) : null}
      {submit.error && !submit.error.fields ? <Alert>{submit.error.message}</Alert> : null}
      {submit.isSuccess ? <Alert tone="success">Your work was handed in.</Alert> : null}
      <TextArea
        label="Your answer"
        value={body}
        error={problems.body ?? serverError('body')}
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      {attachedFile === null ? null : (
        <div className="text-sm">
          <p>
            Attached: <strong>{attachedFile}</strong>
            {file
              ? '. It will be replaced.'
              : removeFile
                ? '. It will be removed.'
                : '. It stays unless you choose another file.'}
          </p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={removeFile}
              disabled={file !== null}
              onChange={(event) => {
                setRemoveFile(event.target.checked);
              }}
            />
            Remove the attached file
          </label>
        </div>
      )}
      <Input
        label="File (optional)"
        type="file"
        accept={ACCEPTED_FILES}
        error={problems.file ?? serverError('file')}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
        }}
      />
      <Button type="submit" pending={submit.isPending}>
        Hand in
      </Button>
    </form>
  );
};
