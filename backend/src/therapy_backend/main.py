import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .db import engine, mongo

log = logging.getLogger(__name__)

HEALTH_TIMEOUT_S = 3.0


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await mongo.close()
    await engine.dispose()


app = FastAPI(
    title="Therapy-In-Question API",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

api = APIRouter(prefix="/api")


async def _ping_postgres() -> None:
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))


async def _check(name: str, probe: Awaitable[object]) -> bool:
    try:
        await asyncio.wait_for(probe, HEALTH_TIMEOUT_S)
        return True
    except Exception:
        log.exception("Health check failed: %s", name)
        return False


@api.get("/health")
async def health() -> JSONResponse:
    tigerdata, mongodb = await asyncio.gather(
        _check("tigerdata", _ping_postgres()),
        _check("mongodb", mongo.admin.command("ping")),
    )
    healthy = tigerdata and mongodb
    return JSONResponse(
        {
            "status": "ok" if healthy else "degraded",
            "tigerdata": "ok" if tigerdata else "error",
            "mongodb": "ok" if mongodb else "error",
        },
        status_code=200 if healthy else 503,
    )


app.include_router(api)
