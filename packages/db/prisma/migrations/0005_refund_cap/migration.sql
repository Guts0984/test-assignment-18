-- A transfer carries over how much of the money the student could still have had back, so moving
-- to a later cohort cannot restore a refund that the old cohort's schedule had already ended.
ALTER TABLE enrollments ADD COLUMN refund_cap_percent smallint NOT NULL DEFAULT 100;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_refund_cap_check CHECK (refund_cap_percent IN (0, 50, 100));
