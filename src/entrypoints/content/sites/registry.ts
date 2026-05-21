import { browser } from 'wxt/browser';
import type { AnimeInfo } from '../types';
import type { SiteAdapter } from './types';
import {
  crunchyrollSiteDefinition,
} from './crunchyroll';
import { netflixSiteDefinition } from './netflix';
import { definitionMatchesLocation, SiteProviderDefinition } from './provider-definition';
import {
  BUILTIN_SITE_IDS,
  enabledBuiltinSitesItem,
  type BuiltinSiteId,
} from '@/config/storage';

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

// Cached set of enabled built-in site IDs. Mirrored from `enabledBuiltinSitesItem`
// so registry helpers stay synchronous. Optimistic default = all built-ins on,
// so the first sync calls before `initSiteRegistry()` resolves still detect.
let enabledBuiltinIds: Set<string> = new Set(BUILTIN_SITE_IDS);

function isBuiltinId(id: string): id is BuiltinSiteId {
  return (BUILTIN_SITE_IDS as readonly string[]).includes(id);
}

function isDefinitionEnabled(def: SiteDefinition): boolean {
  if (!isBuiltinId(def.id)) return true;
  return enabledBuiltinIds.has(def.id);
}

export async function initSiteRegistry(): Promise<void> {
  try {
    const stored = await enabledBuiltinSitesItem.getValue();
    if (Array.isArray(stored)) {
      enabledBuiltinIds = new Set(stored.filter(isBuiltinId));
    }
  } catch {
    // Keep optimistic default on read failure.
  }

  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const change = changes.enabled_builtin_sites;
      if (!change) return;
      const next = change.newValue;
      if (Array.isArray(next)) {
        enabledBuiltinIds = new Set(next.filter(isBuiltinId));
      }
    });
  } catch {
    // Listener registration is best-effort; reloading the page picks up new values either way.
  }
}

export function getSiteDetectorsForLocation(location: Location): Array<{ id: string; detect: () => Promise<AnimeInfo | null> }> {
  return siteDefinitions
    .filter((def) => isDefinitionEnabled(def) && definitionMatchesLocation(def.definition, location))
    .map((def) => ({ id: def.id, detect: def.detect }));
}

export function isSupportedLocation(location: Location): boolean {
  return siteDefinitions.some((def) => isDefinitionEnabled(def) && definitionMatchesLocation(def.definition, location));
}

export function getAdapters(): SiteAdapter[] {
  return siteDefinitions.filter(isDefinitionEnabled).map((def) => def.adapter);
}

const extraAdapters: SiteAdapter[] = [];

export function resolveAdapter(location: Location = window.location): SiteAdapter | null {
  const registryAdapter = siteDefinitions.find((def) => isDefinitionEnabled(def) && definitionMatchesLocation(def.definition, location))?.adapter ?? null;
  if (registryAdapter) return registryAdapter;
  return extraAdapters.find((adapter) => adapter.matches(location)) || null;
}

export function getRegisteredAdapters(): SiteAdapter[] {
  return [...getAdapters(), ...extraAdapters];
}

export function registerAdapter(adapter: SiteAdapter): void {
  const exists = getAdapters().some((a) => a.id === adapter.id) || extraAdapters.some((a) => a.id === adapter.id);
  if (!exists) {
    extraAdapters.push(adapter);
  }
}
