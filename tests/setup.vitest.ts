/**
 * Vitest setup — mocks modules that depend on browser extension APIs
 * so pure-logic unit tests can run without WXT/browser globals.
 */
import { vi } from 'vitest';

const noopLogger = { log: () => {}, warn: () => {}, error: () => {} };

vi.mock('@/utils/logger', () => ({
  con: { m: () => noopLogger },
}));
