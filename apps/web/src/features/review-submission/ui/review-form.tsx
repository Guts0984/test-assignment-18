'use client';

import { useState } from 'react';
import { useMentorRelease, useMentorReview } from '@/shared/api';
import { Alert, Button, Input, TextArea } from '@/shared/ui';

export const ReviewForm = ({
  submissionId,
  onDone,
}: {
  submissionId: string;
  onDone: () => void;
}) => {
  const [comment, setComment] = useState('');
  const [score, setScore] = useState('');
  const review = useMentorReview({ mutation: { onSuccess: onDone } });
  const release = useMentorRelease({ mutation: { onSuccess: onDone } });
  const errorAt = (path: string) =>
    review.error?.fields?.find((field) => field.path === path)?.message;
  const decide = (verdict: 'accepted' | 'returned') => {
    review.mutate({
      id: submissionId,
      data: { verdict, comment, score: score.trim() === '' ? null : Number(score) },
    });
  };
  const failure = release.error ?? (review.error?.fields ? null : review.error);
  return (
    <div className="flex flex-col gap-2">
      {failure ? <Alert>{failure.message}</Alert> : null}
      <TextArea
        label="Comment for the student"
        value={comment}
        error={errorAt('comment')}
        onChange={(event) => {
          setComment(event.target.value);
        }}
      />
      <Input
        label="Score, 0 to 100 (optional)"
        inputMode="numeric"
        value={score}
        error={errorAt('score')}
        onChange={(event) => {
          setScore(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          pending={review.isPending}
          onClick={() => {
            decide('accepted');
          }}
        >
          Accept
        </Button>
        <Button
          variant="danger"
          pending={review.isPending}
          onClick={() => {
            decide('returned');
          }}
        >
          Return for rework
        </Button>
        <Button
          variant="secondary"
          pending={release.isPending}
          onClick={() => {
            release.mutate({ id: submissionId });
          }}
        >
          Release
        </Button>
      </div>
    </div>
  );
};
