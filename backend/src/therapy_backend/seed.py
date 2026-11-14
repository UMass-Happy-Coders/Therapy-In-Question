import asyncio
from importlib.resources import files
from uuid import UUID, uuid4

from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.concurrency import run_in_threadpool

from .config import get_settings
from .models import Clinic, User

DEMO_CLINIC_ID = UUID("6ae1cb1e-7586-4ee0-bd61-95548a955b05")
DEMO_PASSWORD = "demo"
DEMO_USERS = (
    ("therapist@example.com", "Savar Shrestha", "therapist"),
    ("patient@example.com", "TJ Raklovits", "patient"),
)
PASSWORD_HASH = PasswordHash.recommended()


async def seed_demo(session: AsyncSession) -> list[str]:
    await session.execute(
        insert(Clinic)
        .values(id=DEMO_CLINIC_ID, name="Question Clinic")
        .on_conflict_do_nothing(index_elements=[Clinic.id])
    )
    created = []
    for email, full_name, role in DEMO_USERS:
        existing = await session.scalar(select(User.id).where(User.email == email))
        if existing is not None:
            continue
        password_hash = await run_in_threadpool(PASSWORD_HASH.hash, DEMO_PASSWORD)
        inserted = await session.scalar(
            insert(User)
            .values(
                id=uuid4(),
                clinic_id=DEMO_CLINIC_ID,
                email=email,
                full_name=full_name,
                role=role,
                password_hash=password_hash,
            )
            .on_conflict_do_nothing(index_elements=[User.email])
            .returning(User.email)
        )
        if inserted is not None:
            created.append(inserted)
    return created


async def initialize_and_seed() -> list[str]:
    engine = create_async_engine(get_settings().database_url)
    try:
        sql = files("therapy_backend").joinpath("init.sql").read_text(encoding="utf-8")
        async with engine.connect() as connection:
            raw = await connection.get_raw_connection()
            await raw.driver_connection.execute(sql)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session, session.begin():
            created = await seed_demo(session)
        return created
    finally:
        await engine.dispose()


def main() -> None:
    created = asyncio.run(initialize_and_seed())
    for email in created:
        print(f"Created demo account: {email} | password: {DEMO_PASSWORD}")
    if not created:
        print("Demo seed complete; no new demo accounts.")


if __name__ == "__main__":
    main()
