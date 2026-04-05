export type KomentoDisplayPlacement = 'below' | 'insert' | 'replace' | 'popup' | 'icon';
export type KomentoIconDisplayKind = 'text' | 'icon';
export type KomentoIconDisplayAction = 'popup' | 'replace';

export type KomentoMergeMode = 'replace' | 'deep';

export type KomentoProviderKey = 'reddit' | 'aniwave' | 'disqus' | 'anilist' | 'mal' | string;

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
  animeTitle: KomentoExtractField;
  episodeNumber: KomentoExtractField;
  episodeReleaseDate?: KomentoExtractField;
  anilistId?: KomentoExtractField;
  malId?: KomentoExtractField;
}

export interface KomentoPlacement {
  display: KomentoDisplayPlacement;
  mountSelector?: string;
  anchorSelector?: string;
  mountXPath?: string;
  anchorXPath?: string;
  sidePadding?: number;
  commentsBackgroundColor?: string;
  iconDisplayKind?: KomentoIconDisplayKind;
  iconDisplayAction?: KomentoIconDisplayAction;
  iconDisplayText?: string;
  fallback?: {
    display?: KomentoDisplayPlacement;
    mountSelector?: string;
  };
}

export interface KomentoPlacementOption {
  default?: boolean;
  mountSelector?: string;
  anchorSelector?: string;
  mountXPath?: string;
  anchorXPath?: string;
  sidePadding?: number;
  commentsBackgroundColor?: string;
  iconDisplayKind?: KomentoIconDisplayKind;
  iconDisplayAction?: KomentoIconDisplayAction;
  iconDisplayText?: string;
  fallback?: {
    display?: KomentoDisplayPlacement;
    mountSelector?: string;
  };
}

export type KomentoPlacementMap = Partial<Record<KomentoDisplayPlacement, KomentoPlacementOption>>;

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
  placement?: KomentoPlacement | KomentoPlacementMap;
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
  appliesTo?: Array<'multi-site' | 'single-site' | string>;
  tags?: string[];
  profiles?: Record<string, KomentoProfile>;
  targets: KomentoTarget[];
}

export interface KomentoSourceRegistryEntry {
  id: string;
  url: string;
  enabled: boolean;
  refreshMinutes?: number;
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
  target: KomentoTarget;
  targetPriority: number;
  updatedAtEpoch: number;
}

export interface ResolveKomentoOptions {
  activeProfilesBySourceId?: Record<string, string | undefined>;
  enabledTargetIdsBySourceId?: Record<string, string[] | undefined>;
}
