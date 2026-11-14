import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from starlette.middleware.base import RequestResponseEndpoint

from .auth import router as auth_router
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
api.include_router(auth_router)


@app.middleware("http")
async def no_store_auth(
    request: Request, call_next: RequestResponseEndpoint
) -> Response:
    response = await call_next(request)
    if request.url.path.startswith(("/api/auth/", "/api/therapist/")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def internal_error(request: Request, exc: Exception) -> Response:
    return PlainTextResponse(
        "Internal Server Error",
        status_code=500,
        headers={"Cache-Control": "no-store"},
    )


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
