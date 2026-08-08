/**
 * Bun test preload — mocks modules that depend on browser extension APIs
 * so pure-logic unit tests can run without WXT/browser globals.
 */
// Preloaded by Bun via bunfig.toml, not built with the rest of src/. `bun:test`
// resolves because @types/bun is a devDependency, so the suppression comment
// this import used to carry had nothing left to suppress and `vue-tsc --noEmit`
// failed on TS2578 — which blocked using the type-check as a CI gate.
import { mock } from 'bun:test';

const noopLogger = { log: () => {}, warn: () => {}, error: () => {} };

mock.module('@/utils/logger', () => ({
  con: { m: () => noopLogger },
}));

// #imports is a WXT virtual module; stub it so transitive imports don't fail
mock.module('#imports', () => ({
  storage: { defineItem: () => ({ getValue: async () => null, setValue: async () => {} }) },
}));
