from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .auth import UserResponse, require_csrf_header
from .db import DB
from .models import (
    ExerciseSession,
    ExerciseSessionSet,
    Program,
    ProgramAssignment,
    RepMetric,
    SetMetric,
    User,
)
from .programs import (
    CurrentPatient,
    ProgramDetailResponse,
    program_exercises,
    require_patient,
)

router = APIRouter()


class SessionStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignment_id: UUID


class RepMeasurement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rep_number: Annotated[int, Field(strict=True, ge=1, le=1000)]
    start_angle: Annotated[
        float, Field(strict=True, ge=-180, le=360, allow_inf_nan=False)
    ]
    peak_angle: Annotated[
        float, Field(strict=True, ge=-180, le=360, allow_inf_nan=False)
    ]
    duration_ms: Annotated[int, Field(strict=True, ge=1, le=600000)]
    hold_ms: Annotated[int, Field(strict=True, ge=0, le=60000)]

    @model_validator(mode="after")
    def require_forward_motion(self) -> Self:
        if not 0 <= self.peak_angle - self.start_angle <= 360:
            raise ValueError("peak_angle must be 0 to 360 degrees above start_angle")
        return self


class SessionSetLog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ordinal: Annotated[int, Field(strict=True, ge=0, le=119)]
    exercise_id: UUID
    set_number: Annotated[int, Field(strict=True, ge=1, le=10)]
    reps_completed: Annotated[int, Field(strict=True, ge=0, le=1000)]
    elapsed_seconds: Annotated[
        float, Field(strict=True, ge=0, le=86400, allow_inf_nan=False)
    ]
    pain: Annotated[int, Field(strict=True, ge=0, le=10)]
    difficulty: Annotated[int, Field(strict=True, ge=0, le=10)]
    comfort: Annotated[int, Field(strict=True, ge=0, le=10)]
    notes: Annotated[str, Field(strict=True, max_length=1000)] = ""

    @field_validator("notes", mode="before")
    @classmethod
    def trim_notes(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class SessionSetRequest(SessionSetLog):
    rep_metrics: Annotated[list[RepMeasurement], Field(strict=True, max_length=1000)]

    @model_validator(mode="after")
    def require_one_measurement_per_rep(self) -> Self:
        if [entry.rep_number for entry in self.rep_metrics] != list(
            range(1, self.reps_completed + 1)
        ):
            raise ValueError("rep_metrics must list every completed rep in order")
        return self


class SessionSetResponse(SessionSetLog):
    recorded_at: datetime


class SessionDetailResponse(BaseModel):
    id: UUID
    assignment_id: UUID
    session_date: date
    status: Literal["in_progress", "completed"]
    started_at: datetime
    completed_at: datetime | None
    program: ProgramDetailResponse
    sets: list[SessionSetResponse]


def session_detail(
    session: ExerciseSession, logged_sets: list[ExerciseSessionSet]
) -> SessionDetailResponse:
    return SessionDetailResponse(
        id=session.id,
        assignment_id=session.assignment_id,
        session_date=session.session_date,
        status=session.status,
        started_at=session.started_at,
        completed_at=session.completed_at,
        program=ProgramDetailResponse.model_validate(session.program_snapshot),
        sets=[
            SessionSetResponse.model_validate(logged_set, from_attributes=True)
            for logged_set in logged_sets
        ],
    )


async def patient_session_details(
    db: DB,
    user: UserResponse,
    session_id: UUID | None = None,
    session_date: date | None = None,
) -> list[SessionDetailResponse]:
    query = (
        select(ExerciseSession, ExerciseSessionSet)
        .outerjoin(
            ExerciseSessionSet,
            ExerciseSessionSet.session_id == ExerciseSession.id,
        )
        .where(
            ExerciseSession.patient_id == user.id,
            ExerciseSession.clinic_id == user.clinic_id,
        )
        .order_by(
            ExerciseSession.started_at,
            ExerciseSession.id,
            ExerciseSessionSet.ordinal,
        )
    )
    if session_id is not None:
        query = query.where(ExerciseSession.id == session_id)
    if session_date is not None:
        query = query.where(ExerciseSession.session_date == session_date)
    details: dict[UUID, SessionDetailResponse] = {}
    for session, logged_set in await db.execute(query):
        detail = details.get(session.id)
        if detail is None:
            detail = session_detail(session, [])
            details[session.id] = detail
        if logged_set is not None:
            detail.sets.append(
                SessionSetResponse.model_validate(logged_set, from_attributes=True)
            )
    return list(details.values())


async def require_session_detail(
    db: DB, user: UserResponse, session_id: UUID
) -> SessionDetailResponse:
    details = await patient_session_details(db, user, session_id=session_id)
    if not details:
        raise HTTPException(status_code=404, detail="Exercise session not found.")
    return details[0]


@router.post(
    "/patient/sessions",
    response_model=SessionDetailResponse,
    dependencies=[Depends(require_patient), Depends(require_csrf_header)],
)
async def start_session(
    body: SessionStartRequest, user: CurrentPatient, db: DB
) -> SessionDetailResponse:
    row = (
        await db.execute(
            select(Program, User.full_name)
            .select_from(ProgramAssignment)
            .join(Program, Program.id == ProgramAssignment.program_id)
            .join(User, User.id == Program.created_by)
            .where(
                ProgramAssignment.id == body.assignment_id,
                ProgramAssignment.patient_id == user.id,
                Program.clinic_id == user.clinic_id,
            )
            .with_for_update(read=True, of=(ProgramAssignment, Program))
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Program assignment not found.")
    program, creator_name = row
    exercises = await program_exercises(db, [program.id])
    snapshot = ProgramDetailResponse(
        id=program.id,
        name=program.name,
        notes=program.notes,
        created_at=program.created_at,
        created_by_name=creator_name,
        exercises=exercises[program.id],
    )
    started_at = datetime.now(UTC)
    session_date = started_at.date()
    session_id = await db.scalar(
        insert(ExerciseSession)
        .values(
            patient_id=user.id,
            clinic_id=user.clinic_id,
            assignment_id=body.assignment_id,
            session_date=session_date,
            started_at=started_at,
            program_snapshot=snapshot.model_dump(mode="json"),
        )
        .on_conflict_do_nothing(
            index_elements=[
                ExerciseSession.patient_id,
                ExerciseSession.assignment_id,
                ExerciseSession.session_date,
            ]
        )
        .returning(ExerciseSession.id)
    )
    if session_id is None:
        session_id = await db.scalar(
            select(ExerciseSession.id).where(
                ExerciseSession.patient_id == user.id,
                ExerciseSession.clinic_id == user.clinic_id,
                ExerciseSession.assignment_id == body.assignment_id,
                ExerciseSession.session_date == session_date,
            )
        )
    if session_id is None:
        raise HTTPException(status_code=404, detail="Exercise session not found.")
    detail = await require_session_detail(db, user, session_id)
    await db.commit()
    return detail


@router.get("/patient/sessions/today", response_model=list[SessionDetailResponse])
async def today_sessions(user: CurrentPatient, db: DB) -> list[SessionDetailResponse]:
    return await patient_session_details(db, user, session_date=datetime.now(UTC).date())


@router.get("/patient/sessions/{session_id}", response_model=SessionDetailResponse)
async def get_session(
    session_id: UUID, user: CurrentPatient, db: DB
) -> SessionDetailResponse:
    return await require_session_detail(db, user, session_id)


@router.post(
    "/patient/sessions/{session_id}/sets",
    response_model=SessionDetailResponse,
    dependencies=[Depends(require_patient), Depends(require_csrf_header)],
)
async def record_set(
    session_id: UUID, body: SessionSetRequest, user: CurrentPatient, db: DB
) -> SessionDetailResponse:
    session = await db.scalar(
        select(ExerciseSession)
        .where(
            ExerciseSession.id == session_id,
            ExerciseSession.patient_id == user.id,
            ExerciseSession.clinic_id == user.clinic_id,
        )
        .with_for_update()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Exercise session not found.")
    logged_sets = list(
        (
            await db.execute(
                select(ExerciseSessionSet)
                .where(ExerciseSessionSet.session_id == session.id)
                .order_by(ExerciseSessionSet.ordinal)
            )
        ).scalars()
    )
    values = body.model_dump(exclude={"rep_metrics"})
    if body.ordinal < len(logged_sets):
        existing = logged_sets[body.ordinal]
        if any(getattr(existing, field) != value for field, value in values.items()):
            raise HTTPException(status_code=409, detail="Set already recorded differently.")
        detail = session_detail(session, logged_sets)
        await db.commit()
        return detail
    if session.status == "completed":
        raise HTTPException(status_code=409, detail="Exercise session is already completed.")
    if body.ordinal != len(logged_sets):
        raise HTTPException(status_code=409, detail="Record the next prescribed set in order.")
    program = ProgramDetailResponse.model_validate(session.program_snapshot)
    prescribed_sets = [
        (exercise, set_number)
        for exercise in program.exercises
        for set_number in range(1, exercise.sets + 1)
    ]
    if body.ordinal >= len(prescribed_sets):
        raise HTTPException(status_code=409, detail="Set does not match the prescription.")
    exercise, set_number = prescribed_sets[body.ordinal]
    if (exercise.id, set_number) != (body.exercise_id, body.set_number):
        raise HTTPException(status_code=409, detail="Set does not match the prescription.")
    recorded_at = datetime.now(UTC)
    logged_set = ExerciseSessionSet(
        session_id=session.id,
        recorded_at=recorded_at,
        **values,
    )
    db.add(logged_set)
    logged_sets.append(logged_set)
    metric_keys = {
        "session_id": session.id,
        "set_ordinal": body.ordinal,
        "recorded_at": recorded_at,
        "clinic_id": session.clinic_id,
        "patient_id": session.patient_id,
        "exercise_id": exercise.id,
        "exercise_type": exercise.exercise_type,
    }
    db.add(
        SetMetric(
            **metric_keys,
            reps_completed=body.reps_completed,
            reps_prescribed=exercise.reps,
            elapsed_seconds=body.elapsed_seconds,
            pain=body.pain,
            difficulty=body.difficulty,
            comfort=body.comfort,
        )
    )
    db.add_all(
        RepMetric(
            **metric_keys,
            rep_number=entry.rep_number,
            start_angle=entry.start_angle,
            peak_angle=entry.peak_angle,
            range_of_motion=entry.peak_angle - entry.start_angle,
            target_angle=exercise.target_angle,
            duration_ms=entry.duration_ms,
            hold_ms=entry.hold_ms,
        )
        for entry in body.rep_metrics
    )
    if len(logged_sets) == len(prescribed_sets):
        session.status = "completed"
        session.completed_at = recorded_at
    await db.flush()
    detail = session_detail(session, logged_sets)
    await db.commit()
    return detail
