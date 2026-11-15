from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StrictStr, StringConstraints
from sqlalchemy import Select, and_, func, select, update
from sqlalchemy.orm import aliased

from .auth import CurrentTherapist, CurrentUser, UserResponse, require_csrf_header
from .db import DB
from .models import PatientMessage, User

router = APIRouter()


class DraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: UUID
    subject: Annotated[
        StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
    ]
    body: Annotated[
        StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
    ]


class TherapistMessage(BaseModel):
    id: UUID
    patient_id: UUID
    patient_name: str
    subject: str
    body: str
    created_at: datetime
    drafted_by_name: str
    approved_at: datetime | None
    approved_by_name: str | None
    read_at: datetime | None


class InboxMessage(BaseModel):
    id: UUID
    subject: str
    body: str
    approved_at: datetime
    read_at: datetime | None
    therapist_name: str


async def require_patient(user: CurrentUser) -> UserResponse:
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient access required.")
    return user


CurrentPatient = Annotated[UserResponse, Depends(require_patient)]


def therapist_message_query(user: UserResponse) -> Select:
    recipient = aliased(User, name="recipient")
    drafter = aliased(User, name="drafter")
    approver = aliased(User, name="approver")
    return (
        select(
            PatientMessage.id,
            PatientMessage.patient_id,
            recipient.full_name.label("patient_name"),
            PatientMessage.subject,
            PatientMessage.body,
            PatientMessage.created_at,
            drafter.full_name.label("drafted_by_name"),
            PatientMessage.approved_at,
            approver.full_name.label("approved_by_name"),
            PatientMessage.read_at,
        )
        .join(
            recipient,
            and_(
                recipient.id == PatientMessage.patient_id,
                recipient.clinic_id == user.clinic_id,
                recipient.role == "patient",
            ),
        )
        .join(drafter, drafter.id == PatientMessage.drafted_by)
        .outerjoin(approver, approver.id == PatientMessage.approved_by)
        .where(PatientMessage.clinic_id == user.clinic_id)
    )


def inbox_message_query(user: UserResponse) -> Select:
    approver = aliased(User, name="approver")
    return (
        select(
            PatientMessage.id,
            PatientMessage.subject,
            PatientMessage.body,
            PatientMessage.approved_at,
            PatientMessage.read_at,
            approver.full_name.label("therapist_name"),
        )
        .join(approver, approver.id == PatientMessage.approved_by)
        .where(
            PatientMessage.clinic_id == user.clinic_id,
            PatientMessage.patient_id == user.id,
            PatientMessage.approved_at.is_not(None),
        )
    )


async def require_recipient(patient_id: UUID, user: UserResponse, db: DB) -> None:
    recipient = await db.scalar(
        select(User.id).where(
            User.id == patient_id,
            User.clinic_id == user.clinic_id,
            User.role == "patient",
        )
    )
    if recipient is None:
        raise HTTPException(status_code=404, detail="Patient not found.")


async def locked_message(
    message_id: UUID, user: UserResponse, db: DB
) -> PatientMessage:
    message = await db.scalar(
        select(PatientMessage)
        .where(
            PatientMessage.id == message_id,
            PatientMessage.clinic_id == user.clinic_id,
        )
        .with_for_update()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    return message


async def therapist_message_response(
    message_id: UUID, user: UserResponse, db: DB
) -> TherapistMessage:
    result = await db.execute(
        therapist_message_query(user).where(PatientMessage.id == message_id)
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    return TherapistMessage.model_validate(row)


@router.get("/therapist/messages", response_model=list[TherapistMessage])
async def therapist_messages(user: CurrentTherapist, db: DB) -> list[TherapistMessage]:
    result = await db.execute(
        therapist_message_query(user).order_by(
            PatientMessage.created_at.desc(), PatientMessage.id.desc()
        )
    )
    return [TherapistMessage.model_validate(row) for row in result.mappings()]


@router.post(
    "/therapist/messages",
    status_code=201,
    response_model=TherapistMessage,
    dependencies=[Depends(require_csrf_header)],
)
async def create_message(
    body: DraftInput, user: CurrentTherapist, db: DB
) -> TherapistMessage:
    await require_recipient(body.patient_id, user, db)
    message = PatientMessage(
        clinic_id=user.clinic_id,
        patient_id=body.patient_id,
        drafted_by=user.id,
        subject=body.subject,
        body=body.body,
    )
    db.add(message)
    await db.commit()
    return await therapist_message_response(message.id, user, db)


@router.get("/therapist/messages/{message_id}", response_model=TherapistMessage)
async def get_message(
    message_id: UUID, user: CurrentTherapist, db: DB
) -> TherapistMessage:
    return await therapist_message_response(message_id, user, db)


@router.put(
    "/therapist/messages/{message_id}",
    response_model=TherapistMessage,
    dependencies=[Depends(require_csrf_header)],
)
async def edit_message(
    message_id: UUID, body: DraftInput, user: CurrentTherapist, db: DB
) -> TherapistMessage:
    message = await locked_message(message_id, user, db)
    await require_recipient(body.patient_id, user, db)
    if message.approved_at is not None:
        raise HTTPException(status_code=409, detail="Approved messages cannot be edited.")
    message.patient_id = body.patient_id
    message.subject = body.subject
    message.body = body.body
    await db.commit()
    return await therapist_message_response(message_id, user, db)


@router.post(
    "/therapist/messages/{message_id}/approve",
    response_model=TherapistMessage,
    dependencies=[Depends(require_csrf_header)],
)
async def approve_message(
    message_id: UUID, body: DraftInput, user: CurrentTherapist, db: DB
) -> TherapistMessage:
    message = await locked_message(message_id, user, db)
    await require_recipient(body.patient_id, user, db)
    if (
        message.patient_id != body.patient_id
        or message.subject != body.subject
        or message.body != body.body
    ):
        raise HTTPException(
            status_code=409, detail="Message changed. Review the current draft before approval."
        )
    if message.approved_at is None:
        message.approved_by = user.id
        message.approved_at = func.now()
    await db.commit()
    return await therapist_message_response(message_id, user, db)


@router.get("/patient/messages", response_model=list[InboxMessage])
async def patient_messages(user: CurrentPatient, db: DB) -> list[InboxMessage]:
    result = await db.execute(
        inbox_message_query(user).order_by(
            PatientMessage.approved_at.desc(), PatientMessage.id.desc()
        )
    )
    return [InboxMessage.model_validate(row) for row in result.mappings()]


@router.post(
    "/patient/messages/{message_id}/read",
    response_model=InboxMessage,
    dependencies=[Depends(require_csrf_header)],
)
async def read_message(
    message_id: UUID, user: CurrentPatient, db: DB
) -> InboxMessage:
    result = await db.execute(
        update(PatientMessage)
        .where(
            PatientMessage.id == message_id,
            PatientMessage.clinic_id == user.clinic_id,
            PatientMessage.patient_id == user.id,
            PatientMessage.approved_at.is_not(None),
        )
        .values(read_at=func.coalesce(PatientMessage.read_at, func.now()))
        .returning(PatientMessage.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    await db.commit()
    response = await db.execute(
        inbox_message_query(user).where(PatientMessage.id == message_id)
    )
    row = response.mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found.")
    return InboxMessage.model_validate(row)
