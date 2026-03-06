import type { AnimeInfo } from '../types';
import type { SiteAdapter } from '../adapters/types';
import {
  crunchyrollSiteDefinition,
} from './crunchyroll';
import { netflixSiteDefinition } from './netflix';
import { definitionMatchesLocation, SiteProviderDefinition } from './provider-definition';

export type SiteDefinition = {
  id: string;
  adapter: SiteAdapter;
  detect: () => Promise<AnimeInfo | null>;
  definition: SiteProviderDefinition;
};

function toSiteDefinition(definition: SiteProviderDefinition): SiteDefinition {
  return {
    id: definition.id,
    adapter: definition.adapter,
    detect: definition.detect,
    definition,
  };
}

export const siteDefinitions: SiteDefinition[] = [
  toSiteDefinition(netflixSiteDefinition),
  toSiteDefinition(crunchyrollSiteDefinition),
];

export function getSiteDetectorsForLocation(location: Location): Array<{ id: string; detect: () => Promise<AnimeInfo | null> }> {
  return siteDefinitions
    .filter((def) => definitionMatchesLocation(def.definition, location))
    .map((def) => ({ id: def.id, detect: def.detect }));
}

export function isSupportedLocation(location: Location): boolean {
  return siteDefinitions.some((def) => definitionMatchesLocation(def.definition, location));
}

export function getAdapters(): SiteAdapter[] {
  return siteDefinitions.map((def) => def.adapter);
}

export function findAdapter(location: Location = window.location): SiteAdapter | null {
  return siteDefinitions.find((def) => definitionMatchesLocation(def.definition, location))?.adapter ?? null;
}
