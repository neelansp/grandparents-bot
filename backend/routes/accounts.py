# Routes for listing the grandparent accounts.
#
# There is no login — anyone on the LAN can see the list and pick one.

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import Account, get_db
from schemas import AccountResponse


router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountResponse], include_in_schema=False)
@router.get("/", response_model=list[AccountResponse])
def list_accounts(db: Session = Depends(get_db)):
    """Return every account (grandparent) that's been seeded from .env."""
    return db.query(Account).all()
