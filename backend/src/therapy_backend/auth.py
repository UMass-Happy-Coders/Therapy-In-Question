from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, select
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection

from .config import get_settings
from .db import DB
from .models import AuthSession, Clinic, User

COOKIE_NAME = "tiq_session"
SESSION_TTL_SECONDS = 8 * 60 * 60
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "therapy-in-question"
JWT_AUDIENCE = "therapy-in-question-web"
PASSWORD_HASH = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$QlHAHoc6/J1iPDzb/w2MfA$"
    "/1VfCqb3svJS8gvIMcGogtSdCMSqsLUveWRLf1xXVj8"
)

router = APIRouter()


class LoginRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=254)]
    password: Annotated[str, Field(strict=True, min_length=1, max_length=1024)]

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            if len(value) > 254:
                raise ValueError("Email must be at most 254 characters.")
            return value.strip().lower()
        return value


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: Literal["therapist", "patient"]
    clinic_id: UUID
    clinic_name: str


class PatientResponse(BaseModel):
    id: UUID
    email: str
    full_name: str


def user_response(user: User, clinic_name: str) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        clinic_id=user.clinic_id,
        clinic_name=clinic_name,
    )


def decode_session(token: str | None) -> tuple[UUID, UUID] | None:
    if not token:
        return None
    try:
        claims = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={
                "require": ["sub", "sid", "iat", "exp"],
                "strict_aud": True,
            },
        )
        if (
            not isinstance(claims["sub"], str)
            or not isinstance(claims["sid"], str)
            or type(claims["iat"]) is not int
            or type(claims["exp"]) is not int
            or claims["exp"] <= claims["iat"]
        ):
            return None
        return UUID(claims["sub"]), UUID(claims["sid"])
    except (jwt.InvalidTokenError, ValueError, TypeError, OverflowError):
        return None


async def get_current_user(request: HTTPConnection, db: DB) -> UserResponse:
    identity = decode_session(request.cookies.get(COOKIE_NAME))
    if identity is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    user_id, session_id = identity
    result = await db.execute(
        select(User, Clinic.name)
        .join(Clinic, Clinic.id == User.clinic_id)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(
            User.id == user_id,
            AuthSession.id == session_id,
            AuthSession.expires_at > datetime.now(UTC),
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return user_response(row[0], row[1])


CurrentUser = Annotated[UserResponse, Depends(get_current_user)]


async def require_therapist(user: CurrentUser) -> UserResponse:
    if user.role != "therapist":
        raise HTTPException(status_code=403, detail="Therapist access required.")
    return user


CurrentTherapist = Annotated[UserResponse, Depends(require_therapist)]


async def require_csrf_header(
    requested_with: Annotated[
        str | None, Header(alias="X-Requested-With")
    ] = None,
) -> None:
    if requested_with != "TherapyInQuestion":
        raise HTTPException(status_code=403, detail="Invalid request header.")


@router.post(
    "/auth/login",
    response_model=UserResponse,
    dependencies=[Depends(require_csrf_header)],
)
async def login(body: LoginRequest, response: Response, db: DB) -> UserResponse:
    result = await db.execute(
        select(User, Clinic.name)
        .join(Clinic, Clinic.id == User.clinic_id)
        .where(User.email == str(body.email).lower())
    )
    row = result.one_or_none()
    password_hash = row[0].password_hash if row is not None else DUMMY_PASSWORD_HASH
    valid_password = await run_in_threadpool(
        PASSWORD_HASH.verify, body.password, password_hash
    )
    if row is None or not valid_password:
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    user, clinic_name = row
    now = datetime.now(UTC).replace(microsecond=0)
    expires_at = now + timedelta(seconds=SESSION_TTL_SECONDS)
    session_id = uuid4()
    token = jwt.encode(
        {
            "sub": str(user.id),
            "sid": str(session_id),
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        },
        get_settings().jwt_secret,
        algorithm=JWT_ALGORITHM,
    )
    db.add(AuthSession(id=session_id, user_id=user.id, expires_at=expires_at))
    await db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_TTL_SECONDS,
        expires=expires_at,
        path="/",
        secure=get_settings().cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return user_response(user, clinic_name)


@router.post(
    "/auth/logout",
    status_code=204,
    dependencies=[Depends(require_csrf_header)],
)
async def logout(request: Request, db: DB) -> Response:
    identity = decode_session(request.cookies.get(COOKIE_NAME))
    if identity is not None:
        user_id, session_id = identity
        await db.execute(
            delete(AuthSession).where(
                AuthSession.id == session_id, AuthSession.user_id == user_id
            )
        )
        await db.commit()
    response = Response(status_code=204)
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        secure=get_settings().cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/auth/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return user


@router.get("/therapist/patients", response_model=list[PatientResponse])
async def patients(user: CurrentTherapist, db: DB) -> list[PatientResponse]:
    result = await db.execute(
        select(User)
        .where(User.clinic_id == user.clinic_id, User.role == "patient")
        .order_by(User.full_name, User.id)
    )
    return [
        PatientResponse(id=patient.id, email=patient.email, full_name=patient.full_name)
        for patient in result.scalars()
    ]
