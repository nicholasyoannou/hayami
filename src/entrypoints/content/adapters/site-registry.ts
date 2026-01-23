import { SiteAdapter } from './types';
import { getAdapters, findAdapter } from '../sites/registry';

const extraAdapters: SiteAdapter[] = [];

export function resolveAdapter(location: Location = window.location): SiteAdapter | null {
  const registryAdapter = findAdapter(location);
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
