-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "school_id" UUID,
    "time_zone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_configs" (
    "school_id" UUID NOT NULL,
    "base_url" TEXT NOT NULL,
    "key_ciphertext" TEXT NOT NULL,
    "key_last4" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gateway_configs_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "time_zone" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "lesson_minutes" INTEGER NOT NULL DEFAULT 90,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "local_date" DATE NOT NULL,
    "local_time" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homeworks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homeworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "list_price_minor" INTEGER NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(3),
    "transfer_from_id" UUID,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_journal" (
    "id" BIGSERIAL NOT NULL,
    "cohort_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "seats_delta" INTEGER NOT NULL,
    "capacity_delta" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seat_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enrollment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "refund_request_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "money_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "operation_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "enrollment_id" UUID,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enrollment_id" UUID NOT NULL,
    "source_payment_operation_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enrollment_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "provider_session_id" TEXT NOT NULL,
    "pay_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "outcome" TEXT,

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "course_id" UUID,
    "discount_kind" TEXT NOT NULL,
    "percent" INTEGER,
    "amount_minor" INTEGER,
    "currency" TEXT,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "enrollment_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "position" BIGSERIAL NOT NULL,
    "status" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "offered_at" TIMESTAMPTZ(3),
    "enrollment_id" UUID,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "homework_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "is_late" BOOLEAN NOT NULL,
    "reviewer_id" UUID,
    "claimed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "submission_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("submission_id")
);

-- CreateTable
CREATE TABLE "submission_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_counters" (
    "course_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "certificate_counters_pkey" PRIMARY KEY ("course_id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "verify_token" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "lesson_id" UUID NOT NULL,
    "lesson_version" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "scheduled_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dedupe_key" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lease_until" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_failures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "school_id" UUID,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "failed_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_clock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "offset_ms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "test_clock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_runs" (
    "id" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seed_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_name_key" ON "schools"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_school_id_role_idx" ON "users"("school_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "courses_school_id_idx" ON "courses"("school_id");

-- CreateIndex
CREATE INDEX "courses_direction_idx" ON "courses"("direction");

-- CreateIndex
CREATE INDEX "cohorts_course_id_idx" ON "cohorts"("course_id");

-- CreateIndex
CREATE INDEX "cohorts_school_id_start_date_idx" ON "cohorts"("school_id", "start_date");

-- CreateIndex
CREATE INDEX "cohorts_mentor_id_idx" ON "cohorts"("mentor_id");

-- CreateIndex
CREATE INDEX "cohorts_start_date_id_idx" ON "cohorts"("start_date", "id");

-- CreateIndex
CREATE INDEX "cohorts_price_minor_idx" ON "cohorts"("price_minor");

-- CreateIndex
CREATE INDEX "lessons_cohort_id_starts_at_idx" ON "lessons"("cohort_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_cohort_id_seq_key" ON "lessons"("cohort_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "homeworks_lesson_id_key" ON "homeworks"("lesson_id");

-- CreateIndex
CREATE INDEX "homeworks_cohort_id_idx" ON "homeworks"("cohort_id");

-- CreateIndex
CREATE INDEX "homeworks_deadline_at_idx" ON "homeworks"("deadline_at");

-- CreateIndex
CREATE INDEX "enrollments_cohort_id_status_idx" ON "enrollments"("cohort_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_student_id_idx" ON "enrollments"("student_id");

-- CreateIndex
CREATE INDEX "enrollments_transfer_from_id_idx" ON "enrollments"("transfer_from_id");

-- CreateIndex
CREATE INDEX "seat_journal_cohort_id_idx" ON "seat_journal"("cohort_id");

-- CreateIndex
CREATE INDEX "seat_journal_enrollment_id_idx" ON "seat_journal"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_operations_provider_payment_id_key" ON "money_operations"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_operations_refund_request_id_key" ON "money_operations"("refund_request_id");

-- CreateIndex
CREATE INDEX "money_operations_enrollment_id_idx" ON "money_operations"("enrollment_id");

-- CreateIndex
CREATE INDEX "money_operations_kind_created_at_idx" ON "money_operations"("kind", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_operation_id_idx" ON "ledger_entries"("operation_id");

-- CreateIndex
CREATE INDEX "ledger_entries_enrollment_id_idx" ON "ledger_entries"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_requests_source_payment_operation_id_key" ON "refund_requests"("source_payment_operation_id");

-- CreateIndex
CREATE INDEX "refund_requests_enrollment_id_idx" ON "refund_requests"("enrollment_id");

-- CreateIndex
CREATE INDEX "refund_requests_created_at_idx" ON "refund_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_sessions_provider_session_id_key" ON "payment_sessions"("provider_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_sessions_enrollment_id_amount_minor_key" ON "payment_sessions"("enrollment_id", "amount_minor");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_school_id_provider_event_id_key" ON "payment_notifications"("school_id", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_school_id_code_key" ON "promo_codes"("school_id", "code");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_id_idx" ON "promo_redemptions"("promo_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_enrollment_id_key" ON "waitlist_entries"("enrollment_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_cohort_id_status_idx" ON "waitlist_entries"("cohort_id", "status");

-- CreateIndex
CREATE INDEX "waitlist_entries_student_id_idx" ON "waitlist_entries"("student_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_offered_at_idx" ON "waitlist_entries"("offered_at");

-- CreateIndex
CREATE INDEX "submissions_enrollment_id_idx" ON "submissions"("enrollment_id");

-- CreateIndex
CREATE INDEX "submissions_student_id_idx" ON "submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_homework_id_enrollment_id_key" ON "submissions"("homework_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "submission_reviews_submission_id_reviewed_at_idx" ON "submission_reviews"("submission_id", "reviewed_at");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_enrollment_id_key" ON "certificates"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verify_token_key" ON "certificates"("verify_token");

-- CreateIndex
CREATE INDEX "certificates_student_id_idx" ON "certificates"("student_id");

-- CreateIndex
CREATE INDEX "certificates_issued_at_idx" ON "certificates"("issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_course_id_number_key" ON "certificates"("course_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_notifications_lesson_id_kind_lesson_version_key" ON "scheduled_notifications"("lesson_id", "kind", "lesson_version");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "job_failures_school_id_failed_at_idx" ON "job_failures"("school_id", "failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_failures_queue_job_id_key" ON "job_failures"("queue", "job_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_configs" ADD CONSTRAINT "gateway_configs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homeworks" ADD CONSTRAINT "homeworks_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_transfer_from_id_fkey" FOREIGN KEY ("transfer_from_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_refund_request_id_fkey" FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "money_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_source_payment_operation_id_fkey" FOREIGN KEY ("source_payment_operation_id") REFERENCES "money_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_homework_id_fkey" FOREIGN KEY ("homework_id") REFERENCES "homeworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

