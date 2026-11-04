/**
 * Maps a failed patient-profile response to an accurate, PHI-free message so the
 * UI no longer hides the real cause behind a single generic toast.
 */
export function describeProfileLoadFailure(
  status: number,
  body: unknown
): string {
  const serverMessage =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? ((body as { error: string }).error)
      : "";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 404)
    return "This patient record could not be found. It may have been archived — refresh the list and try again.";
  if (status === 0)
    return "Could not reach the server. Check your connection and try again.";
  if (status >= 500)
    return serverMessage || "Patient profile is temporarily unavailable. Please retry.";
  return serverMessage || "Could not load patient profile.";
}

