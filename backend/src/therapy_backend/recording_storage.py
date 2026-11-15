import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from math import isfinite
from typing import Annotated, Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, TypeAdapter, field_validator
from pymongo import ASCENDING, IndexModel, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError, PyMongoError

from .recording_schemas import (
    RecordingChunkRequest,
    RecordingIndexChunk,
    RecordingIndexPage,
    RecordingModel,
    RecordingPage,
    RecordingReceipt,
    RecordingRepBoundary,
    RecordingSummary,
    RecordingWorldBounds,
    StoredRecordingChunk,
)

_MONGO_TIMEOUT_SECONDS = 10
_indexes_lock = asyncio.Lock()
_indexes_ready = False
_STORED_PROJECTION = {
    **{field: 1 for field in StoredRecordingChunk.model_fields},
    "_id": 0,
}
_RECEIPT_PROJECTION = {
    "_id": 0,
    "chunk_id": 1,
    "seq": 1,
    "frame_count": 1,
    "content_hash": 1,
}
_INDEX_PROJECTION = {
    "_id": 0,
    "seq": 1,
    "run_id": 1,
    "set_ordinal": 1,
    "exercise_id": 1,
    "side": 1,
    "frame_count": 1,
    "frames.elapsed_ms": 1,
    "frames.rep_number": 1,
    "frames.rep_boundary": 1,
    "frames.world_landmarks.x": 1,
    "frames.world_landmarks.y": 1,
    "frames.world_landmarks.z": 1,
    "frames.world_landmarks.visibility": 1,
    "frames.world_landmarks.presence": 1,
}


class _IndexPoint(RecordingModel):
    x: Annotated[float, Field(strict=True)]
    y: Annotated[float, Field(strict=True)]
    z: Annotated[float, Field(strict=True)]
    visibility: Annotated[float, Field(strict=True)]
    presence: Annotated[float, Field(strict=True)] | None = None


class _IndexFrame(RecordingModel):
    elapsed_ms: Annotated[
        float, Field(strict=True, ge=0, le=86400000, allow_inf_nan=False)
    ]
    rep_number: Annotated[int, Field(strict=True, ge=0, le=100)]
    rep_boundary: Annotated[bool, Field(strict=True)]
    world_landmarks: Annotated[
        list[_IndexPoint], Field(strict=True, min_length=21, max_length=33)
    ]

    @field_validator("world_landmarks")
    @classmethod
    def require_landmark_count(cls, value: list[_IndexPoint]) -> list[_IndexPoint]:
        if len(value) not in (21, 33):
            raise ValueError("world_landmarks must contain exactly 21 or 33 points")
        return value


_INDEX_FRAMES = TypeAdapter(
    Annotated[list[_IndexFrame], Field(strict=True, min_length=1, max_length=25)]
)


async def _ensure_indexes(mongo: AsyncDatabase) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    async with _indexes_lock:
        if _indexes_ready:
            return
        await mongo["recording_chunks"].create_indexes(
            [
                IndexModel(
                    [("session_id", ASCENDING), ("seq", ASCENDING)],
                    unique=True,
                    name="recording_chunks_session_seq_unique",
                ),
                IndexModel(
                    [("session_id", ASCENDING), ("chunk_id", ASCENDING)],
                    unique=True,
                    name="recording_chunks_session_chunk_unique",
                ),
            ]
        )
        _indexes_ready = True


@asynccontextmanager
async def _recording_access(mongo: AsyncDatabase) -> AsyncIterator[None]:
    try:
        async with asyncio.timeout(_MONGO_TIMEOUT_SECONDS):
            await _ensure_indexes(mongo)
            yield
    except (PyMongoError, TimeoutError) as exc:
        raise HTTPException(
            status_code=503, detail="Movement recording storage is unavailable."
        ) from exc


async def _summary(mongo: AsyncDatabase, session_id: str) -> RecordingSummary:
    async with await mongo["recording_chunks"].aggregate(
        [
            {"$match": {"session_id": session_id}},
            {
                "$group": {
                    "_id": None,
                    "chunks": {"$sum": 1},
                    "frames": {"$sum": "$frame_count"},
                }
            },
            {"$project": {"_id": 0, "chunks": 1, "frames": 1}},
        ]
    ) as cursor:
        totals = await cursor.to_list(length=1)
    if not totals:
        return RecordingSummary(chunks=0, frames=0)
    return RecordingSummary.model_validate(totals[0])


async def _receipt(
    mongo: AsyncDatabase, session_id: str, chunk: dict[str, Any], content_hash: str
) -> RecordingReceipt:
    if chunk["content_hash"] != content_hash:
        raise HTTPException(
            status_code=409, detail="This recording chunk ID has different content."
        )
    totals = await _summary(mongo, session_id)
    return RecordingReceipt(
        chunk_id=chunk["chunk_id"],
        seq=chunk["seq"],
        frame_count=chunk["frame_count"],
        total_chunks=totals.chunks,
        total_frames=totals.frames,
    )


async def _next_sequence(mongo: AsyncDatabase, session_id: str) -> int:
    sequences = mongo["recording_sequences"]
    try:
        counter = await sequences.find_one_and_update(
            {"_id": session_id},
            {"$inc": {"next_seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        counter = await sequences.find_one_and_update(
            {"_id": session_id},
            {"$inc": {"next_seq": 1}},
            return_document=ReturnDocument.AFTER,
        )
    if counter is None:
        raise PyMongoError("The recording sequence counter is unavailable.")
    return counter["next_seq"] - 1


async def recording_summary(
    mongo: AsyncDatabase, session_id: UUID
) -> RecordingSummary:
    async with _recording_access(mongo):
        return await _summary(mongo, str(session_id))


async def store_recording_chunk(
    mongo: AsyncDatabase,
    session_id: UUID,
    patient_id: UUID,
    clinic_id: UUID,
    body: RecordingChunkRequest,
) -> RecordingReceipt:
    payload = body.model_dump(mode="json")
    content_hash = hashlib.sha256(
        json.dumps(
            payload, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    ).hexdigest()
    session_key = str(session_id)
    chunk_filter = {"session_id": session_key, "chunk_id": str(body.chunk_id)}
    async with _recording_access(mongo):
        collection = mongo["recording_chunks"]
        existing = await collection.find_one(chunk_filter, _RECEIPT_PROJECTION)
        if existing is not None:
            return await _receipt(mongo, session_key, existing, content_hash)
        document = {
            **payload,
            "session_id": session_key,
            "patient_id": str(patient_id),
            "clinic_id": str(clinic_id),
            "seq": await _next_sequence(mongo, session_key),
            "frame_count": len(body.frames),
            "content_hash": content_hash,
            "stored_at": datetime.now(UTC),
        }
        try:
            await collection.insert_one(document)
        except DuplicateKeyError:
            existing = await collection.find_one(chunk_filter, _RECEIPT_PROJECTION)
            if existing is None:
                raise
            return await _receipt(mongo, session_key, existing, content_hash)
        return await _receipt(mongo, session_key, document, content_hash)


async def recording_chunks(
    mongo: AsyncDatabase, session_id: UUID, after_seq: int, limit: int
) -> RecordingPage:
    async with _recording_access(mongo):
        cursor = (
            mongo["recording_chunks"]
            .find(
                {"session_id": str(session_id), "seq": {"$gt": after_seq}},
                _STORED_PROJECTION,
            )
            .sort("seq", ASCENDING)
            .limit(limit + 1)
        )
        async with cursor:
            documents = await cursor.to_list(length=limit + 1)
        chunks = [
            StoredRecordingChunk.model_validate(document)
            for document in documents[:limit]
        ]
        return RecordingPage(
            chunks=chunks,
            next_after_seq=chunks[-1].seq if len(documents) > limit else None,
        )


async def recording_index(
    mongo: AsyncDatabase, session_id: UUID, after_seq: int, limit: int
) -> RecordingIndexPage:
    async with _recording_access(mongo):
        cursor = (
            mongo["recording_chunks"]
            .find(
                {"session_id": str(session_id), "seq": {"$gt": after_seq}},
                _INDEX_PROJECTION,
            )
            .sort("seq", ASCENDING)
            .limit(limit + 1)
        )
        chunks: list[RecordingIndexChunk] = []
        bounds: RecordingWorldBounds | None = None
        next_after_seq = None
        async with cursor:
            async for document in cursor:
                if len(chunks) == limit:
                    next_after_seq = chunks[-1].seq
                    break
                try:
                    frames = _INDEX_FRAMES.validate_python(document["frames"])
                    chunk = RecordingIndexChunk.model_validate(
                        {
                            **{
                                key: value
                                for key, value in document.items()
                                if key != "frames"
                            },
                            "first_elapsed_ms": frames[0].elapsed_ms,
                            "last_elapsed_ms": frames[-1].elapsed_ms,
                            "rep_boundaries": [
                                RecordingRepBoundary(
                                    frame_index=index, rep_number=frame.rep_number
                                )
                                for index, frame in enumerate(frames)
                                if frame.rep_boundary
                            ],
                        }
                    )
                    if chunk.frame_count != len(frames):
                        raise ValueError("Stored recording frame count is inconsistent.")
                    if any(
                        len(current.world_landmarks) != len(previous.world_landmarks)
                        or current.elapsed_ms < previous.elapsed_ms
                        or current.rep_number < previous.rep_number
                        for previous, current in zip(frames, frames[1:])
                    ):
                        raise ValueError("Stored recording frames are not ordered.")
                except (ValueError, KeyError, TypeError) as exc:
                    raise HTTPException(
                        status_code=503,
                        detail="Movement recording storage is unavailable.",
                    ) from exc
                chunks.append(chunk)
                for frame in frames:
                    is_hand = len(frame.world_landmarks) == 21
                    for point in frame.world_landmarks:
                        if not (isfinite(point.x) and isfinite(point.y)):
                            continue
                        if is_hand:
                            if not isfinite(point.z):
                                continue
                        elif not (
                            point.visibility >= 0.35
                            and (
                                "presence" not in point.model_fields_set
                                or point.presence is not None
                                and point.presence >= 0.35
                            )
                        ):
                            continue
                        if bounds is None:
                            bounds = RecordingWorldBounds(
                                min_x=point.x,
                                min_y=point.y,
                                max_x=point.x,
                                max_y=point.y,
                            )
                        else:
                            bounds.min_x = min(bounds.min_x, point.x)
                            bounds.min_y = min(bounds.min_y, point.y)
                            bounds.max_x = max(bounds.max_x, point.x)
                            bounds.max_y = max(bounds.max_y, point.y)
        return RecordingIndexPage(
            chunks=chunks, bounds=bounds, next_after_seq=next_after_seq
        )
