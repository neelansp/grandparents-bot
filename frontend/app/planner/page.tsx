"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountSwitcher from "@/components/AccountSwitcher";
import DayTabs from "@/components/DayTabs";
import SearchBar from "@/components/SearchBar";
import ClassList from "@/components/ClassList";
import SelectedClassesPreview from "@/components/SelectedClassesPreview";
import ReviewWeekButton from "@/components/ReviewWeekButton";
import { useAccounts } from "@/lib/accountStore";
import { useClasses, type ClassType } from "@/lib/classStore";
import { getPreset } from "@/lib/api";


const daysOfWeek = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];


function getWeekStart(date: Date, weekOffset = 0) {
  const day = date.getDay();
  const weekStart = new Date(date);

  if (day === 0) {
    weekStart.setDate(date.getDate() + 1);
  } else {
    weekStart.setDate(date.getDate() - (day - 1));
  }

  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  return weekStart;
}


function getDateForDay(dayName: string, weekOffset: number) {
  const dayIndex = daysOfWeek.indexOf(dayName);
  const weekStart = getWeekStart(new Date(), weekOffset);
  const targetDate = new Date(weekStart);
  targetDate.setDate(weekStart.getDate() + Math.max(dayIndex, 0));
  return targetDate;
}


function formatDateForApi(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


// Turn "5:30 PM" or "17:30" into minutes-since-midnight so we can pick the
// earliest available class when applying a preset.
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


// JS Date.getDay() returns 0=Sunday..6=Saturday. We want the day-name
// string in our Monday-first list.
function dayNameForDateString(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  const jsDay = date.getDay();
  const mondayFirstIndex = (jsDay + 6) % 7;
  return daysOfWeek[mondayFirstIndex];
}


type ApplyPresetResult = {
  added: number;
  notFoundDays: string[];
  errors: string[];
};


function formatWeekRange(weekOffset: number) {
  const weekStart = getWeekStart(new Date(), weekOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const firstLabel = weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const lastLabel = weekEnd.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${firstLabel} - ${lastLabel}`;
}


export default function PlannerPage() {
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
    selectedClasses,
    loading,
    error,
    fetchAvailableClassesForWeek,
    fetchSelectedClasses,
    addSelectedClass,
    removeSelectedClass,
    removeSelectedClasses,
  } = useClasses();

  const [selectedDay, setSelectedDay] = useState("Monday");
  const [searchTerm, setSearchTerm] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyPresetResult | null>(null);

  const selectedAccountId =
    currentAccount?.id ?? authenticatedAccounts[0]?.id ?? "";

  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }
    fetchAvailableClassesForWeek(selectedAccountId, weekOffset);
    fetchSelectedClasses(selectedAccountId);
  }, [
    selectedAccountId,
    weekOffset,
    fetchAvailableClassesForWeek,
    fetchSelectedClasses,
  ]);

  const filteredClasses = useMemo(() => {
    const targetDate = formatDateForApi(getDateForDay(selectedDay, weekOffset));

    return availableClasses.filter((item) => {
      const matchesDay = item.day === targetDate;
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesDay && matchesSearch;
    });
  }, [availableClasses, searchTerm, selectedDay, weekOffset]);

  const selectedClassesForAccount = useMemo(() => {
    if (!selectedAccountId) {
      return [];
    }

    return selectedClasses.filter((item) => item.account_id === selectedAccountId);
  }, [selectedAccountId, selectedClasses]);

  async function handleToggleClass(workoutClass: ClassType) {
    if (!selectedAccountId) {
      return;
    }

    const selection = selectedClassesForAccount.find(
      (item) => item.class_id === workoutClass.id && item.day === workoutClass.day
    );

    try {
      if (selection) {
        await removeSelectedClass(selection.id, selectedAccountId);
      } else {
        await addSelectedClass(
          selectedAccountId,
          workoutClass.id,
          workoutClass.name,
          workoutClass.day,
          workoutClass.time,
          workoutClass.instructor,
          workoutClass.slot_id
        );
      }
    } catch {
      // Class context already surfaces the error state.
    }
  }

  function isClassSelected(classId: string, day: string) {
    return selectedClassesForAccount.some(
      (item) => item.class_id === classId && item.day === day
    );
  }

  async function handleDeselectClass(selectionId: string) {
    if (!selectedAccountId) {
      return;
    }

    try {
      await removeSelectedClass(selectionId, selectedAccountId);
    } catch {
      // Class context already surfaces the error state.
    }
  }

  async function handleApplyPreset() {
    if (!selectedAccountId) return;

    setApplyingPreset(true);
    setApplyResult(null);

    // Step 1: load the saved preset for this account.
    let presetEntries;
    try {
      presetEntries = await getPreset(selectedAccountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load preset";
      setApplyResult({ added: 0, notFoundDays: [], errors: [message] });
      setApplyingPreset(false);
      return;
    }

    if (presetEntries.length === 0) {
      setApplyResult({
        added: 0,
        notFoundDays: [],
        errors: [
          "Your preset is empty. Click 'Configure Preset' to add classes first.",
        ],
      });
      setApplyingPreset(false);
      return;
    }

    // Step 2: walk each preset entry, find earliest matching class in the
    // visible week, and add it as a selection. Collect ALL errors so the
    // user sees everything that went wrong.
    const errors: string[] = [];
    const notFoundDays: string[] = [];
    let added = 0;

    for (const entry of presetEntries) {
      const matches = availableClasses.filter((cls) => {
        if (cls.name !== entry.class_name) return false;
        return dayNameForDateString(cls.day) === entry.day_of_week;
      });

      if (matches.length === 0) {
        notFoundDays.push(`${entry.class_name} on ${entry.day_of_week}`);
        continue;
      }

      matches.sort(
        (a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time),
      );
      const pick = matches[0];

      // Already selected on this day → silently skip (not a real error).
      if (isClassSelected(pick.id, pick.day)) {
        continue;
      }

      try {
        await addSelectedClass(
          selectedAccountId,
          pick.id,
          pick.name,
          pick.day,
          pick.time,
          pick.instructor,
          pick.slot_id,
        );
        added += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to add class";
        errors.push(`${pick.name} on ${pick.day}: ${message}`);
      }
    }

    setApplyResult({ added, notFoundDays, errors });
    setApplyingPreset(false);
  }

  async function handleDeselectAll() {
    if (!selectedAccountId || selectedClassesForAccount.length === 0) {
      return;
    }

    try {
      await removeSelectedClasses(
        selectedClassesForAccount.map((item) => item.id),
        selectedAccountId
      );
    } catch {
      // Class context already surfaces the error state.
    }
  }

  if (!initialized || accountLoading || authenticatedAccounts.length === 0) {
    if (initialized && !accountLoading && authenticatedAccounts.length === 0) {
      return (
        <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
            {accountError || "No accounts are available for the planner."}
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
    authenticatedAccounts.find((account) => account.id === selectedAccountId) ?? null;
  const weekRangeLabel = formatWeekRange(weekOffset);

  return (
    <main className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl text-black font-bold">Workout Class Planner</h1>
            <p className="text-gray-600 mt-1 sm:mt-2 text-sm sm:text-base">
              Browse classes for {selectedAccount?.name}.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 sm:gap-3 sm:justify-start">
            <button
              type="button"
              onClick={() => setWeekOffset((current) => current - 1)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-black"
              aria-label="Previous week"
            >
              ←
            </button>

            <div className="flex-1 sm:flex-none sm:min-w-37.5 text-center text-sm font-medium text-black">
              {weekRangeLabel}
            </div>

            <button
              type="button"
              onClick={() => setWeekOffset((current) => current + 1)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-black"
              aria-label="Next week"
            >
              →
            </button>

          </div>
        </div>

        <div className="grid gap-4 rounded-2xl bg-white p-4 sm:p-6 shadow-sm border border-gray-200">
          <AccountSwitcher
            accounts={authenticatedAccounts}
            selectedAccountId={selectedAccountId}
            onChange={switchAccount}
          />

          {selectedAccount && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-black">Active account</p>
              <p className="text-sm text-gray-600">{selectedAccount.email}</p>
            </div>
          )}

          <DayTabs
            days={daysOfWeek}
            selectedDay={selectedDay}
            onChange={setSelectedDay}
          />

          <SearchBar value={searchTerm} onChange={setSearchTerm} />

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-red-800 text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleApplyPreset}
              disabled={applyingPreset || !selectedAccountId}
              className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {applyingPreset ? "Applying..." : "Apply Preset"}
            </button>

            <Link
              href="/preset"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black"
            >
              Configure Preset
            </Link>

            <ReviewWeekButton accountId={selectedAccountId} />
          </div>

          {applyResult && (
            <div className="grid gap-2 text-sm">
              {applyResult.added > 0 && (
                <div className="rounded-lg bg-green-50 p-3 text-green-800">
                  Added {applyResult.added} class
                  {applyResult.added === 1 ? "" : "es"} from preset.
                </div>
              )}
              {applyResult.notFoundDays.length > 0 && (
                <div className="rounded-lg bg-yellow-50 p-3 text-yellow-900">
                  <p className="font-medium">
                    Couldn&apos;t find {applyResult.notFoundDays.length} class
                    {applyResult.notFoundDays.length === 1 ? "" : "es"} this week:
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {applyResult.notFoundDays.map((entry, idx) => (
                      <li key={idx}>{entry}</li>
                    ))}
                  </ul>
                </div>
              )}
              {applyResult.errors.length > 0 && (
                <div className="rounded-lg bg-red-50 p-3 text-red-800">
                  <p className="font-medium">Errors:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {applyResult.errors.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
              {applyResult.added === 0 &&
                applyResult.notFoundDays.length === 0 &&
                applyResult.errors.length === 0 && (
                  <div className="rounded-lg bg-blue-50 p-3 text-blue-900">
                    Nothing to add — every preset class is already selected for
                    this week.
                  </div>
                )}
              <button
                type="button"
                onClick={() => setApplyResult(null)}
                className="self-start text-xs underline text-gray-600"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr] items-start">
          {loading ? (
            <div className="text-gray-500">Loading classes...</div>
          ) : (
            <ClassList
              classes={filteredClasses}
              isSelected={isClassSelected}
              onToggleClass={handleToggleClass}
            />
          )}

          <SelectedClassesPreview
            classes={selectedClassesForAccount}
            loading={loading}
            onDeselectClass={handleDeselectClass}
            onDeselectAll={handleDeselectAll}
          />
        </div>
      </div>
    </main>
  );
}
