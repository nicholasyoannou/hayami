/**
 * Async helpers shared across the extension.
 */

/**
 * Promise-based timeout. Pass an `AbortSignal` to reject early with an
 * `AbortError` when the caller's operation is cancelled — required for any
 * sleep inside a fetch loop that should respect user-cancelled flows.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
