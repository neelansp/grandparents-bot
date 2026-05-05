# This file defines the JSON shapes for what the API sends and receives.
#
# These are NOT the database tables (those are in database.py). These are
# the shapes for HTTP requests and responses. We keep them separate so that
# internal DB columns never leak out over the network.

from datetime import datetime

from pydantic import BaseModel


class AccountResponse(BaseModel):
    id: str
    name: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


class SelectedClassCreate(BaseModel):
    account_id: str
    class_id: str
    class_name: str
    day: str
    time: str
    instructor: str
    slot_id: str


class SelectedClassResponse(BaseModel):
    id: str
    account_id: str
    class_id: str
    class_name: str
    day: str
    time: str
    instructor: str
    slot_id: str
    status: str
    attempted_at: datetime | None = None
    last_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class BookingRequest(BaseModel):
    selection_ids: list[str] = []


class ClassPresetCreate(BaseModel):
    class_name: str
    day_of_week: str


class ClassPresetResponse(BaseModel):
    id: str
    account_id: str
    class_name: str
    day_of_week: str
    created_at: datetime

    class Config:
        from_attributes = True
