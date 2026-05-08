# This file talks to the gym's Upace website.
#
# Upace has a mobile API. We mimic the same calls the mobile app makes:
#   1. CheckTheUser     -> give an email, get back a "user_login_key"
#   2. LoginTheUser     -> give the key + password, get back an api_key
#   3. upaceClasses     -> list the classes on a day
#   4. upaceMyReservations -> list the user's upcoming bookings
#   5. ReserveClass     -> book a class
#
# Nothing in this file knows about our database. It just makes HTTP calls.

import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx


BASE_URL = "https://www.upaceapp.com/Api"
UID = "110"

# Same venue timezone as booking.py — duplicated here to avoid a circular
# import (booking.py already imports from this file).
VENUE_TIMEZONE = ZoneInfo(os.getenv("VENUE_TIMEZONE", "America/New_York"))


class UpaceClient:
    def __init__(self):
        # Upace can be slow to respond around the T-5 reservation window
        # (everyone hits the API at once). httpx's 5s default was too tight.
        self.client = httpx.Client(timeout=20.0)
        self.api_key = None
        self.user_login_key = None

    def close(self):
        self.client.close()

    def check_user(self, email):
        """Step 1 of login: submit an email, get back a login key."""
        response = self.client.post(
            f"{BASE_URL}/CheckTheUser",
            data={"email": email, "password": "", "uid": UID},
        )
        return response.json()

    def login_user(self, user_login_key, password):
        """Step 2 of login: submit the key + password, get an api_key."""
        response = self.client.post(
            f"{BASE_URL}/LoginTheUser",
            data={
                "user_login_key": user_login_key,
                "email": "",
                "password": password,
                "app": "true",
            },
        )
        result = response.json()

        # If login worked, remember the keys so other calls can use them.
        if result.get("error") == 0:
            self.api_key = result.get("api_key")
            self.user_login_key = user_login_key
        return result

    def get_classes(self, date):
        """Get the list of classes on a given date (e.g. '2026-05-01')."""
        if not self.api_key:
            return {"error": 1, "message": "Not logged in"}

        # The mobile app sends the current time with this request so the
        # server knows which classes have already started. We do the same.
        # Must be venue-local time (Upace's frame of reference), not host
        # local time — they can differ on a UTC container.
        current_time = datetime.now(tz=VENUE_TIMEZONE).strftime("%H:%M:%S")

        response = self.client.post(
            f"{BASE_URL}/upaceClasses",
            data={
                "uid": UID,
                "api_key": self.api_key,
                "class_type": "class",
                "date": date,
                "time": current_time,
                "gym_id": "0",
            },
        )
        return response.json()

    def get_my_reservations(self):
        """Get the user's upcoming reservations from Upace."""
        if not self.api_key:
            return {"error": 1, "message": "Not logged in"}

        response = self.client.post(
            f"{BASE_URL}/upaceMyReservations",
            data={"uid": UID, "api_key": self.api_key},
        )
        return response.json()

    def reserve_class(self, user_id, class_id, slot_id, date):
        """Book a class."""
        if not self.api_key:
            return {"error": 1, "message": "Not logged in"}

        response = self.client.post(
            f"{BASE_URL}/ReserveClass",
            data={
                "user_id": user_id,
                "uid": UID,
                "api_key": self.api_key,
                "class_id": class_id,
                "slot_id": slot_id,
                "date": date,
                "class_type": "live",
            },
        )
        return response.json()
