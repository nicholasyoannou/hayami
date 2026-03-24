/**
 * HTML utility functions — no heavy dependencies.
 * Separated from markdown.ts to avoid pulling in Snudown for consumers
 * that only need escapeHtml.
 */

export function escapeHtml(s: unknown) {
  const val = typeof s === 'string' ? s : s === null || s === undefined ? '' : String(s);
  return val.replace(/[&<>\"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch] as string));
}
