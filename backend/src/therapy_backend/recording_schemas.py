from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

Coordinate = Annotated[
    float, Field(strict=True, ge=-10000, le=10000, allow_inf_nan=False)
]
Probability = Annotated[
    float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)
]
NonnegativeInt = Annotated[int, Field(strict=True, ge=0)]


class RecordingModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecordingPoint(RecordingModel):
    x: Coordinate
    y: Coordinate
    z: Coordinate
    visibility: Probability
    presence: Probability | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @field_validator("presence", mode="before")
    @classmethod
    def require_present_probability(cls, value: object) -> object:
        if value is None:
            raise ValueError("presence must be a finite number when supplied")
        return value


class RecordingFrame(RecordingModel):
    captured_at: AwareDatetime
    elapsed_ms: Annotated[
        float, Field(strict=True, ge=0, le=86400000, allow_inf_nan=False)
    ]
    landmarks: Annotated[
        list[RecordingPoint], Field(strict=True, min_length=33, max_length=33)
    ]
    world_landmarks: Annotated[
        list[RecordingPoint], Field(strict=True, min_length=33, max_length=33)
    ]
    phase: Literal["rest", "raise", "hold", "lower"]
    rep_number: Annotated[int, Field(strict=True, ge=0, le=100)]
    rep_boundary: Annotated[bool, Field(strict=True)]
    annotations: Annotated[
        list[Annotated[str, Field(strict=True, max_length=160)]],
        Field(strict=True, max_length=4),
    ]

    @field_validator("captured_at", mode="before")
    @classmethod
    def require_iso_datetime(cls, value: object) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            return datetime.fromisoformat(value)
        raise ValueError("captured_at must be an ISO datetime with a timezone")


class RecordingChunkRequest(RecordingModel):
    chunk_id: UUID
    run_id: UUID
    set_ordinal: Annotated[int, Field(strict=True, ge=0, le=119)]
    exercise_id: UUID
    side: Literal["left", "right"]
    frames: Annotated[
        list[RecordingFrame], Field(strict=True, min_length=1, max_length=25)
    ]

    @model_validator(mode="after")
    def require_ordered_frames(self) -> Self:
        for previous, current in zip(self.frames, self.frames[1:]):
            if current.captured_at <= previous.captured_at:
                raise ValueError("captured_at must strictly increase within a chunk")
            if current.elapsed_ms < previous.elapsed_ms:
                raise ValueError("elapsed_ms must not decrease within a chunk")
            if current.rep_number < previous.rep_number:
                raise ValueError("rep_number must not decrease within a chunk")
        return self


class RecordingSummary(RecordingModel):
    chunks: NonnegativeInt
    frames: NonnegativeInt


class RecordingReceipt(RecordingModel):
    chunk_id: UUID
    seq: NonnegativeInt
    frame_count: Annotated[int, Field(strict=True, ge=1, le=25)]
    total_chunks: NonnegativeInt
    total_frames: NonnegativeInt


class StoredRecordingChunk(RecordingChunkRequest):
    seq: NonnegativeInt
    stored_at: AwareDatetime
    frame_count: Annotated[int, Field(strict=True, ge=1, le=25)]


class RecordingPage(RecordingModel):
    chunks: list[StoredRecordingChunk]
    next_after_seq: NonnegativeInt | None
