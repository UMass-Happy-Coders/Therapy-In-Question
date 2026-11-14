from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
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


class PatientMessage(Base):
    __tablename__ = "patient_messages"
    __table_args__ = (
        CheckConstraint(
            "(approved_at IS NULL AND approved_by IS NULL AND read_at IS NULL) OR "
            "(approved_at IS NOT NULL AND approved_by IS NOT NULL)",
            name="patient_messages_approval_check",
        ),
        Index("patient_messages_clinic_created_idx", "clinic_id", "created_at"),
        Index("patient_messages_patient_approved_idx", "patient_id", "approved_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    patient_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    drafted_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    subject: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
