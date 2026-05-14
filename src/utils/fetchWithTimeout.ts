/**
 * Wraps fetch with an AbortController-based timeout. Bare `fetch` has no built-in
 * timeout, so requests can hang for the full TCP keep-alive window if the server
 * never responds — long enough to stall sync loops or block UI on slow networks.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (init.signal) {
    // Caller already owns abort lifetime; respect it without wrapping.
    return fetch(input, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
