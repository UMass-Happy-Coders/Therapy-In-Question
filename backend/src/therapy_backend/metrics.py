from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text

from .auth import UserResponse
from .db import DB
from .exercises import EXERCISE_BY_ID
from .models import RepMetric
from .programs import CurrentPatient
from .sessions import require_session_detail

router = APIRouter()

PERIODS = {
    "day": ("rep_metrics_daily", "adherence_daily", timedelta(days=1)),
    "week": ("rep_metrics_weekly", "adherence_weekly", timedelta(days=7)),
}


class RepMetricResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    set_ordinal: int
    rep_number: int
    start_angle: float
    peak_angle: float
    range_of_motion: float
    target_angle: float
    duration_ms: int
    hold_ms: int


class MovementTotals(BaseModel):
    exercise_type: str
    name: str
    reps: int
    avg_range_of_motion: float
    max_range_of_motion: float
    avg_duration_ms: float


class AdherenceTotals(BaseModel):
    sets_logged: int
    reps_completed: int
    reps_prescribed: int
    active_seconds: float


class PeriodTotals(BaseModel):
    movement: list[MovementTotals]
    adherence: AdherenceTotals | None


class SessionMetricsResponse(BaseModel):
    reps: list[RepMetricResponse]
    day: PeriodTotals
    week: PeriodTotals


async def period_totals(
    db: DB, user: UserResponse, session_date: date, period: str
) -> PeriodTotals:
    movement_view, adherence_view, width = PERIODS[period]
    scope = {
        "patient_id": user.id,
        "clinic_id": user.clinic_id,
        "width": width,
        "moment": datetime.combine(session_date, time(12), UTC),
    }
    bucket = (
        "patient_id = :patient_id AND clinic_id = :clinic_id AND "
        "bucket = time_bucket(CAST(:width AS interval), CAST(:moment AS timestamptz))"
    )
    movement = await db.execute(
        text(
            "SELECT exercise_type, reps, avg_range_of_motion, max_range_of_motion, "
            f"avg_duration_ms FROM {movement_view} WHERE {bucket} ORDER BY exercise_type"
        ),
        scope,
    )
    adherence = await db.execute(
        text(
            "SELECT sets_logged, reps_completed, reps_prescribed, active_seconds "
            f"FROM {adherence_view} WHERE {bucket}"
        ),
        scope,
    )
    adherence_row = adherence.mappings().first()
    return PeriodTotals(
        movement=[
            MovementTotals(
                **row,
                name=(
                    EXERCISE_BY_ID[row["exercise_type"]].name
                    if row["exercise_type"] in EXERCISE_BY_ID
                    else row["exercise_type"]
                ),
            )
            for row in movement.mappings()
        ],
        adherence=(
            AdherenceTotals.model_validate(dict(adherence_row))
            if adherence_row is not None
            else None
        ),
    )


@router.get(
    "/patient/sessions/{session_id}/metrics", response_model=SessionMetricsResponse
)
async def get_session_metrics(
    session_id: UUID, user: CurrentPatient, db: DB
) -> SessionMetricsResponse:
    session = await require_session_detail(db, user, session_id)
    reps = await db.execute(
        select(RepMetric)
        .where(RepMetric.session_id == session.id, RepMetric.patient_id == user.id)
        .order_by(RepMetric.set_ordinal, RepMetric.rep_number)
    )
    return SessionMetricsResponse(
        reps=[
            RepMetricResponse.model_validate(row) for row in reps.scalars()
        ],
        day=await period_totals(db, user, session.session_date, "day"),
        week=await period_totals(db, user, session.session_date, "week"),
    )
