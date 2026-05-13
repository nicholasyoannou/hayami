/**
 * Tests for src/entrypoints/content/utils/mal-utils.ts
 */
import { describe, it, expect } from 'vitest';
import { extractSeasonNumber } from '@/entrypoints/content/utils/mal-utils';

// ---------------------------------------------------------------------------
// extractSeasonNumber
// ---------------------------------------------------------------------------
describe('extractSeasonNumber', () => {
  it('returns null for null/undefined/empty', () => {
    expect(extractSeasonNumber(null)).toBe(null);
    expect(extractSeasonNumber(undefined)).toBe(null);
    expect(extractSeasonNumber('')).toBe(null);
  });

  it('extracts from "Season N" format', () => {
    expect(extractSeasonNumber('Mushoku Tensei Season 2')).toBe(2);
    expect(extractSeasonNumber('Classroom of the Elite Season 4')).toBe(4);
    expect(extractSeasonNumber('Season 1')).toBe(1);
    expect(extractSeasonNumber('My Hero Academia Season12')).toBe(12);
  });

  it('extracts from "SN" format', () => {
    expect(extractSeasonNumber('Attack on Titan S2')).toBe(2);
    expect(extractSeasonNumber('S3 Part 2')).toBe(3);
  });

  it('extracts from ordinal "Nth Season" format', () => {
    expect(extractSeasonNumber('2nd Season')).toBe(2);
    expect(extractSeasonNumber('3rd Season')).toBe(3);
    expect(extractSeasonNumber('1st Season')).toBe(1);
  });

  it('returns null when no season pattern found', () => {
    expect(extractSeasonNumber('Mushoku Tensei: Jobless Reincarnation')).toBe(null);
    expect(extractSeasonNumber('One Piece')).toBe(null);
    expect(extractSeasonNumber('Frieren: Beyond Journey\'s End')).toBe(null);
  });

  it('returns null for titles with "Part" but no season', () => {
    expect(extractSeasonNumber('Mushoku Tensei Part 2')).toBe(null);
  });
});
