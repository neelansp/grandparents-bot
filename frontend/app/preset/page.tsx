"use client";

// Configure-preset page.
//
// Each account has one "weekly preset" — a list of (class_name, day) pairs.
// On this page the user picks which classes belong in their preset for each
// day of the week. When they click "Apply Preset" on the planner, the system
// finds the earliest available class with that name on that day and adds
// it as a selection.
//
// Match is by NAME ONLY. We dedupe the visible class list by name+day so
// the user picks the *class* (not a specific time slot).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AccountSwitcher from "@/components/AccountSwitcher";
import DayTabs from "@/components/DayTabs";
import SearchBar from "@/components/SearchBar";
import { useAccounts } from "@/lib/accountStore";
import { useClasses } from "@/lib/classStore";
import {
  addPresetEntry,
  deletePresetEntry,
  getPreset,
  type PresetEntryResponse,
} from "@/lib/api";


const daysOfWeek = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];


function formatDateForApi(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function getWeekStart(today: Date) {
  const day = today.getDay();
  const weekStart = new Date(today);
  if (day === 0) {
    weekStart.setDate(today.getDate() + 1);
  } else {
    weekStart.setDate(today.getDate() - (day - 1));
  }
  return weekStart;
}


// We always look at NEXT week (weekOffset = 1) on this page. The current
// week is incomplete — earlier weekdays are in the past and the gym won't
// return them, and today's classes that already started are filtered out
// too. Next week always has a full 7-day schedule, which is what the
// preset is meant to plan against.
const PRESET_WEEK_OFFSET = 1;


function getDateForDay(dayName: string) {
  const dayIndex = daysOfWeek.indexOf(dayName);
  const weekStart = getWeekStart(new Date());
  weekStart.setDate(weekStart.getDate() + PRESET_WEEK_OFFSET * 7);
  const targetDate = new Date(weekStart);
  targetDate.setDate(weekStart.getDate() + Math.max(dayIndex, 0));
  return targetDate;
}


// Turn "5:30 PM" or "17:30" into a comparable number (minutes since midnight).
// We pick the earliest time among classes with the same name.
function parseTimeToMinutes(time: string): number {
  const ampm = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const hhmm = time.match(/^(\d+):(\d+)/);
  if (hhmm) {
    return parseInt(hhmm[1], 10) * 60 + parseInt(hhmm[2], 10);
  }
  return Number.MAX_SAFE_INTEGER;
}


export default function PresetPage() {
  const {
    currentAccount,
    authenticatedAccounts,
    initialized,
    loading: accountLoading,
    error: accountError,
    switchAccount,
  } = useAccounts();
  const {
    availableClasses,
    loading: classesLoading,
    error: classesError,
    fetchAvailableClassesForWeek,
  } = useClasses();

  const [preset, setPreset] = useState<PresetEntryResponse[]>([]);
  const [presetErrors, setPresetErrors] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState("Monday");
  const [searchTerm, setSearchTerm] = useState("");

  const accountId =
    currentAccount?.id ?? authenticatedAccounts[0]?.id ?? "";

  // Pull NEXT week's classes — see PRESET_WEEK_OFFSET note above.
  useEffect(() => {
    if (!accountId) return;
    fetchAvailableClassesForWeek(accountId, PRESET_WEEK_OFFSET);
  }, [accountId, fetchAvailableClassesForWeek]);

  // Fetch the saved preset for this account.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    getPreset(accountId)
      .then((entries) => {
        if (!cancelled) setPreset(entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load preset";
        setPresetErrors((prev) => [...prev, message]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Classes for the selected day, deduped by name (keep earliest time).
  const dedupedClasses = useMemo(() => {
    const targetDate = formatDateForApi(getDateForDay(selectedDay));
    const onThisDay = availableClasses.filter((c) => c.day === targetDate);

    const byName = new Map<string, typeof onThisDay[number]>();
    for (const cls of onThisDay) {
      const existing = byName.get(cls.name);
      if (!existing || parseTimeToMinutes(cls.time) < parseTimeToMinutes(existing.time)) {
        byName.set(cls.name, cls);
      }
    }

    const term = searchTerm.toLowerCase();
    return [...byName.values()].filter((c) => c.name.toLowerCase().includes(term));
  }, [availableClasses, selectedDay, searchTerm]);

  function isInPreset(className: string, dayOfWeek: string) {
    return preset.some(
      (p) => p.class_name === className && p.day_of_week === dayOfWeek,
    );
  }

  async function togglePresetEntry(className: string, dayOfWeek: string) {
    if (!accountId) return;

    const existing = preset.find(
      (p) => p.class_name === className && p.day_of_week === dayOfWeek,
    );

    try {
      if (existing) {
        await deletePresetEntry(existing.id);
        setPreset((prev) => prev.filter((p) => p.id !== existing.id));
      } else {
        const created = await addPresetEntry(accountId, className, dayOfWeek);
        setPreset((prev) => [...prev, created]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update preset";
      setPresetErrors((prev) => [...prev, message]);
    }
  }

  if (!initialized || accountLoading || authenticatedAccounts.length === 0) {
    if (initialized && !accountLoading && authenticatedAccounts.length === 0) {
      return (
        <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
            {accountError || "No accounts are available."}
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </main>
    );
  }

  const selectedAccount =
    authenticatedAccounts.find((a) => a.id === accountId) ?? null;

  // Preset entries currently saved for the day being shown.
  const presetForDay = preset.filter((p) => p.day_of_week === selectedDay);

  return (
    <main className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl text-black font-bold">Configure Preset</h1>
            <p className="text-gray-600 mt-1 sm:mt-2 text-sm sm:text-base">
              Pick the classes that should be in {selectedAccount?.name ?? "this account"}&apos;s
              weekly preset. Each entry is matched by name only — the earliest available time on
              that day will be picked when you apply the preset.
            </p>
            <p className="text-gray-500 mt-1 text-xs sm:text-sm">
              Showing next week&apos;s schedule (this week is partially in the past).
            </p>
          </div>

          <Link
            href="/planner"
            className="self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black"
          >
            ← Back to Planner
          </Link>
        </div>

        <div className="grid gap-4 rounded-2xl bg-white p-4 sm:p-6 shadow-sm border border-gray-200">
          <AccountSwitcher
            accounts={authenticatedAccounts}
            selectedAccountId={accountId}
            onChange={switchAccount}
          />

          <DayTabs
            days={daysOfWeek}
            selectedDay={selectedDay}
            onChange={setSelectedDay}
          />

          <SearchBar value={searchTerm} onChange={setSearchTerm} />

          {(classesError || presetErrors.length > 0) && (
            <div className="rounded-lg bg-red-50 p-3 text-red-800 text-sm space-y-1">
              {classesError && <div>{classesError}</div>}
              {presetErrors.map((msg, idx) => (
                <div key={idx}>{msg}</div>
              ))}
              {presetErrors.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPresetErrors([])}
                  className="text-xs underline"
                >
                  Clear errors
                </button>
              )}
            </div>
          )}

          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
            <p className="text-black font-medium mb-1">
              In preset for {selectedDay} ({presetForDay.length})
            </p>
            {presetForDay.length === 0 ? (
              <p className="text-gray-600">Nothing yet. Pick classes below.</p>
            ) : (
              <ul className="text-black list-disc pl-5">
                {presetForDay.map((p) => (
                  <li key={p.id}>{p.class_name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          {classesLoading ? (
            <div className="text-gray-500">Loading classes...</div>
          ) : dedupedClasses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-gray-500">
              No classes found for this day or search.
            </div>
          ) : (
            dedupedClasses.map((cls) => {
              const checked = isInPreset(cls.name, selectedDay);
              return (
                <div
                  key={`${cls.name}-${selectedDay}`}
                  className="rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm bg-white"
                >
                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg text-black font-semibold">
                        {cls.name}
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-600">
                        Earliest time: {cls.time}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-black text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePresetEntry(cls.name, selectedDay)}
                        className="h-4 w-4"
                      />
                      In preset
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
