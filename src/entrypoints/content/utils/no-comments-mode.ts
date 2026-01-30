import { noCommentsModeItem } from '@/config/storage';

const STORAGE_KEY = 'local:no_comments_mode';
const LEGACY_KEY = 'no_comments_mode';
const DEFAULT_MODE: 'inline' | 'popup' = 'popup';

function normalizeMode(value: unknown): 'inline' | 'popup' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (normalized === 'inline') return 'inline';
  if (normalized === 'popup') return 'popup';
  return DEFAULT_MODE;
}

export async function resolveNoCommentsMode(): Promise<'popup' | 'inline'> {
  try {
    const stored = await noCommentsModeItem.getValue();
    return normalizeMode(stored);
  } catch (e) {
    console.warn('[NoComments] Failed to read mode via wxt storage, falling back', e);
  }

  try {
    const rawStorage = chrome?.storage?.local;
    if (rawStorage?.get) {
      const raw = await rawStorage.get([STORAGE_KEY, LEGACY_KEY]);
      const mode = normalizeMode(raw?.[STORAGE_KEY] ?? raw?.[LEGACY_KEY]);
      return mode;
    }
  } catch (e) {
    console.warn('[NoComments] Failed to read mode from chrome.storage', e);
  }

  return DEFAULT_MODE;
}
