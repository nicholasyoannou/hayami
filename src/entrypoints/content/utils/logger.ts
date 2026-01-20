type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const DEBUG_FLAG_KEY = 'cr-comments-debug';
const PREFIX = '[Mapper]';

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const explicit = (window as any).__CR_COMMENTS_DEBUG__;
  if (typeof explicit === 'boolean') return explicit;
  try {
    return localStorage.getItem(DEBUG_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (level === 'debug' && !isDebugEnabled()) return;
  const fn = console[level] || console.log;
  fn(PREFIX, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};

export function enableDebug(): void {
  try {
    localStorage.setItem(DEBUG_FLAG_KEY, '1');
  } catch {
    // ignore storage errors
  }
  (window as any).__CR_COMMENTS_DEBUG__ = true;
}

export function disableDebug(): void {
  try {
    localStorage.removeItem(DEBUG_FLAG_KEY);
  } catch {
    // ignore storage errors
  }
  (window as any).__CR_COMMENTS_DEBUG__ = false;
}
