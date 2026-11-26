-- Guarantees that must hold whatever the application does: value checks, uniqueness under
-- concurrency, append-only history, balanced ledger entries, and counters derived from history.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Value checks ------------------------------------------------------------------------------

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'mentor', 'manager', 'admin')),
  ADD CONSTRAINT users_school_check CHECK ((role = 'student') = (school_id IS NULL)),
  ADD CONSTRAINT users_email_lower_check CHECK (email = lower(email));

ALTER TABLE cohorts
  ADD CONSTRAINT cohorts_seats_check CHECK (seats_taken >= 0 AND seats_taken <= capacity),
  ADD CONSTRAINT cohorts_price_check CHECK (price_minor >= 0),
  ADD CONSTRAINT cohorts_currency_check CHECK (currency IN ('UAH', 'EUR', 'USD')),
  ADD CONSTRAINT cohorts_minutes_check CHECK (lesson_minutes BETWEEN 15 AND 480);

ALTER TABLE lessons
  ADD CONSTRAINT lessons_range_check CHECK (ends_at > starts_at),
  ADD CONSTRAINT lessons_time_check CHECK (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check CHECK (status IN
    ('held', 'offered', 'paid', 'transferred', 'cancelled', 'refunded', 'expired', 'completed')),
  ADD CONSTRAINT enrollments_hold_check
    CHECK (status NOT IN ('held', 'offered') OR hold_expires_at IS NOT NULL),
  ADD CONSTRAINT enrollments_price_check
    CHECK (price_minor >= 0 AND list_price_minor >= price_minor),
  ADD CONSTRAINT enrollments_currency_check CHECK (currency IN ('UAH', 'EUR', 'USD')),
  -- Refunds and transfers can never take out more than came in.
  ADD CONSTRAINT enrollments_balance_check CHECK (balance_minor >= 0);

ALTER TABLE seat_journal
  ADD CONSTRAINT seat_journal_reason_check CHECK (reason IN
    ('hold', 'payment', 'expiry', 'offer', 'transfer_in', 'transfer_out', 'cancel', 'exclude',
     'capacity')),
  ADD CONSTRAINT seat_journal_actor_check
    CHECK (actor_kind IN ('student', 'mentor', 'manager', 'system')),
  ADD CONSTRAINT seat_journal_delta_check CHECK (seats_delta BETWEEN -1 AND 1),
  ADD CONSTRAINT seat_journal_shape_check CHECK (
    (reason = 'capacity' AND enrollment_id IS NULL AND seats_delta = 0 AND capacity_delta <> 0)
    OR (reason <> 'capacity' AND enrollment_id IS NOT NULL AND capacity_delta = 0)),
  ADD CONSTRAINT seat_journal_cohort_fk FOREIGN KEY (cohort_id) REFERENCES cohorts (id),
  ADD CONSTRAINT seat_journal_enrollment_fk
    FOREIGN KEY (enrollment_id) REFERENCES enrollments (id);

ALTER TABLE money_operations
  ADD CONSTRAINT money_operations_kind_check
    CHECK (kind IN ('payment', 'refund', 'transfer_out', 'transfer_in')),
  ADD CONSTRAINT money_operations_amount_check CHECK (amount_minor > 0),
  ADD CONSTRAINT money_operations_source_check CHECK (
    (kind = 'payment') = (provider_payment_id IS NOT NULL)
    AND (kind = 'refund') = (refund_request_id IS NOT NULL));

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_account_check
    CHECK (account IN ('gateway', 'enrollment', 'transfer')),
  ADD CONSTRAINT ledger_entries_owner_check
    CHECK ((account = 'enrollment') = (enrollment_id IS NOT NULL)),
  ADD CONSTRAINT ledger_entries_side_check
    CHECK (debit_minor >= 0 AND credit_minor >= 0 AND (debit_minor = 0) <> (credit_minor = 0));

ALTER TABLE refund_requests
  ADD CONSTRAINT refund_requests_amount_check CHECK (amount_minor > 0),
  ADD CONSTRAINT refund_requests_status_check CHECK (status IN ('pending', 'succeeded')),
  ADD CONSTRAINT refund_requests_reason_check CHECK (reason IN
    ('cancel', 'exclude', 'transfer', 'late_payment', 'duplicate_payment', 'amount_mismatch'));

ALTER TABLE promo_codes
  ADD CONSTRAINT promo_codes_discount_check CHECK (
    (discount_kind = 'percent' AND percent BETWEEN 1 AND 100
      AND amount_minor IS NULL AND currency IS NULL)
    OR (discount_kind = 'fixed' AND percent IS NULL AND amount_minor > 0
      AND currency IN ('UAH', 'EUR', 'USD'))),
  ADD CONSTRAINT promo_codes_window_check CHECK (valid_until > valid_from),
  ADD CONSTRAINT promo_codes_code_check CHECK (code = upper(code)),
  -- The limit itself: reservations and uses together never exceed it.
  ADD CONSTRAINT promo_codes_limit_check CHECK (
    max_uses >= 0 AND used_count >= 0 AND reserved_count >= 0
    AND used_count + reserved_count <= max_uses),
  ADD CONSTRAINT promo_codes_course_fk FOREIGN KEY (course_id) REFERENCES courses (id);

ALTER TABLE promo_redemptions
  ADD CONSTRAINT promo_redemptions_state_check CHECK (state IN ('reserved', 'used', 'released')),
  ADD CONSTRAINT promo_redemptions_discount_check CHECK (discount_minor >= 0);

ALTER TABLE waitlist_entries
  ADD CONSTRAINT waitlist_status_check
    CHECK (status IN ('waiting', 'offered', 'converted', 'offer_expired', 'left')),
  ADD CONSTRAINT waitlist_offer_check
    CHECK (status <> 'offered' OR (enrollment_id IS NOT NULL AND offered_at IS NOT NULL)),
  ADD CONSTRAINT waitlist_cohort_fk FOREIGN KEY (cohort_id) REFERENCES cohorts (id),
  ADD CONSTRAINT waitlist_student_fk FOREIGN KEY (student_id) REFERENCES users (id),
  ADD CONSTRAINT waitlist_enrollment_fk
    FOREIGN KEY (enrollment_id) REFERENCES enrollments (id);

ALTER TABLE submissions
  ADD CONSTRAINT submissions_status_check
    CHECK (status IN ('submitted', 'in_review', 'accepted', 'returned')),
  -- A reviewer exists exactly while the work is in review.
  ADD CONSTRAINT submissions_reviewer_check
    CHECK ((status = 'in_review') = (reviewer_id IS NOT NULL)),
  ADD CONSTRAINT submissions_cohort_fk FOREIGN KEY (cohort_id) REFERENCES cohorts (id),
  ADD CONSTRAINT submissions_student_fk FOREIGN KEY (student_id) REFERENCES users (id),
  ADD CONSTRAINT submissions_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES users (id);

ALTER TABLE submission_files
  ADD CONSTRAINT submission_files_size_check
    CHECK (size_bytes > 0 AND size_bytes = octet_length(content));

ALTER TABLE submission_reviews
  ADD CONSTRAINT submission_reviews_verdict_check CHECK (verdict IN ('accepted', 'returned')),
  ADD CONSTRAINT submission_reviews_score_check CHECK (score BETWEEN 0 AND 100),
  ADD CONSTRAINT submission_reviews_mentor_fk FOREIGN KEY (mentor_id) REFERENCES users (id);

ALTER TABLE certificates
  ADD CONSTRAINT certificates_number_check CHECK (number > 0),
  ADD CONSTRAINT certificates_course_fk FOREIGN KEY (course_id) REFERENCES courses (id),
  ADD CONSTRAINT certificates_student_fk FOREIGN KEY (student_id) REFERENCES users (id);

ALTER TABLE scheduled_notifications
  ADD CONSTRAINT scheduled_kind_check
    CHECK (kind IN ('lesson_24h', 'lesson_1h', 'deadline_24h')),
  ADD CONSTRAINT scheduled_status_check CHECK (status IN ('pending', 'done', 'cancelled')),
  ADD CONSTRAINT scheduled_lesson_fk
    FOREIGN KEY (lesson_id) REFERENCES lessons (id) ON DELETE CASCADE;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_status_check CHECK (status IN ('pending', 'sending', 'sent'));

ALTER TABLE test_clock ADD CONSTRAINT test_clock_single_check CHECK (id = 1);

-- Uniqueness under concurrency ---------------------------------------------------------------

CREATE UNIQUE INDEX enrollments_one_active_idx ON enrollments (student_id, cohort_id)
  WHERE status IN ('held', 'offered', 'paid', 'completed');

CREATE UNIQUE INDEX waitlist_one_active_idx ON waitlist_entries (student_id, cohort_id)
  WHERE status IN ('waiting', 'offered');

-- One refund per enrollment. Returns of unwanted payments are unique per payment instead.
CREATE UNIQUE INDEX refund_requests_one_per_enrollment_idx ON refund_requests (enrollment_id)
  WHERE source_payment_operation_id IS NULL;

-- Query paths --------------------------------------------------------------------------------

CREATE INDEX courses_title_trgm_idx ON courses USING gin (lower(title) gin_trgm_ops);
CREATE INDEX users_name_trgm_idx ON users USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX users_email_trgm_idx ON users USING gin (email gin_trgm_ops);
CREATE INDEX enrollments_expiry_idx ON enrollments (hold_expires_at)
  WHERE status IN ('held', 'offered');
CREATE INDEX waitlist_fifo_idx ON waitlist_entries (cohort_id, position)
  WHERE status = 'waiting';
CREATE INDEX submissions_queue_idx ON submissions (cohort_id, submitted_at, id)
  WHERE status = 'submitted';
CREATE INDEX submissions_reviewer_idx ON submissions (reviewer_id) WHERE status = 'in_review';
CREATE INDEX scheduled_due_idx ON scheduled_notifications (due_at) WHERE status = 'pending';
CREATE INDEX email_pending_idx ON email_outbox (created_at) WHERE status <> 'sent';
CREATE INDEX refund_requests_pending_idx ON refund_requests (created_at) WHERE status = 'pending';
CREATE INDEX payment_notifications_pending_idx ON payment_notifications (received_at)
  WHERE processed_at IS NULL;
CREATE INDEX cohorts_open_idx ON cohorts (ends_at) WHERE completed_at IS NULL;

-- Append-only history ------------------------------------------------------------------------

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER seat_journal_append_only BEFORE UPDATE OR DELETE ON seat_journal
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER seat_journal_no_truncate BEFORE TRUNCATE ON seat_journal
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER money_operations_append_only BEFORE UPDATE OR DELETE ON money_operations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER money_operations_no_truncate BEFORE TRUNCATE ON money_operations
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER certificates_append_only BEFORE UPDATE OR DELETE ON certificates
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- A refund request may only move from pending to succeeded.
CREATE FUNCTION guard_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund requests cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'pending'
     OR (to_jsonb(NEW) - 'status' - 'completed_at') <> (to_jsonb(OLD) - 'status' - 'completed_at')
  THEN
    RAISE EXCEPTION 'a refund request is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_requests_guard BEFORE UPDATE OR DELETE ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION guard_refund_request();

-- Pending refunds can never add up to more than the enrollment holds.
CREATE FUNCTION check_refund_cover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance bigint;
  promised bigint;
BEGIN
  SELECT balance_minor INTO balance FROM enrollments
    WHERE id = NEW.enrollment_id FOR NO KEY UPDATE;
  SELECT coalesce(sum(amount_minor), 0) INTO promised FROM refund_requests
    WHERE enrollment_id = NEW.enrollment_id AND status = 'pending';
  IF promised > balance THEN
    RAISE EXCEPTION 'refunds of % exceed the balance of %', promised, balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER refund_requests_cover AFTER INSERT ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION check_refund_cover();

-- Seat counters follow the journal -----------------------------------------------------------

CREATE FUNCTION apply_seat_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cohorts c
     SET seats_taken = c.seats_taken + d.seats, capacity = c.capacity + d.capacity
    FROM (SELECT cohort_id, sum(seats_delta) AS seats, sum(capacity_delta) AS capacity
            FROM new_rows GROUP BY cohort_id) d
   WHERE c.id = d.cohort_id;
  RETURN NULL;
END $$;
CREATE TRIGGER seat_journal_apply AFTER INSERT ON seat_journal
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION apply_seat_journal();

-- The counters can be written only from inside the journal trigger.
CREATE FUNCTION guard_cohort_counters() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.seats_taken <> 0 OR NEW.capacity <> 0 THEN
      RAISE EXCEPTION 'seat counters start at zero and change through the journal'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF (NEW.seats_taken, NEW.capacity) IS DISTINCT FROM (OLD.seats_taken, OLD.capacity)
        AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'seat counters change only through the journal'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cohorts_counter_guard BEFORE INSERT OR UPDATE ON cohorts
  FOR EACH ROW EXECUTE FUNCTION guard_cohort_counters();

-- Every enrollment's journal must agree with its status when the transaction commits, so a
-- change of occupancy without a journal row cannot be committed.
CREATE FUNCTION check_enrollment_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE TG_TABLE_NAME WHEN 'enrollments' THEN (to_jsonb(NEW) ->> 'id')::uuid
                 ELSE (to_jsonb(NEW) ->> 'enrollment_id')::uuid END;
  expected int;
  journaled int;
  cohort uuid;
BEGIN
  IF target IS NULL THEN RETURN NULL; END IF;
  SELECT CASE WHEN status IN ('held', 'offered', 'paid', 'completed') THEN 1 ELSE 0 END, cohort_id
    INTO expected, cohort FROM enrollments WHERE id = target;
  SELECT coalesce(sum(seats_delta), 0) INTO journaled FROM seat_journal
    WHERE enrollment_id = target;
  IF journaled <> expected THEN
    RAISE EXCEPTION 'enrollment % occupies % seats but its journal says %',
      target, expected, journaled USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM seat_journal WHERE enrollment_id = target AND cohort_id <> cohort) THEN
    RAISE EXCEPTION 'enrollment % is journaled against another cohort', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER enrollments_occupancy AFTER INSERT OR UPDATE OF status ON enrollments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_enrollment_occupancy();
CREATE CONSTRAINT TRIGGER seat_journal_occupancy AFTER INSERT ON seat_journal
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_enrollment_occupancy();

-- Money: double entry, derived balances ------------------------------------------------------

CREATE FUNCTION check_money_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_currency text;
  request refund_requests%ROWTYPE;
BEGIN
  SELECT currency INTO expected_currency FROM enrollments WHERE id = NEW.enrollment_id;
  IF NEW.currency IS DISTINCT FROM expected_currency THEN
    RAISE EXCEPTION 'operation currency % differs from the enrollment', NEW.currency
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'refund' THEN
    SELECT * INTO request FROM refund_requests WHERE id = NEW.refund_request_id;
    IF request.enrollment_id IS DISTINCT FROM NEW.enrollment_id
       OR request.amount_minor IS DISTINCT FROM NEW.amount_minor THEN
      RAISE EXCEPTION 'refund does not match its request' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER money_operations_check BEFORE INSERT ON money_operations
  FOR EACH ROW EXECUTE FUNCTION check_money_operation();

-- Each operation writes its own balanced pair of ledger entries.
CREATE FUNCTION post_ledger_entries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  other text := CASE WHEN NEW.kind IN ('payment', 'refund') THEN 'gateway' ELSE 'transfer' END;
  incoming boolean := NEW.kind IN ('payment', 'transfer_in');
BEGIN
  INSERT INTO ledger_entries (operation_id, account, enrollment_id, debit_minor, credit_minor)
  VALUES
    (NEW.id, 'enrollment', NEW.enrollment_id,
     CASE WHEN incoming THEN 0 ELSE NEW.amount_minor END,
     CASE WHEN incoming THEN NEW.amount_minor ELSE 0 END),
    (NEW.id, other, NULL,
     CASE WHEN incoming THEN NEW.amount_minor ELSE 0 END,
     CASE WHEN incoming THEN 0 ELSE NEW.amount_minor END);
  RETURN NULL;
END $$;
CREATE TRIGGER money_operations_post AFTER INSERT ON money_operations
  FOR EACH ROW EXECUTE FUNCTION post_ledger_entries();

CREATE FUNCTION apply_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE enrollments e SET balance_minor = e.balance_minor + d.delta
    FROM (SELECT enrollment_id, sum(credit_minor - debit_minor) AS delta FROM new_rows
           WHERE account = 'enrollment' GROUP BY enrollment_id) d
   WHERE e.id = d.enrollment_id;
  RETURN NULL;
END $$;
CREATE TRIGGER ledger_entries_balance AFTER INSERT ON ledger_entries
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION apply_ledger_balance();

CREATE FUNCTION guard_enrollment_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance_minor <> 0 THEN
      RAISE EXCEPTION 'a balance starts at zero' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF (NEW.cohort_id, NEW.student_id, NEW.currency)
        IS DISTINCT FROM (OLD.cohort_id, OLD.student_id, OLD.currency) THEN
    RAISE EXCEPTION 'cohort, student and currency of an enrollment never change'
      USING ERRCODE = 'restrict_violation';
  ELSIF NEW.balance_minor IS DISTINCT FROM OLD.balance_minor AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'a balance changes only through the ledger'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollments_balance_guard BEFORE INSERT OR UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION guard_enrollment_balance();

-- At commit, the entries of an operation balance and equal its amount.
CREATE FUNCTION check_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  debits bigint;
  credits bigint;
  amount bigint;
BEGIN
  SELECT coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) INTO debits, credits
    FROM ledger_entries WHERE operation_id = NEW.operation_id;
  SELECT amount_minor INTO amount FROM money_operations WHERE id = NEW.operation_id;
  IF debits <> credits OR debits <> amount THEN
    RAISE EXCEPTION 'unbalanced ledger for operation %: debit % credit % amount %',
      NEW.operation_id, debits, credits, amount USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();

-- Promo counters follow redemptions -----------------------------------------------------------

CREATE FUNCTION apply_promo_redemption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE promo_codes SET
      used_count = used_count - (OLD.state = 'used')::int,
      reserved_count = reserved_count - (OLD.state = 'reserved')::int
    WHERE id = OLD.promo_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    UPDATE promo_codes SET
      used_count = used_count + (NEW.state = 'used')::int,
      reserved_count = reserved_count + (NEW.state = 'reserved')::int
    WHERE id = NEW.promo_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER promo_redemptions_apply AFTER INSERT OR UPDATE OR DELETE ON promo_redemptions
  FOR EACH ROW EXECUTE FUNCTION apply_promo_redemption();

CREATE FUNCTION guard_promo_counters() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.used_count <> 0 OR NEW.reserved_count <> 0 THEN
      RAISE EXCEPTION 'promo counters start at zero' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF (NEW.used_count, NEW.reserved_count) IS DISTINCT FROM
        (OLD.used_count, OLD.reserved_count) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'promo counters change only through redemptions'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promo_codes_counter_guard BEFORE INSERT OR UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION guard_promo_counters();

-- Certificate numbers: consecutive per course ------------------------------------------------

-- Runs only for rows really inserted. The counter row lock serializes issuers, and a rolled
-- back transaction leaves the counter untouched, so there are no gaps.
CREATE FUNCTION advance_certificate_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO certificate_counters (course_id, last_number) VALUES (NEW.course_id, 0)
    ON CONFLICT (course_id) DO NOTHING;
  UPDATE certificate_counters SET last_number = NEW.number
    WHERE course_id = NEW.course_id AND last_number = NEW.number - 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'certificate number % is not the next one of course %',
      NEW.number, NEW.course_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER certificates_consecutive AFTER INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION advance_certificate_counter();
