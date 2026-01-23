import type { AnimeInfo } from '../types';
import type { SiteAdapter } from '../adapters/types';
import {
  crunchyrollAdapter,
  crunchyrollMatchers,
  detectCrunchyrollAnimeInfo,
} from './crunchyroll';
import { netflixAdapter, netflixMatchers, detectNetflixAnimeInfo } from './netflix';
import { matchByHost } from './matchers';

export type SiteDefinition = {
  id: string;
  matchers: Array<RegExp | ((location: Location) => boolean)>;
  adapter: SiteAdapter;
  detect: () => Promise<AnimeInfo | null>;
};

function matchLocation(matchers: SiteDefinition['matchers'], location: Location): boolean {
  return matchers.some((m) => {
    if (typeof m === 'function') return m(location);
    return matchByHost([m], location);
  });
}

export const siteDefinitions: SiteDefinition[] = [
  {
    id: 'netflix',
    matchers: netflixMatchers,
    adapter: netflixAdapter,
    detect: detectNetflixAnimeInfo,
  },
  {
    id: 'crunchyroll',
    matchers: crunchyrollMatchers,
    adapter: crunchyrollAdapter,
    detect: detectCrunchyrollAnimeInfo,
  },
];

export function getSiteDetectorsForLocation(location: Location): Array<{ id: string; detect: () => Promise<AnimeInfo | null> }> {
  return siteDefinitions
    .filter((def) => matchLocation(def.matchers, location))
    .map((def) => ({ id: def.id, detect: def.detect }));
}

export function isSupportedLocation(location: Location): boolean {
  return siteDefinitions.some((def) => matchLocation(def.matchers, location));
}

export function getAdapters(): SiteAdapter[] {
  return siteDefinitions.map((def) => def.adapter);
}

export function findAdapter(location: Location = window.location): SiteAdapter | null {
  return siteDefinitions.find((def) => matchLocation(def.matchers, location))?.adapter ?? null;
}
