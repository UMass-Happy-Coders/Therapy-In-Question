from typing import Literal

from pydantic import BaseModel

ExerciseType = Literal[
    "seated_knee_extension", "straight_leg_raise", "sit_to_stand", "seated_ankle_pumps"
]


class ExerciseDefinition(BaseModel):
    id: ExerciseType
    name: str
    description: str
    target_label: str
    target_min: float
    target_max: float
    target_default: float


EXERCISES = (
    ExerciseDefinition(
        id="seated_knee_extension",
        name="Seated knee extension",
        description="Straighten the knee from a seated position, then lower with control.",
        target_label="Knee extension angle",
        target_min=90,
        target_max=180,
        target_default=170,
    ),
    ExerciseDefinition(
        id="straight_leg_raise",
        name="Straight leg raise",
        description="Raise the leg while keeping the knee straight, then lower with control.",
        target_label="Hip flexion angle",
        target_min=0,
        target_max=90,
        target_default=45,
    ),
    ExerciseDefinition(
        id="sit_to_stand",
        name="Sit-to-stand",
        description="Rise from a chair, then return to sitting with control.",
        target_label="Standing knee angle",
        target_min=90,
        target_max=180,
        target_default=170,
    ),
    ExerciseDefinition(
        id="seated_ankle_pumps",
        name="Seated ankle pumps",
        description=(
            "Seated with your leg supported and foot free to move, point your toes "
            "away, then return. Only use if assigned by your therapist."
        ),
        target_label="Ankle plantar flexion",
        target_min=15,
        target_max=60,
        target_default=25,
    ),
)
EXERCISE_BY_ID = {exercise.id: exercise for exercise in EXERCISES}
