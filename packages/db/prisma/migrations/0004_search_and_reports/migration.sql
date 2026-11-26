-- Speed budgets on the full data set: student search under 300 ms, the report under 1 s.

CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Who has ever enrolled in a school, with what is searched, so a search touches one table
-- instead of joining hundreds of thousands of users to their enrollments.
CREATE TABLE school_students (
  school_id uuid NOT NULL REFERENCES schools (id),
  student_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  PRIMARY KEY (school_id, student_id)
);

INSERT INTO school_students (school_id, student_id, full_name, email)
SELECT DISTINCT c.school_id, u.id, u.full_name, u.email
  FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id JOIN users u ON u.id = e.student_id;

CREATE INDEX school_students_order_idx ON school_students (school_id, full_name, student_id);
CREATE INDEX school_students_search_idx ON school_students
  USING gin (school_id, lower(full_name) gin_trgm_ops, email gin_trgm_ops);

CREATE FUNCTION add_school_students() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO school_students (school_id, student_id, full_name, email)
  SELECT DISTINCT c.school_id, u.id, u.full_name, u.email
    FROM new_rows n JOIN cohorts c ON c.id = n.cohort_id JOIN users u ON u.id = n.student_id
   ORDER BY c.school_id, u.id
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER enrollments_school_students AFTER INSERT ON enrollments
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION add_school_students();

CREATE FUNCTION rename_school_students() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE school_students SET full_name = NEW.full_name, email = NEW.email
   WHERE student_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER users_school_students AFTER UPDATE OF full_name, email ON users
  FOR EACH ROW EXECUTE FUNCTION rename_school_students();
CREATE INDEX school_students_student_idx ON school_students (student_id);

-- Replaced by the school-scoped search index.
DROP INDEX users_name_trgm_idx;
DROP INDEX users_email_trgm_idx;

-- The report reads these without visiting the tables.
CREATE INDEX submissions_on_time_idx ON submissions (homework_id) INCLUDE (is_late);
CREATE INDEX enrollments_cohort_cover_idx ON enrollments (cohort_id) INCLUDE (id);
CREATE INDEX money_operations_report_idx ON money_operations (created_at)
  INCLUDE (kind, enrollment_id, amount_minor, currency) WHERE kind IN ('payment', 'refund');
CREATE INDEX certificates_report_idx ON certificates (enrollment_id) INCLUDE (issued_at);
