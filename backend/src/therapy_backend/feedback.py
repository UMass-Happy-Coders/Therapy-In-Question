import asyncio
import json
import math
from collections import OrderedDict
from time import monotonic
from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from google.genai import errors, types
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.exc import SQLAlchemyError

from .auth import get_current_user
from .config import get_settings
from .db import DB
from .gemini import client
from .programs import CurrentPatient, require_patient
from .sessions import require_session_detail

router = APIRouter()

INTERVAL_MS = 30_000
MAX_PAYLOAD_CHARS = 2048
MAX_COOLDOWNS = 4096
MAX_MODEL_CALLS = 4
MODEL_TIMEOUT_SECONDS = 10
RECEIVE_TIMEOUT_SECONDS = 90
UNAVAILABLE_DETAIL = "Encouragement is unavailable. Instant cues still work."
APPROVED_MESSAGES = {
    "effort": "Your effort today counts.",
    "focus": "Keep your focus on this movement.",
    "one_rep": "Take this set one rep at a time.",
    "progress": "Every completed rep counts toward this set.",
    "patience": "Give each repetition your attention.",
}

_cooldowns: OrderedDict[UUID, float] = OrderedDict()
_active_model_calls = 0


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["feedback"]
    request_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    set_ordinal: Annotated[int, Field(ge=0, le=119)]
    reps_completed: Annotated[int, Field(ge=0, le=1000)]
    elapsed_ms: Annotated[int, Field(ge=0, le=86_400_000)]
    phase: Literal["rest", "raise", "hold", "lower"]


class CueSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    cue: Literal["effort", "focus", "one_rep", "progress", "patience"]


def _valid_origin(websocket: WebSocket) -> bool:
    origins = websocket.headers.getlist("origin")
    hosts = websocket.headers.getlist("host")
    if len(origins) != 1 or len(hosts) != 1 or not hosts[0]:
        return False
    scheme = "https" if get_settings().cookie_secure else "http"
    return origins[0] == f"{scheme}://{hosts[0]}"


def _reserve_cooldown(patient_id: UUID) -> int | None:
    now = monotonic()
    while _cooldowns:
        key, expires = next(iter(_cooldowns.items()))
        if expires > now:
            break
        _cooldowns.pop(key)
    expires = _cooldowns.get(patient_id)
    if expires is not None:
        return max(1, min(INTERVAL_MS, math.ceil((expires - now) * 1000)))
    if len(_cooldowns) >= MAX_COOLDOWNS:
        return None
    _cooldowns[patient_id] = now + INTERVAL_MS / 1000
    return 0


async def _authorized_context(
    websocket: WebSocket, db: DB, session_id: UUID, ordinal: int | None
) -> dict[str, str | int | float]:
    try:
        user = await require_patient(await get_current_user(websocket, db))
        detail = await require_session_detail(db, user, session_id)
        expected_ordinal = len(detail.sets)
        if detail.status != "in_progress" or (
            ordinal is not None and ordinal != expected_ordinal
        ):
            raise HTTPException(status_code=403, detail="Feedback is not available.")
        remaining = expected_ordinal
        for exercise in detail.program.exercises:
            if remaining < exercise.sets:
                return {
                    "exercise_type": exercise.exercise_type,
                    "target_reps": exercise.reps,
                    "target_angle": exercise.target_angle,
                    "hold_seconds": exercise.hold_seconds,
                    "set_number": remaining + 1,
                }
            remaining -= exercise.sets
        raise HTTPException(status_code=403, detail="Feedback is not available.")
    finally:
        await db.rollback()


async def _select_encouragement(
    context: dict[str, str | int | float], sample: FeedbackRequest
) -> str | None:
    global _active_model_calls
    if _active_model_calls >= MAX_MODEL_CALLS:
        return None
    _active_model_calls += 1
    try:
        payload = {
            **context,
            "phase": sample.phase,
            "reps_completed": sample.reps_completed,
            "elapsed_ms": sample.elapsed_ms,
        }
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=get_settings().gemini_model,
                contents=json.dumps(payload, separators=(",", ":")),
                config=types.GenerateContentConfig(
                    system_instruction=(
                        "Select one encouragement cue for the exercise sample. "
                        "Return only JSON matching the schema. Do not diagnose, "
                        "give medical advice or movement instructions, or change targets."
                    ),
                    response_mime_type="application/json",
                    response_schema=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "cue": types.Schema(
                                type=types.Type.STRING, enum=list(APPROVED_MESSAGES)
                            )
                        },
                        required=["cue"],
                    ),
                    candidate_count=1,
                    max_output_tokens=256,
                    temperature=0.2,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                    http_options=types.HttpOptions(
                        timeout=MODEL_TIMEOUT_SECONDS * 1000,
                        retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                ),
            ),
            timeout=MODEL_TIMEOUT_SECONDS,
        )
        if (
            not response.candidates
            or len(response.candidates) != 1
            or response.candidates[0].finish_reason != types.FinishReason.STOP
        ):
            return None
        text = response.text
        if text is None:
            return None
        selection = CueSelection.model_validate_json(text)
        return APPROVED_MESSAGES[selection.cue]
    except (errors.APIError, httpx.HTTPError, TimeoutError, ValidationError):
        return None
    finally:
        _active_model_calls -= 1


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except (WebSocketDisconnect, RuntimeError):
        return


@router.websocket("/patient/sessions/{session_id}/feedback")
async def feedback(
    websocket: WebSocket, session_id: UUID, user: CurrentPatient, db: DB
) -> None:
    try:
        if not _valid_origin(websocket):
            await db.rollback()
            await _close(websocket, 1008)
            return
        await _authorized_context(websocket, db, session_id, None)
        await websocket.accept()
        await websocket.send_json({"type": "ready", "interval_ms": INTERVAL_MS})
        while True:
            try:
                frame = await asyncio.wait_for(
                    websocket.receive(), timeout=RECEIVE_TIMEOUT_SECONDS
                )
            except TimeoutError:
                await _close(websocket, 1000)
                return
            if frame["type"] == "websocket.disconnect":
                return
            text = frame.get("text")
            if text is None:
                code = 1009 if len(frame.get("bytes") or b"") > MAX_PAYLOAD_CHARS else 1008
                await _close(websocket, code)
                return
            if len(text) > MAX_PAYLOAD_CHARS:
                await _close(websocket, 1009)
                return
            try:
                sample = FeedbackRequest.model_validate_json(text)
            except ValidationError:
                await _close(websocket, 1008)
                return
            context = await _authorized_context(
                websocket, db, session_id, sample.set_ordinal
            )
            retry_after_ms = _reserve_cooldown(user.id)
            if retry_after_ms:
                await websocket.send_json(
                    {
                        "type": "cooldown",
                        "request_id": sample.request_id,
                        "retry_after_ms": retry_after_ms,
                    }
                )
                continue
            if retry_after_ms is None:
                message = None
            else:
                message = await _select_encouragement(context, sample)
            await _authorized_context(websocket, db, session_id, sample.set_ordinal)
            if message is None:
                await websocket.send_json(
                    {
                        "type": "unavailable",
                        "request_id": sample.request_id,
                        "detail": UNAVAILABLE_DETAIL,
                    }
                )
            else:
                await websocket.send_json(
                    {
                        "type": "encouragement",
                        "request_id": sample.request_id,
                        "message": message,
                    }
                )
    except WebSocketDisconnect:
        return
    except HTTPException:
        await _close(websocket, 1008)
    except (SQLAlchemyError, ValidationError, RuntimeError, OSError):
        await _close(websocket, 1011)
