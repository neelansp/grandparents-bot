# Routes for browsing, selecting, and booking workout classes.
#
# The heavy lifting (talking to Upace) lives in booking.py. These route
# functions just translate HTTP requests into calls to that module.

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from booking import (
    VENUE_TIMEZONE,
    book_selected_classes,
    compute_reservation_open_at,
    fetch_booked_classes,
    fetch_classes_for_date,
)
from database import SelectedClass, get_db
from schemas import BookingRequest, SelectedClassCreate, SelectedClassResponse


router = APIRouter(prefix="/classes", tags=["classes"])


@router.get("/available/{account_id}")
def get_available_classes(account_id: str, date: str, db: Session = Depends(get_db)):
    """List the classes Upace offers for this account on the given date."""
    try:
        classes = fetch_classes_for_date(db, account_id, date)
        return {"date": date, "classes": classes}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/booked/{account_id}")
def get_booked_classes(account_id: str, db: Session = Depends(get_db)):
    """List this account's upcoming Upace reservations."""
    try:
        bookings = fetch_booked_classes(db, account_id)
        return {"bookings": bookings}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/select", response_model=SelectedClassResponse)
def select_class(selected: SelectedClassCreate, db: Session = Depends(get_db)):
    """Save a class the user wants to attend."""

    # Don't let the same class get picked twice on the same day.
    existing = db.query(SelectedClass).filter(
        SelectedClass.account_id == selected.account_id,
        SelectedClass.class_id == selected.class_id,
        SelectedClass.day == selected.day,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Class already selected for that day")

    # If the T-5 day window has already passed, mark it "manual" so the
    # scheduler skips it (the user has to click "Reserve Now" themselves).
    open_at = compute_reservation_open_at(selected.day, selected.time)
    if open_at and open_at > datetime.now(tz=VENUE_TIMEZONE):
        initial_status = "scheduled"
    else:
        initial_status = "manual"

    new_selection = SelectedClass(
        id=str(uuid.uuid4()),
        account_id=selected.account_id,
        class_id=selected.class_id,
        class_name=selected.class_name,
        day=selected.day,
        time=selected.time,
        instructor=selected.instructor,
        slot_id=selected.slot_id,
        status=initial_status,
    )
    db.add(new_selection)
    db.commit()
    db.refresh(new_selection)
    return new_selection


@router.get("/selected/{account_id}", response_model=list[SelectedClassResponse])
def get_selected_classes(account_id: str, db: Session = Depends(get_db)):
    """List every class this account has picked."""
    return db.query(SelectedClass).filter(
        SelectedClass.account_id == account_id,
    ).order_by(SelectedClass.day.asc(), SelectedClass.time.asc()).all()


@router.delete("/selected/{selection_id}")
def deselect_class(selection_id: str, db: Session = Depends(get_db)):
    """Remove a selected class."""
    selection = db.query(SelectedClass).filter(SelectedClass.id == selection_id).first()
    if not selection:
        raise HTTPException(status_code=404, detail="Selection not found")

    db.delete(selection)
    db.commit()
    return {"message": "Class deselected"}


@router.post("/book/{account_id}")
def book_classes(
    account_id: str,
    booking_request: BookingRequest,
    db: Session = Depends(get_db),
):
    """Book classes on Upace right now (bypasses the T-5 day scheduler)."""
    try:
        results = book_selected_classes(db, account_id, booking_request.selection_ids)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {"account_id": account_id, "bookings": results}
