from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from .auth import UserResponse, require_csrf_header
from .db import DB, Mongo
from .models import ExerciseSession
from .programs import CurrentPatient, ProgramDetailResponse, require_patient
from .recording_schemas import (
    RecordingChunkRequest,
    RecordingPage,
    RecordingReceipt,
    RecordingSummary,
)
from .recording_storage import (
    recording_chunks,
    recording_summary,
    store_recording_chunk,
)

router = APIRouter()


async def require_recording_session(
    db: DB, user: UserResponse, session_id: UUID
) -> ExerciseSession:
    session = await db.scalar(
        select(ExerciseSession).where(
            ExerciseSession.id == session_id,
            ExerciseSession.patient_id == user.id,
            ExerciseSession.clinic_id == user.clinic_id,
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Exercise session not found.")
    return session


@router.post(
    "/patient/sessions/{session_id}/recording/chunks",
    response_model=RecordingReceipt,
    dependencies=[Depends(require_patient), Depends(require_csrf_header)],
)
async def post_recording_chunk(
    session_id: UUID,
    body: RecordingChunkRequest,
    user: CurrentPatient,
    db: DB,
    mongo: Mongo,
) -> RecordingReceipt:
    session = await require_recording_session(db, user, session_id)
    program = ProgramDetailResponse.model_validate(session.program_snapshot)
    ordinal = 0
    prescribed_exercise = None
    for exercise in program.exercises:
        if ordinal <= body.set_ordinal < ordinal + exercise.sets:
            prescribed_exercise = exercise
            break
        ordinal += exercise.sets
    if prescribed_exercise is None or prescribed_exercise.id != body.exercise_id:
        raise HTTPException(status_code=409, detail="Chunk does not match the prescription.")
    await db.rollback()
    return await store_recording_chunk(
        mongo, session_id, user.id, user.clinic_id, body
    )


@router.get(
    "/patient/sessions/{session_id}/recording",
    response_model=RecordingSummary,
)
async def get_recording_summary(
    session_id: UUID, user: CurrentPatient, db: DB, mongo: Mongo
) -> RecordingSummary:
    await require_recording_session(db, user, session_id)
    await db.rollback()
    return await recording_summary(mongo, session_id)


@router.get(
    "/patient/sessions/{session_id}/recording/chunks",
    response_model=RecordingPage,
)
async def get_recording_chunks(
    session_id: UUID,
    user: CurrentPatient,
    db: DB,
    mongo: Mongo,
    after_seq: Annotated[int, Query(ge=-1)] = -1,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> RecordingPage:
    await require_recording_session(db, user, session_id)
    await db.rollback()
    return await recording_chunks(mongo, session_id, after_seq, limit)
