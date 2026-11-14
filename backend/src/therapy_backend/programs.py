from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from .auth import CurrentTherapist, CurrentUser, UserResponse, require_csrf_header
from .db import DB
from .exercises import EXERCISE_BY_ID, EXERCISES, ExerciseDefinition, ExerciseType
from .models import Program, ProgramAssignment, ProgramExercise, User

router = APIRouter()


class ProgramExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_type: ExerciseType
    sets: Annotated[int, Field(strict=True, ge=1, le=10)]
    reps: Annotated[int, Field(strict=True, ge=1, le=100)]
    target_angle: Annotated[float, Field(strict=True, allow_inf_nan=False)]
    hold_seconds: Annotated[int, Field(strict=True, ge=0, le=60)]

    @model_validator(mode="after")
    def validate_target(self) -> Self:
        exercise = EXERCISE_BY_ID[self.exercise_type]
        if not exercise.target_min <= self.target_angle <= exercise.target_max:
            raise ValueError(
                f"Target angle for {exercise.name} must be between "
                f"{exercise.target_min:g} and {exercise.target_max:g} degrees."
            )
        return self


class ProgramCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(strict=True, min_length=1, max_length=120)]
    notes: Annotated[str, Field(strict=True, max_length=2000)] = ""
    exercises: Annotated[list[ProgramExerciseRequest], Field(min_length=1, max_length=12)]
    patient_id: UUID | None = None

    @field_validator("name", "notes", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProgramAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: UUID


class ProgramExerciseResponse(BaseModel):
    id: UUID
    position: int
    exercise_type: ExerciseType
    name: str
    target_label: str
    sets: int
    reps: int
    target_angle: float
    hold_seconds: int


class ProgramDetailResponse(BaseModel):
    id: UUID
    name: str
    notes: str
    created_at: datetime
    created_by_name: str
    exercises: list[ProgramExerciseResponse]


class ProgramAssignmentResponse(BaseModel):
    id: UUID
    patient_id: UUID
    patient_name: str
    assigned_at: datetime


class ProgramResponse(ProgramDetailResponse):
    assignments: list[ProgramAssignmentResponse]


class AssignedProgramResponse(BaseModel):
    id: UUID
    assigned_at: datetime
    therapist_name: str
    program: ProgramDetailResponse


async def require_patient(user: CurrentUser) -> UserResponse:
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Patient access required.")
    return user


CurrentPatient = Annotated[UserResponse, Depends(require_patient)]


async def program_exercises(
    db: DB, program_ids: list[UUID]
) -> dict[UUID, list[ProgramExerciseResponse]]:
    grouped: dict[UUID, list[ProgramExerciseResponse]] = {
        program_id: [] for program_id in program_ids
    }
    if not program_ids:
        return grouped
    result = await db.execute(
        select(ProgramExercise)
        .where(ProgramExercise.program_id.in_(program_ids))
        .order_by(ProgramExercise.program_id, ProgramExercise.position)
    )
    for exercise in result.scalars():
        definition = EXERCISE_BY_ID[exercise.exercise_type]
        grouped[exercise.program_id].append(
            ProgramExerciseResponse(
                id=exercise.id,
                position=exercise.position,
                exercise_type=definition.id,
                name=definition.name,
                target_label=definition.target_label,
                sets=exercise.sets,
                reps=exercise.reps,
                target_angle=exercise.target_angle,
                hold_seconds=exercise.hold_seconds,
            )
        )
    return grouped


async def therapist_programs(
    db: DB, clinic_id: UUID, program_id: UUID | None = None
) -> list[ProgramResponse]:
    query = (
        select(Program, User.full_name)
        .join(User, User.id == Program.created_by)
        .where(Program.clinic_id == clinic_id)
        .order_by(Program.created_at.desc(), Program.id.desc())
    )
    if program_id is not None:
        query = query.where(Program.id == program_id)
    rows = (await db.execute(query)).all()
    if not rows:
        return []
    program_ids = [program.id for program, _ in rows]
    exercises = await program_exercises(db, program_ids)
    assignments: dict[UUID, list[ProgramAssignmentResponse]] = {
        program_id: [] for program_id in program_ids
    }
    result = await db.execute(
        select(ProgramAssignment, User.full_name)
        .join(User, User.id == ProgramAssignment.patient_id)
        .where(
            ProgramAssignment.program_id.in_(program_ids),
            User.clinic_id == clinic_id,
            User.role == "patient",
        )
        .order_by(ProgramAssignment.assigned_at.desc(), ProgramAssignment.id.desc())
    )
    for assignment, patient_name in result:
        assignments[assignment.program_id].append(
            ProgramAssignmentResponse(
                id=assignment.id,
                patient_id=assignment.patient_id,
                patient_name=patient_name,
                assigned_at=assignment.assigned_at,
            )
        )
    return [
        ProgramResponse(
            id=program.id,
            name=program.name,
            notes=program.notes,
            created_at=program.created_at,
            created_by_name=creator_name,
            exercises=exercises[program.id],
            assignments=assignments[program.id],
        )
        for program, creator_name in rows
    ]


async def therapist_program(db: DB, clinic_id: UUID, program_id: UUID) -> ProgramResponse:
    programs = await therapist_programs(db, clinic_id, program_id)
    if not programs:
        raise HTTPException(status_code=404, detail="Program not found.")
    return programs[0]


async def require_program(db: DB, clinic_id: UUID, program_id: UUID) -> None:
    result = await db.execute(
        select(Program.id).where(Program.id == program_id, Program.clinic_id == clinic_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Program not found.")


async def require_clinic_patient(db: DB, clinic_id: UUID, patient_id: UUID) -> None:
    result = await db.execute(
        select(User.id).where(
            User.id == patient_id,
            User.clinic_id == clinic_id,
            User.role == "patient",
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Patient not found.")


async def insert_assignment(
    db: DB, program_id: UUID, patient_id: UUID, therapist_id: UUID
) -> None:
    await db.execute(
        insert(ProgramAssignment)
        .values(program_id=program_id, patient_id=patient_id, assigned_by=therapist_id)
        .on_conflict_do_nothing(
            index_elements=[ProgramAssignment.program_id, ProgramAssignment.patient_id]
        )
    )


@router.get("/exercises", response_model=list[ExerciseDefinition])
async def exercises(user: CurrentUser) -> list[ExerciseDefinition]:
    return list(EXERCISES)


@router.get("/therapist/programs", response_model=list[ProgramResponse])
async def list_programs(user: CurrentTherapist, db: DB) -> list[ProgramResponse]:
    return await therapist_programs(db, user.clinic_id)


@router.post(
    "/therapist/programs",
    response_model=ProgramResponse,
    status_code=201,
    dependencies=[Depends(require_csrf_header)],
)
async def create_program(
    body: ProgramCreateRequest, user: CurrentTherapist, db: DB
) -> ProgramResponse:
    if body.patient_id is not None:
        await require_clinic_patient(db, user.clinic_id, body.patient_id)
    program = Program(
        clinic_id=user.clinic_id,
        created_by=user.id,
        name=body.name,
        notes=body.notes,
    )
    db.add(program)
    await db.flush()
    db.add_all(
        ProgramExercise(program_id=program.id, position=position, **exercise.model_dump())
        for position, exercise in enumerate(body.exercises)
    )
    if body.patient_id is not None:
        await insert_assignment(db, program.id, body.patient_id, user.id)
    await db.commit()
    return await therapist_program(db, user.clinic_id, program.id)


@router.get("/therapist/programs/{program_id}", response_model=ProgramResponse)
async def get_program(
    program_id: UUID, user: CurrentTherapist, db: DB
) -> ProgramResponse:
    return await therapist_program(db, user.clinic_id, program_id)


@router.post(
    "/therapist/programs/{program_id}/assignments",
    response_model=ProgramResponse,
    dependencies=[Depends(require_csrf_header)],
)
async def assign_program(
    program_id: UUID,
    body: ProgramAssignmentRequest,
    user: CurrentTherapist,
    db: DB,
) -> ProgramResponse:
    await require_program(db, user.clinic_id, program_id)
    await require_clinic_patient(db, user.clinic_id, body.patient_id)
    await insert_assignment(db, program_id, body.patient_id, user.id)
    await db.commit()
    return await therapist_program(db, user.clinic_id, program_id)


@router.delete(
    "/therapist/programs/{program_id}/assignments/{patient_id}",
    status_code=204,
    response_class=Response,
    dependencies=[Depends(require_csrf_header)],
)
async def revoke_assignment(
    program_id: UUID, patient_id: UUID, user: CurrentTherapist, db: DB
) -> Response:
    await require_program(db, user.clinic_id, program_id)
    await require_clinic_patient(db, user.clinic_id, patient_id)
    await db.execute(
        delete(ProgramAssignment).where(
            ProgramAssignment.program_id == program_id,
            ProgramAssignment.patient_id == patient_id,
        )
    )
    await db.commit()
    return Response(status_code=204)


@router.get("/patient/programs", response_model=list[AssignedProgramResponse])
async def patient_programs(user: CurrentPatient, db: DB) -> list[AssignedProgramResponse]:
    creator = aliased(User)
    assigner = aliased(User)
    result = await db.execute(
        select(ProgramAssignment, Program, creator.full_name, assigner.full_name)
        .join(Program, Program.id == ProgramAssignment.program_id)
        .join(creator, creator.id == Program.created_by)
        .join(assigner, assigner.id == ProgramAssignment.assigned_by)
        .where(
            ProgramAssignment.patient_id == user.id,
            Program.clinic_id == user.clinic_id,
        )
        .order_by(ProgramAssignment.assigned_at.desc(), ProgramAssignment.id.desc())
    )
    rows = result.all()
    exercises = await program_exercises(db, [program.id for _, program, _, _ in rows])
    return [
        AssignedProgramResponse(
            id=assignment.id,
            assigned_at=assignment.assigned_at,
            therapist_name=assigner_name,
            program=ProgramDetailResponse(
                id=program.id,
                name=program.name,
                notes=program.notes,
                created_at=program.created_at,
                created_by_name=creator_name,
                exercises=exercises[program.id],
            ),
        )
        for assignment, program, creator_name, assigner_name in rows
    ]
