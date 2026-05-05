// This file has one function per backend route. Each one sends JSON to
// the API and returns the parsed response.
//
// No auth, no tokens — the app runs on the home LAN, not the internet.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const JSON_HEADERS = { "Content-Type": "application/json" };

export type AccountResponse = {
  id: string;
  name: string;
  email: string;
  created_at?: string;
};

async function handleResponse(response: Response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || `API error: ${response.status}`);
  }
  return response.json();
}


export async function listAccounts() {
  const response = await fetch(`${API_BASE_URL}/accounts`);
  return handleResponse(response) as Promise<AccountResponse[]>;
}


export async function getAvailableClasses(accountId: string, date: string) {
  const response = await fetch(
    `${API_BASE_URL}/classes/available/${accountId}?date=${date}`
  );
  return handleResponse(response);
}


export async function selectClass(
  accountId: string,
  classId: string,
  className: string,
  day: string,
  time: string,
  instructor: string,
  slotId: string
) {
  const response = await fetch(`${API_BASE_URL}/classes/select`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      account_id: accountId,
      class_id: classId,
      class_name: className,
      day,
      time,
      instructor,
      slot_id: slotId,
    }),
  });
  return handleResponse(response);
}


export async function getSelectedClasses(accountId: string) {
  const response = await fetch(`${API_BASE_URL}/classes/selected/${accountId}`);
  return handleResponse(response);
}


export async function deselectClass(selectionId: string) {
  const response = await fetch(`${API_BASE_URL}/classes/selected/${selectionId}`, {
    method: "DELETE",
  });
  return handleResponse(response);
}


export async function getBookedClasses(accountId: string) {
  const response = await fetch(`${API_BASE_URL}/classes/booked/${accountId}`);
  return handleResponse(response);
}


export async function bookClasses(accountId: string, selectionIds: string[] = []) {
  const response = await fetch(`${API_BASE_URL}/classes/book/${accountId}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ selection_ids: selectionIds }),
  });
  return handleResponse(response);
}


export type PresetEntryResponse = {
  id: string;
  account_id: string;
  class_name: string;
  day_of_week: string;
  created_at?: string;
};


export async function getPreset(accountId: string) {
  const response = await fetch(`${API_BASE_URL}/presets/${accountId}`);
  return handleResponse(response) as Promise<PresetEntryResponse[]>;
}


export async function addPresetEntry(
  accountId: string,
  className: string,
  dayOfWeek: string
) {
  const response = await fetch(`${API_BASE_URL}/presets/${accountId}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ class_name: className, day_of_week: dayOfWeek }),
  });
  return handleResponse(response) as Promise<PresetEntryResponse>;
}


export async function deletePresetEntry(presetId: string) {
  const response = await fetch(`${API_BASE_URL}/presets/${presetId}`, {
    method: "DELETE",
  });
  return handleResponse(response);
}


export async function healthCheck() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
