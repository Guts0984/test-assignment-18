-- The report reaches money and certificates by cohort, without walking every enrollment of a
-- school. An enrollment never changes its cohort, so the copy cannot go stale.

ALTER TABLE money_operations ADD COLUMN cohort_id uuid;
ALTER TABLE certificates ADD COLUMN cohort_id uuid;

ALTER TABLE money_operations DISABLE TRIGGER money_operations_append_only;
UPDATE money_operations o SET cohort_id = e.cohort_id
  FROM enrollments e WHERE e.id = o.enrollment_id;
ALTER TABLE money_operations ENABLE TRIGGER money_operations_append_only;

ALTER TABLE certificates DISABLE TRIGGER certificates_append_only;
UPDATE certificates x SET cohort_id = e.cohort_id
  FROM enrollments e WHERE e.id = x.enrollment_id;
ALTER TABLE certificates ENABLE TRIGGER certificates_append_only;

ALTER TABLE money_operations ALTER COLUMN cohort_id SET NOT NULL;
ALTER TABLE certificates ALTER COLUMN cohort_id SET NOT NULL;

CREATE FUNCTION copy_enrollment_cohort() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT cohort_id INTO NEW.cohort_id FROM enrollments WHERE id = NEW.enrollment_id;
  RETURN NEW;
END $$;
CREATE TRIGGER money_operations_cohort BEFORE INSERT ON money_operations
  FOR EACH ROW EXECUTE FUNCTION copy_enrollment_cohort();
CREATE TRIGGER certificates_cohort BEFORE INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION copy_enrollment_cohort();

CREATE INDEX money_operations_cohort_report_idx ON money_operations (cohort_id, created_at)
  INCLUDE (kind, amount_minor, currency) WHERE kind IN ('payment', 'refund');
CREATE INDEX certificates_cohort_report_idx ON certificates (cohort_id, issued_at);
DROP INDEX money_operations_report_idx;
DROP INDEX certificates_report_idx;

-- Work held by a mentor for a student who has since left goes back, freeing the mentor's limit.
UPDATE submissions s SET status = 'submitted', reviewer_id = NULL, claimed_at = NULL
  FROM enrollments e
 WHERE e.id = s.enrollment_id AND s.status = 'in_review'
   AND e.status NOT IN ('paid', 'completed');
