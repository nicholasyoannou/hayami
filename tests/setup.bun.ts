/**
 * Bun test preload — mocks modules that depend on browser extension APIs
 * so pure-logic unit tests can run without WXT/browser globals.
 */
import { mock } from 'bun:test';

const noopLogger = { log: () => {}, warn: () => {}, error: () => {} };

mock.module('@/utils/logger', () => ({
  con: { m: () => noopLogger },
}));

// #imports is a WXT virtual module; stub it so transitive imports don't fail
mock.module('#imports', () => ({
  storage: { defineItem: () => ({ getValue: async () => null, setValue: async () => {} }) },
}));
