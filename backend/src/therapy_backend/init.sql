CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS clinics (
    id UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    email VARCHAR(254) NOT NULL UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL,
    password_hash TEXT NOT NULL,
    CONSTRAINT users_role_check CHECK (role IN ('therapist', 'patient')),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)))
);

CREATE INDEX IF NOT EXISTS users_clinic_role_idx ON users (clinic_id, role);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);

CREATE TABLE IF NOT EXISTS programs (
    id UUID PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    name VARCHAR(120) NOT NULL,
    notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS programs_clinic_created_idx ON programs (clinic_id, created_at);

CREATE TABLE IF NOT EXISTS program_exercises (
    id UUID PRIMARY KEY,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    exercise_type VARCHAR(40) NOT NULL CHECK (
        exercise_type IN ('seated_knee_extension', 'straight_leg_raise', 'sit_to_stand', 'seated_ankle_pumps')
    ),
    sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 10),
    reps INTEGER NOT NULL CHECK (reps BETWEEN 1 AND 100),
    target_angle DOUBLE PRECISION NOT NULL CHECK (target_angle BETWEEN 0 AND 180),
    hold_seconds INTEGER NOT NULL CHECK (hold_seconds BETWEEN 0 AND 60),
    CONSTRAINT program_exercises_position_key UNIQUE (program_id, position)
);

ALTER TABLE program_exercises
    DROP CONSTRAINT IF EXISTS program_exercises_exercise_type_check,
    DROP CONSTRAINT IF EXISTS program_exercises_type_check,
    ADD CONSTRAINT program_exercises_type_check CHECK (
        exercise_type IN ('seated_knee_extension', 'straight_leg_raise', 'sit_to_stand', 'seated_ankle_pumps')
    );

CREATE TABLE IF NOT EXISTS program_assignments (
    id UUID PRIMARY KEY,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT program_assignments_patient_key UNIQUE (program_id, patient_id)
);

CREATE INDEX IF NOT EXISTS program_assignments_patient_idx ON program_assignments (patient_id);

CREATE TABLE IF NOT EXISTS exercise_sessions (
    id UUID PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL,
    session_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    program_snapshot JSONB NOT NULL,
    CONSTRAINT exercise_sessions_patient_assignment_date_key
        UNIQUE (patient_id, assignment_id, session_date),
    CONSTRAINT exercise_sessions_status_check CHECK (status IN ('in_progress', 'completed')),
    CONSTRAINT exercise_sessions_completion_check CHECK (
        (status = 'in_progress' AND completed_at IS NULL) OR
        (status = 'completed' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS exercise_sessions_patient_date_idx
    ON exercise_sessions (patient_id, session_date);

CREATE TABLE IF NOT EXISTS exercise_session_sets (
    session_id UUID NOT NULL REFERENCES exercise_sessions(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    exercise_id UUID NOT NULL,
    set_number INTEGER NOT NULL,
    reps_completed INTEGER NOT NULL,
    elapsed_seconds DOUBLE PRECISION NOT NULL,
    pain INTEGER NOT NULL,
    difficulty INTEGER NOT NULL,
    comfort INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, ordinal),
    CONSTRAINT exercise_session_sets_exercise_number_key
        UNIQUE (session_id, exercise_id, set_number),
    CONSTRAINT exercise_session_sets_ordinal_check CHECK (ordinal BETWEEN 0 AND 119),
    CONSTRAINT exercise_session_sets_number_check CHECK (set_number BETWEEN 1 AND 10),
    CONSTRAINT exercise_session_sets_reps_check CHECK (reps_completed BETWEEN 0 AND 1000),
    CONSTRAINT exercise_session_sets_elapsed_check CHECK (elapsed_seconds BETWEEN 0 AND 86400),
    CONSTRAINT exercise_session_sets_pain_check CHECK (pain BETWEEN 0 AND 10),
    CONSTRAINT exercise_session_sets_difficulty_check CHECK (difficulty BETWEEN 0 AND 10),
    CONSTRAINT exercise_session_sets_comfort_check CHECK (comfort BETWEEN 0 AND 10),
    CONSTRAINT exercise_session_sets_notes_check CHECK (char_length(notes) <= 1000)
);

CREATE TABLE IF NOT EXISTS rep_metrics (
    recorded_at TIMESTAMPTZ NOT NULL,
    clinic_id UUID NOT NULL,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES exercise_sessions(id) ON DELETE CASCADE,
    set_ordinal INTEGER NOT NULL,
    exercise_id UUID NOT NULL,
    exercise_type VARCHAR(40) NOT NULL,
    rep_number INTEGER NOT NULL,
    start_angle DOUBLE PRECISION NOT NULL,
    peak_angle DOUBLE PRECISION NOT NULL,
    range_of_motion DOUBLE PRECISION NOT NULL,
    target_angle DOUBLE PRECISION NOT NULL,
    duration_ms INTEGER NOT NULL,
    hold_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, set_ordinal, rep_number, recorded_at),
    CONSTRAINT rep_metrics_rep_check CHECK (rep_number BETWEEN 1 AND 1000),
    CONSTRAINT rep_metrics_range_check CHECK (range_of_motion BETWEEN 0 AND 360),
    CONSTRAINT rep_metrics_duration_check CHECK (duration_ms BETWEEN 1 AND 600000),
    CONSTRAINT rep_metrics_hold_check CHECK (hold_ms BETWEEN 0 AND 60000)
);

SELECT create_hypertable('rep_metrics', by_range('recorded_at'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS rep_metrics_patient_time_idx
    ON rep_metrics (patient_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS set_metrics (
    recorded_at TIMESTAMPTZ NOT NULL,
    clinic_id UUID NOT NULL,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES exercise_sessions(id) ON DELETE CASCADE,
    set_ordinal INTEGER NOT NULL,
    exercise_id UUID NOT NULL,
    exercise_type VARCHAR(40) NOT NULL,
    reps_completed INTEGER NOT NULL,
    reps_prescribed INTEGER NOT NULL,
    elapsed_seconds DOUBLE PRECISION NOT NULL,
    pain INTEGER NOT NULL,
    difficulty INTEGER NOT NULL,
    comfort INTEGER NOT NULL,
    PRIMARY KEY (session_id, set_ordinal, recorded_at),
    CONSTRAINT set_metrics_reps_check CHECK (reps_completed BETWEEN 0 AND 1000),
    CONSTRAINT set_metrics_prescribed_check CHECK (reps_prescribed BETWEEN 1 AND 100)
);

SELECT create_hypertable('set_metrics', by_range('recorded_at'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS set_metrics_patient_time_idx
    ON set_metrics (patient_id, recorded_at DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS rep_metrics_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '1 day', recorded_at) AS bucket,
    clinic_id,
    patient_id,
    exercise_type,
    count(*) AS reps,
    avg(range_of_motion) AS avg_range_of_motion,
    max(range_of_motion) AS max_range_of_motion,
    avg(peak_angle) AS avg_peak_angle,
    max(peak_angle) AS max_peak_angle,
    avg(duration_ms) AS avg_duration_ms
FROM rep_metrics
GROUP BY bucket, clinic_id, patient_id, exercise_type
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS rep_metrics_weekly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '7 days', recorded_at) AS bucket,
    clinic_id,
    patient_id,
    exercise_type,
    count(*) AS reps,
    avg(range_of_motion) AS avg_range_of_motion,
    max(range_of_motion) AS max_range_of_motion,
    avg(peak_angle) AS avg_peak_angle,
    max(peak_angle) AS max_peak_angle,
    avg(duration_ms) AS avg_duration_ms
FROM rep_metrics
GROUP BY bucket, clinic_id, patient_id, exercise_type
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS adherence_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '1 day', recorded_at) AS bucket,
    clinic_id,
    patient_id,
    count(*) AS sets_logged,
    sum(reps_completed) AS reps_completed,
    sum(reps_prescribed) AS reps_prescribed,
    sum(elapsed_seconds) AS active_seconds,
    avg(pain) AS avg_pain,
    avg(difficulty) AS avg_difficulty,
    avg(comfort) AS avg_comfort
FROM set_metrics
GROUP BY bucket, clinic_id, patient_id
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS adherence_weekly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '7 days', recorded_at) AS bucket,
    clinic_id,
    patient_id,
    count(*) AS sets_logged,
    sum(reps_completed) AS reps_completed,
    sum(reps_prescribed) AS reps_prescribed,
    sum(elapsed_seconds) AS active_seconds,
    avg(pain) AS avg_pain,
    avg(difficulty) AS avg_difficulty,
    avg(comfort) AS avg_comfort
FROM set_metrics
GROUP BY bucket, clinic_id, patient_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('rep_metrics_daily',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('rep_metrics_weekly',
    start_offset => INTERVAL '21 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('adherence_daily',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('adherence_weekly',
    start_offset => INTERVAL '21 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
