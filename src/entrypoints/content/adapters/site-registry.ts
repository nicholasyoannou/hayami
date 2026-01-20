import { SiteAdapter } from './types';
import { crunchyrollAdapter } from '../sites/crunchyroll';

const adapters: SiteAdapter[] = [crunchyrollAdapter];

export function resolveAdapter(location: Location = window.location): SiteAdapter | null {
  return adapters.find((adapter) => adapter.matches(location)) || null;
}

export function getRegisteredAdapters(): SiteAdapter[] {
  return [...adapters];
}

export function registerAdapter(adapter: SiteAdapter): void {
  const exists = adapters.some((a) => a.id === adapter.id);
  if (!exists) {
    adapters.push(adapter);
  }
}
