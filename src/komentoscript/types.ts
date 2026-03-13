export type KomentoSourceType = 'hayami-official' | 'third-party' | 'local';

export type KomentoTrustLevel = 'official' | 'verified' | 'unverified';

export type KomentoDisplayPlacement = 'below' | 'insert' | 'replace' | 'popup' | 'icon';

export type KomentoMergeMode = 'replace' | 'deep';

export type KomentoProviderKey = 'reddit' | 'aniwave' | 'disqus' | 'anilist' | 'mal' | string;

export interface KomentoSourceMeta {
  type: KomentoSourceType;
  url?: string;
  priority?: number;
  etag?: string;
  signature?: string;
  trust?: KomentoTrustLevel;
}

export interface KomentoExtractSelector {
  selector?: string;
  xPath?: string;
  attr?: 'text' | 'content' | 'html' | string;
  required?: boolean;
  transforms?: string[];
}

export type KomentoPipelineStep = Array<string | number | boolean | null | KomentoPipelineStep[]>;

export interface KomentoExtractPipeline {
  pipeline: KomentoPipelineStep[];
  required?: boolean;
}

export type KomentoExtractField = KomentoExtractSelector | KomentoExtractPipeline;

export interface KomentoExtractBlock {
  animeTitle?: KomentoExtractField;
  episodeNumber?: KomentoExtractField;
  seasonNumber?: KomentoExtractField;
  sequenceNumber?: KomentoExtractField;
  episodeReleaseDate?: KomentoExtractField;
  anilistId?: KomentoExtractField;
  malId?: KomentoExtractField;
  [key: string]: KomentoExtractField | undefined;
}

export interface KomentoPlacement {
  display: KomentoDisplayPlacement;
  mountSelector?: string;
  anchorSelector?: string;
  mountXPath?: string;
  anchorXPath?: string;
  sidePadding?: number;
  fallback?: {
    display?: KomentoDisplayPlacement;
    mountSelector?: string;
  };
}

export interface KomentoProviderConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface KomentoMapping {
  resolver?: {
    animeName?: string;
    episode?: string;
    releaseDate?: string;
    ids?: {
      anilist?: string;
      mal?: string;
      [key: string]: string | undefined;
    };
  };
  providers?: Record<KomentoProviderKey, KomentoProviderConfig>;
}

export interface KomentoMatch {
  origins: string[];
  pathGlobs?: string[];
  excludePathGlobs?: string[];
}

export interface KomentoTarget {
  targetId: string;
  priority?: number;
  extends?: string;
  mergeMode?: KomentoMergeMode;
  match: KomentoMatch;
  extract?: KomentoExtractBlock;
  placement?: KomentoPlacement;
  mapping?: KomentoMapping;
}

export interface KomentoProfile {
  enabledTargets: string[];
}

export interface KomentoScriptPack {
  komentoVersion: string;
  id: string;
  name?: string;
  updatedAt?: string;
  source?: KomentoSourceMeta;
  appliesTo?: Array<'multi-site' | 'single-site' | string>;
  tags?: string[];
  profiles?: Record<string, KomentoProfile>;
  targets: KomentoTarget[];
}

export interface KomentoSourceRegistryEntry {
  id: string;
  type: KomentoSourceType;
  url: string;
  enabled: boolean;
  priority?: number;
  refreshMinutes?: number;
  trust?: KomentoTrustLevel;
}

export interface KomentoSourceRegistry {
  sources: KomentoSourceRegistryEntry[];
}

export interface KomentoValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface KomentoValidationResult {
  valid: boolean;
  issues: KomentoValidationIssue[];
}

export interface KomentoRuntimeCandidate {
  pack: KomentoScriptPack;
  sourceId: string;
  sourcePriority: number;
  target: KomentoTarget;
  targetPriority: number;
  updatedAtEpoch: number;
}

export interface ResolveKomentoOptions {
  activeProfilesBySourceId?: Record<string, string | undefined>;
}
