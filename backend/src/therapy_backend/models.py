from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
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
            "exercise_type IN ('seated_knee_extension', 'straight_leg_raise', 'sit_to_stand')",
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
