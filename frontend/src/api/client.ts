const rawApiUrl =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env["VITE_API_URL"];

if (
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  import.meta.env.PROD &&
  !rawApiUrl &&
  typeof window !== "undefined"
) {
  console.warn(
    "[OSIS] VITE_API_URL environment variable is not defined. The frontend is falling back to http://localhost:5000. Set VITE_API_URL in your Vercel deployment settings to connect to the production backend.",
  );
}

const API_BASE_URL = (rawApiUrl || "http://localhost:5000").replace(/\/+$/, "");

export async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${API_BASE_URL}${cleanEndpoint}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: options?.signal ?? AbortSignal.timeout(150000),
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "PROCESSING ERROR: request timed out. Check saved reports before retrying."
        : "NETWORK ERROR: backend is unreachable. Start the backend, check VITE_API_URL and retry.",
    );
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(`PROCESSING ERROR (${res.status}): ${detail?.error || res.statusText}`);
  }

  return res.json() as Promise<T>;
}
