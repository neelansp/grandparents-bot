# This file runs a background timer that auto-books classes when their
# reservation window opens (5 days before class start).
#
# Every few seconds, it looks at each account, finds any "scheduled"
# selections whose T-5 day window has opened, and tries to book them.

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from booking import book_selected_classes, find_due_selection_ids
from database import Account, SessionLocal


logger = logging.getLogger(__name__)

# How often to check for due classes. 5 seconds is fine — it's just a
# database query, so checking often doesn't cost much.
SCAN_INTERVAL_SECONDS = 5


def scan_and_book_due_classes():
    """Find classes whose booking window has opened and book them."""
    db = SessionLocal()
    try:
        for account in db.query(Account).all():
            due_ids = find_due_selection_ids(db, account.id)
            if not due_ids:
                continue

            logger.info("Auto-booking %d class(es) for %s", len(due_ids), account.name)
            # Per-class outcomes are logged inside book_selected_classes
            # (via the "bookings" logger → bookings log file). No need to
            # repeat them here.
            try:
                book_selected_classes(db, account.id, due_ids)
            except Exception as exc:
                logger.error("Auto-book failed for %s: %s", account.name, exc)
    finally:
        db.close()


def start_scheduler():
    """Start the background scheduler when the app boots."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        scan_and_book_due_classes,
        "interval",
        seconds=SCAN_INTERVAL_SECONDS,
        id="scan_due_classes",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("Scheduler started — checking every %d seconds", SCAN_INTERVAL_SECONDS)
    return scheduler
