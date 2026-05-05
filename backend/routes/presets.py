# Routes for the per-account "weekly class preset".
#
# A preset is a list of (class_name, day_of_week) pairs. When the user
# clicks "Apply Preset" on the planner, the frontend looks at the week
# being shown, finds the earliest class for each preset entry, and adds
# them as selections. Match is by class name only — instructor and time
# don't have to line up.

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import ClassPreset, get_db
from schemas import ClassPresetCreate, ClassPresetResponse


router = APIRouter(prefix="/presets", tags=["presets"])


VALID_DAYS = {
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
}


@router.get("/{account_id}", response_model=list[ClassPresetResponse])
def list_preset(account_id: str, db: Session = Depends(get_db)):
    """Return every preset entry for one account."""
    return db.query(ClassPreset).filter(
        ClassPreset.account_id == account_id,
    ).order_by(ClassPreset.day_of_week.asc(), ClassPreset.class_name.asc()).all()


@router.post("/{account_id}", response_model=ClassPresetResponse)
def add_preset_entry(
    account_id: str,
    entry: ClassPresetCreate,
    db: Session = Depends(get_db),
):
    """Add a class to this account's preset."""
    if entry.day_of_week not in VALID_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"day_of_week must be one of {sorted(VALID_DAYS)}",
        )

    # Same class twice on the same day is meaningless — block it.
    existing = db.query(ClassPreset).filter(
        ClassPreset.account_id == account_id,
        ClassPreset.class_name == entry.class_name,
        ClassPreset.day_of_week == entry.day_of_week,
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="That class is already in the preset for that day",
        )

    new_entry = ClassPreset(
        id=str(uuid.uuid4()),
        account_id=account_id,
        class_name=entry.class_name,
        day_of_week=entry.day_of_week,
    )
    db.add(new_entry)
    db.commit()
    db.refresh(new_entry)
    return new_entry


@router.delete("/{preset_id}")
def delete_preset_entry(preset_id: str, db: Session = Depends(get_db)):
    """Remove a class from the preset."""
    entry = db.query(ClassPreset).filter(ClassPreset.id == preset_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Preset entry not found")

    db.delete(entry)
    db.commit()
    return {"message": "Preset entry removed"}
