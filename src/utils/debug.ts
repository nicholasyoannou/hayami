/**
 * Debug logging utility
 * Gates console statements behind a debug flag
 */

const DEBUG_ENABLED = 
  import.meta.env.DEV || 
  (typeof window !== 'undefined' && (window as any).RI_DEBUG === true);

export const debug = {
  log: (...args: any[]) => {
    if (DEBUG_ENABLED) {
      console.log('[RI]', ...args);
    }
  },
  warn: (...args: any[]) => {
    if (DEBUG_ENABLED) {
      console.warn('[RI]', ...args);
    }
  },
  error: (...args: any[]) => {
    // Always log errors, even in production
    console.error('[RI]', ...args);
  },
  debug: (...args: any[]) => {
    if (DEBUG_ENABLED) {
      console.debug('[RI]', ...args);
    }
  },
  group: (label: string) => {
    if (DEBUG_ENABLED) {
      console.group('[RI]', label);
    }
  },
  groupEnd: () => {
    if (DEBUG_ENABLED) {
      console.groupEnd();
    }
  },
};
