-- Certificate work waiting for a worker, so nothing has to be inferred from a million rows.
ALTER TABLE enrollments ADD COLUMN certificate_due_at timestamptz(3);
CREATE INDEX enrollments_certificate_due_idx ON enrollments (certificate_due_at)
  WHERE certificate_due_at IS NOT NULL;

-- The school an email belongs to, so its manager can see and retry a failed send.
ALTER TABLE email_outbox ADD COLUMN school_id uuid REFERENCES schools (id);

CREATE INDEX job_failures_open_idx ON job_failures (queue, job_id) WHERE resolved_at IS NULL;
CREATE INDEX submission_reviews_mentor_idx ON submission_reviews (mentor_id);
