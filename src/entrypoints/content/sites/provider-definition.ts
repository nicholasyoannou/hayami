import type { AnimeInfo } from '../types';
import type { SiteAdapter } from './types';

export type UrlMatchPattern = string | RegExp | ((location: Location) => boolean);

export interface SiteProviderDefinition {
  id: string;
  name?: string;
  domain?: string;
  languages?: string[];
  type?: 'anime' | 'manga';
  database?: string;
  minimumVersion?: string;
  urls: {
    match: UrlMatchPattern[];
  };
  adapter: SiteAdapter;
  detect: () => Promise<AnimeInfo | null>;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toHrefWithoutHash(location: Location): string {
  return `${location.protocol}//${location.host}${location.pathname}${location.search}`;
}

function wildcardPatternToRegExp(pattern: string): RegExp {
  if (pattern === '<all_urls>') {
    return /^https?:\/\/.+/i;
  }

  const regexBody = pattern
    .split('*')
    .map((part) => escapeRegex(part))
    .join('.*');

  return new RegExp(`^${regexBody}$`, 'i');
}

function patternToMatcher(pattern: UrlMatchPattern): (location: Location) => boolean {
  if (typeof pattern === 'function') {
    return pattern;
  }

  if (pattern instanceof RegExp) {
    return (location) => {
      const hrefNoHash = toHrefWithoutHash(location);
      return pattern.test(hrefNoHash) || pattern.test(location.hostname);
    };
  }

  const regex = wildcardPatternToRegExp(pattern);
  return (location) => regex.test(toHrefWithoutHash(location));
}

export function buildLocationMatcher(patterns: UrlMatchPattern[]): (location: Location) => boolean {
  const matchers = patterns.map((pattern) => patternToMatcher(pattern));
  return (location: Location) => matchers.some((matcher) => matcher(location));
}

export function definitionMatchesLocation(definition: SiteProviderDefinition, location: Location): boolean {
  return buildLocationMatcher(definition.urls.match)(location);
}
