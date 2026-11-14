import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pymongo import ASCENDING, IndexModel, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError, PyMongoError

from .recording_schemas import (
    RecordingChunkRequest,
    RecordingPage,
    RecordingReceipt,
    RecordingSummary,
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
