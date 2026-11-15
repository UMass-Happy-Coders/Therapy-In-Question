from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Clinic(Base):
    __tablename__ = "clinics"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200))


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('therapist', 'patient')", name="users_role_check"),
        CheckConstraint("email = lower(btrim(email))", name="users_email_normalized"),
        Index("users_clinic_role_idx", "clinic_id", "role"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(Text)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (Index("auth_sessions_user_id_idx", "user_id"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Program(Base):
    __tablename__ = "programs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("programs_clinic_created_idx", "clinic_id", "created_at"),)


class ProgramExercise(Base):
    __tablename__ = "program_exercises"
    __table_args__ = (
        UniqueConstraint("program_id", "position", name="program_exercises_position_key"),
        CheckConstraint("position >= 0", name="program_exercises_position_check"),
        CheckConstraint(
            "exercise_type IN ('seated_knee_extension', 'straight_leg_raise', "
            "'sit_to_stand', 'seated_ankle_pumps')",
            name="program_exercises_type_check",
        ),
        CheckConstraint("sets BETWEEN 1 AND 10", name="program_exercises_sets_check"),
        CheckConstraint("reps BETWEEN 1 AND 100", name="program_exercises_reps_check"),
        CheckConstraint("target_angle BETWEEN 0 AND 180", name="program_exercises_angle_check"),
        CheckConstraint("hold_seconds BETWEEN 0 AND 60", name="program_exercises_hold_check"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    program_id: Mapped[UUID] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    exercise_type: Mapped[str] = mapped_column(String(40))
    sets: Mapped[int] = mapped_column(Integer)
    reps: Mapped[int] = mapped_column(Integer)
    target_angle: Mapped[float] = mapped_column(Float)
    hold_seconds: Mapped[int] = mapped_column(Integer)


class ProgramAssignment(Base):
    __tablename__ = "program_assignments"
    __table_args__ = (
        UniqueConstraint("program_id", "patient_id", name="program_assignments_patient_key"),
        Index("program_assignments_patient_idx", "patient_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    program_id: Mapped[UUID] = mapped_column(ForeignKey("programs.id", ondelete="CASCADE"))
    patient_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    assigned_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExerciseSession(Base):
    __tablename__ = "exercise_sessions"
    __table_args__ = (
        UniqueConstraint(
            "patient_id",
            "assignment_id",
            "session_date",
            name="exercise_sessions_patient_assignment_date_key",
        ),
        CheckConstraint(
            "status IN ('in_progress', 'completed')",
            name="exercise_sessions_status_check",
        ),
        CheckConstraint(
            "(status = 'in_progress' AND completed_at IS NULL) OR "
            "(status = 'completed' AND completed_at IS NOT NULL)",
            name="exercise_sessions_completion_check",
        ),
        Index("exercise_sessions_patient_date_idx", "patient_id", "session_date"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    patient_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    assignment_id: Mapped[UUID] = mapped_column()
    session_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), server_default="in_progress")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    program_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)


class ExerciseSessionSet(Base):
    __tablename__ = "exercise_session_sets"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "exercise_id",
            "set_number",
            name="exercise_session_sets_exercise_number_key",
        ),
        CheckConstraint("ordinal BETWEEN 0 AND 119", name="exercise_session_sets_ordinal_check"),
        CheckConstraint("set_number BETWEEN 1 AND 10", name="exercise_session_sets_number_check"),
        CheckConstraint("reps_completed BETWEEN 0 AND 1000", name="exercise_session_sets_reps_check"),
        CheckConstraint(
            "elapsed_seconds BETWEEN 0 AND 86400",
            name="exercise_session_sets_elapsed_check",
        ),
        CheckConstraint("pain BETWEEN 0 AND 10", name="exercise_session_sets_pain_check"),
        CheckConstraint("difficulty BETWEEN 0 AND 10", name="exercise_session_sets_difficulty_check"),
        CheckConstraint("comfort BETWEEN 0 AND 10", name="exercise_session_sets_comfort_check"),
        CheckConstraint("char_length(notes) <= 1000", name="exercise_session_sets_notes_check"),
    )

    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("exercise_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    exercise_id: Mapped[UUID] = mapped_column()
    set_number: Mapped[int] = mapped_column(Integer)
    reps_completed: Mapped[int] = mapped_column(Integer)
    elapsed_seconds: Mapped[float] = mapped_column(Float)
    pain: Mapped[int] = mapped_column(Integer)
    difficulty: Mapped[int] = mapped_column(Integer)
    comfort: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, server_default="")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
