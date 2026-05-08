# This file is where the "book a class" logic lives.
#
# The routes (routes/classes.py) and the scheduler (scheduler.py) both call
# into this file. That way the rules for "when is a class due?" and "how do
# we log into Upace?" only live in one place.

import logging

import os
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from database import Account, BookingHistory, SelectedClass
from upace import UpaceClient


logger = logging.getLogger(__name__)

# Dedicated logger for booking outcomes. This one writes to the
# bookings file (configured in main.py) so the file only ever contains
# one line per booking attempt — easy to scan.
booking_log = logging.getLogger("bookings")


# Upace opens reservations exactly 5 days before class start.
RESERVATION_LEAD_DAYS = 5

# The venue's timezone. Class times from Upace are in this timezone, so we
# pin our calculations to it instead of trusting the host system's clock.
# ZoneInfo handles DST automatically. Override via VENUE_TIMEZONE env var.
VENUE_TIMEZONE = ZoneInfo(os.getenv("VENUE_TIMEZONE", "America/New_York"))

# The different time formats Upace might send us.
TIME_FORMATS = ["%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M:%S %p"]


def parse_class_datetime(day, time):
    """Turn a day + time string into a timezone-aware datetime in the venue's local time.

    Returns None if unparseable. The result carries VENUE_TIMEZONE so comparisons
    against the current time are correct regardless of the host system's clock.
    """
    if not day or not time:
        return None

    for fmt in TIME_FORMATS:
        try:
            naive = datetime.strptime(f"{day.strip()} {time.strip()}", f"%Y-%m-%d {fmt}")
            return naive.replace(tzinfo=VENUE_TIMEZONE)
        except ValueError:
            continue
    return None


def compute_reservation_open_at(day, time):
    """Return the moment when Upace opens reservations for this class (T - 5 days).

    We subtract 5 *calendar days* in venue local time, not 5 * 24 hours of absolute
    time. This matters across DST transitions: a class at 8:30 AM EDT booked from
    a window that opens 5 days earlier in EST should open at 8:30 AM EST, not at
    7:30 or 9:30. Doing the math with the timezone stripped gives wall-clock
    subtraction; re-attaching VENUE_TIMEZONE then resolves the correct UTC offset
    for that calendar date.
    """
    class_dt = parse_class_datetime(day, time)
    if class_dt is None:
        return None
    naive_open = class_dt.replace(tzinfo=None) - timedelta(days=RESERVATION_LEAD_DAYS)
    return naive_open.replace(tzinfo=VENUE_TIMEZONE)


def is_error_response(response):
    """Upace returns error=0 on success. Anything else means something went wrong."""
    return response.get("error") not in (None, 0, "0")


def login_to_upace(db, account):
    """Log into Upace with this account's saved password.

    On success, updates the account's api_key and user_login_key in the DB
    so future calls don't need to log in again. Returns True/False.
    """
    if not account.upace_password:
        return False

    upace = UpaceClient()
    try:
        # Step 1: look up the user by email.
        check = upace.check_user(account.email)
        if is_error_response(check) and "function" not in check:
            return False

        user_login_key = check.get("user_login_key")
        if not user_login_key:
            return False

        # Step 2: submit the password.
        login = upace.login_user(user_login_key, account.upace_password)
        if is_error_response(login):
            return False

        # Save the keys Upace gave us so we can reuse them.
        account.name = login.get("user_name") or account.name
        account.api_key = login.get("api_key")
        account.user_login_key = user_login_key
        account.barcode = login.get("barcode")
        db.commit()
        return True
    finally:
        upace.close()


def make_upace_client_for_account(account):
    """Create an UpaceClient already set up with this account's keys."""
    client = UpaceClient()
    client.api_key = account.api_key
    client.user_login_key = account.user_login_key
    return client


def fetch_classes_for_date(db, account_id, date):
    """Get the list of available classes from Upace for a given date."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return []

    # If we don't have fresh keys, log in first.
    if not account.api_key and not login_to_upace(db, account):
        return []

    upace = make_upace_client_for_account(account)
    try:
        response = upace.get_classes(date)

        # If the api_key expired, log in again and retry once.
        if is_error_response(response):
            if not login_to_upace(db, account):
                return []
            upace.api_key = account.api_key
            response = upace.get_classes(date)
            if is_error_response(response):
                return []

        class_list = response.get("class_index", [])
        result = []
        for cls in class_list:
            first = (cls.get("instructor_first_name") or "").strip()
            last = (cls.get("instructor_last_name") or "").strip()
            instructor = f"{first} {last}".strip() or "TBD"

            result.append({
                "id": cls.get("id"),
                "name": (cls.get("name") or "").strip(),
                "slot_id": cls.get("slot_id"),
                "day": date,
                "time": cls.get("start_time"),
                "instructor": instructor,
                "spots_available": int(cls.get("spots_available", 0)),
            })
        return result
    finally:
        upace.close()


def fetch_booked_classes(db, account_id):
    """Get the user's upcoming reservations from Upace."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return []

    if not account.api_key and not login_to_upace(db, account):
        return []

    upace = make_upace_client_for_account(account)
    try:
        response = upace.get_my_reservations()

        if is_error_response(response):
            if not login_to_upace(db, account):
                return []
            upace.api_key = account.api_key
            response = upace.get_my_reservations()
            if is_error_response(response):
                return []

        reservations = response.get("class_reservations") or []
        result = []
        for item in reservations:
            # Skip reservations the user already cancelled.
            cancelled_info = item.get("is_cancelled") or {}
            if cancelled_info.get("cancelled"):
                continue

            first = (item.get("instructor_first_name") or "").strip()
            last = (item.get("instructor_last_name") or "").strip()
            instructor = f"{first} {last}".strip() or "TBD"

            result.append({
                "id": item.get("id"),
                "class_id": item.get("class_id"),
                "slot_id": item.get("slot_id"),
                "name": (item.get("name") or "").strip(),
                "day": item.get("r_date"),
                "time": item.get("reservation_start_time"),
                "end_time": item.get("reservation_end_time"),
                "instructor": instructor,
                "room_name": item.get("room_name"),
                "wait_position": item.get("wait_position") or "",
                "waitlist_id": item.get("waitlist_id") or "",
            })
        return result
    finally:
        upace.close()


def book_selected_classes(db, account_id, selection_ids=None):
    """Book the given selections on Upace. If selection_ids is empty, book all."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise ValueError("Account not found")

    if not login_to_upace(db, account):
        raise RuntimeError("Could not log into Upace")

    # Figure out which selections to book.
    query = db.query(SelectedClass).filter(SelectedClass.account_id == account_id)
    if selection_ids:
        query = query.filter(SelectedClass.id.in_(selection_ids))
    selections = query.order_by(SelectedClass.day.asc(), SelectedClass.time.asc()).all()

    upace = make_upace_client_for_account(account)
    results = []

    try:
        for cls in selections:
            # Skip anything we've already booked.
            if cls.status == "booked":
                results.append({
                    "selection_id": cls.id,
                    "class_id": cls.class_id,
                    "class_name": cls.class_name,
                    "day": cls.day,
                    "success": True,
                    "message": cls.last_message or "Already booked",
                    "skipped": True,
                })
                continue

            # Try to book it.
            response = upace.reserve_class(
                user_id=account.user_login_key or "",
                class_id=cls.class_id,
                slot_id=cls.slot_id,
                date=cls.day,
            )

            # If the api_key expired, log in again and retry once.
            if is_error_response(response) and login_to_upace(db, account):
                upace.api_key = account.api_key
                response = upace.reserve_class(
                    user_id=account.user_login_key or "",
                    class_id=cls.class_id,
                    slot_id=cls.slot_id,
                    date=cls.day,
                )

            success = not is_error_response(response)
            message = response.get("message")

            # One line per attempt → bookings log file. This is the
            # only thing that file ever contains, so it's easy to scan.
            if success:
                booking_log.info(
                    "BOOKED  %s on %s %s for %s — %s",
                    cls.class_name,
                    cls.day,
                    cls.time,
                    account.name,
                    message or "ok",
                )
            else:
                booking_log.warning(
                    "FAILED  %s on %s %s for %s — %s",
                    cls.class_name,
                    cls.day,
                    cls.time,
                    account.name,
                    message or "unknown error",
                )

            # Record the attempt in booking_history.
            db.add(BookingHistory(
                id=str(uuid.uuid4()),
                account_id=account_id,
                class_id=cls.class_id,
                class_name=cls.class_name,
                success=success,
                message=message,
            ))

            # Update the selection row's status. The DB column is a naive
            # DateTime, so we store venue-local wall-clock time (with the tz
            # stripped) to keep stored values consistent across host timezones.
            cls.status = "booked" if success else "failed"
            cls.attempted_at = datetime.now(tz=VENUE_TIMEZONE).replace(tzinfo=None)
            cls.last_message = message

            results.append({
                "selection_id": cls.id,
                "class_id": cls.class_id,
                "class_name": cls.class_name,
                "day": cls.day,
                "success": success,
                "message": message,
            })

        db.commit()
        return results
    finally:
        upace.close()


def find_due_selection_ids(db, account_id):
    """Return ids of 'scheduled' selections whose T-5 day window has opened."""
    now = datetime.now(tz=VENUE_TIMEZONE)
    candidates = db.query(SelectedClass).filter(
        SelectedClass.account_id == account_id,
        SelectedClass.status == "scheduled",
    ).all()

    due = []
    for cls in candidates:
        open_at = compute_reservation_open_at(cls.day, cls.time)
        if open_at is not None and open_at <= now:
            due.append(cls.id)
    return due
