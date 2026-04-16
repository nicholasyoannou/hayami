export type ClearableCategoryId =
  | 'manual-overrides'
  | 'anime-id-cache'
  | 'custom-sites'
  | 'komentoscript-cache'
  | 'custom-sites-sync-cache'
  | 'sync-history';

export type ClearableCategory = {
  id: ClearableCategoryId;
  label: string;
  description: string;
};

export const CLEARABLE_CATEGORIES: ClearableCategory[] = [
  {
    id: 'manual-overrides',
    label: 'Manual mappings & overrides',
    description: 'Episode offsets, wrong-anime corrections, and the sync\u2019d recent list.',
  },
  {
    id: 'anime-id-cache',
    label: 'MAL / AniList ID cache',
    description: 'Platform-agnostic IDs resolved via MAL-Sync. Rebuilds automatically as you browse.',
  },
  {
    id: 'custom-sites',
    label: 'Custom site mappings',
    description: 'Sites you\u2019ve configured via the site mapper overlay.',
  },
  {
    id: 'komentoscript-cache',
    label: 'KomentoScript cached packs',
    description: 'Downloaded script packs and ETags. Re-fetches on next sync.',
  },
  {
    id: 'custom-sites-sync-cache',
    label: 'Custom sites sync cache',
    description: 'Downloaded mappings and ETags. Re-fetches on next sync.',
  },
  {
    id: 'sync-history',
    label: 'Sync history logs',
    description: 'Past sync attempt logs for KomentoScript and custom-sites sync.',
  },
];
