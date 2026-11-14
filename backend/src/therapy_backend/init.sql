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
