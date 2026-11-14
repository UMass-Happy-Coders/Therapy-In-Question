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

CREATE TABLE IF NOT EXISTS patient_messages (
    id UUID PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drafted_by UUID NOT NULL REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    subject VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    CONSTRAINT patient_messages_approval_check CHECK (
        (approved_at IS NULL AND approved_by IS NULL AND read_at IS NULL)
        OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS patient_messages_clinic_created_idx
    ON patient_messages (clinic_id, created_at);
CREATE INDEX IF NOT EXISTS patient_messages_patient_approved_idx
    ON patient_messages (patient_id, approved_at);
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
        exercise_type IN ('seated_knee_extension', 'straight_leg_raise', 'sit_to_stand')
    ),
    sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 10),
    reps INTEGER NOT NULL CHECK (reps BETWEEN 1 AND 100),
    target_angle DOUBLE PRECISION NOT NULL CHECK (target_angle BETWEEN 0 AND 180),
    hold_seconds INTEGER NOT NULL CHECK (hold_seconds BETWEEN 0 AND 60),
    CONSTRAINT program_exercises_position_key UNIQUE (program_id, position)
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
