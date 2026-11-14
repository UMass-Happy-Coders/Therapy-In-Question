from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

mongo = AsyncMongoClient(settings.mongodb_uri, tz_aware=True)
recordings_db = mongo[settings.mongodb_db]


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def get_mongo() -> AsyncDatabase:
    return recordings_db


DB = Annotated[AsyncSession, Depends(get_db)]
Mongo = Annotated[AsyncDatabase, Depends(get_mongo)]
