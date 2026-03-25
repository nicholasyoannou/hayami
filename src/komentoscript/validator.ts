import type {
  KomentoExtractField,
  KomentoScriptPack,
  KomentoTarget,
  KomentoValidationIssue,
  KomentoValidationResult,
} from './types';

const DISPLAY_VALUES = new Set(['below', 'insert', 'replace', 'popup', 'icon']);
const ICON_DISPLAY_KIND_VALUES = new Set(['text', 'icon']);
const ICON_DISPLAY_ACTION_VALUES = new Set(['popup', 'replace']);
const MERGE_VALUES = new Set(['replace', 'deep']);
const ALLOWED_EXTRACT_FIELDS = new Set(['animeTitle', 'episodeNumber', 'episodeReleaseDate', 'anilistId', 'malId']);
const PLACEMENT_SINGLE_KEYS = new Set([
  'display',
  'mountSelector',
  'anchorSelector',
  'mountXPath',
  'anchorXPath',
  'sidePadding',
  'iconDisplayKind',
  'iconDisplayAction',
  'iconDisplayText',
  'fallback',
]);
const PLACEMENT_MODE_ENTRY_KEYS = new Set([
  'default',
  'mountSelector',
  'anchorSelector',
  'mountXPath',
  'anchorXPath',
  'sidePadding',
  'iconDisplayKind',
  'iconDisplayAction',
  'iconDisplayText',
  'fallback',
]);
const PLACEMENT_FALLBACK_KEYS = new Set(['display', 'mountSelector']);

function pushIssue(issues: KomentoValidationIssue[], severity: 'error' | 'warning', path: string, message: string): void {
  issues.push({ severity, path, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateAllowedObjectKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: Set<string>,
  issues: KomentoValidationIssue[],
): void {
  Object.keys(value).forEach((key) => {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, 'error', `${path}.${key}`, `Unknown property: ${key}`);
    }
  });
}

function looksLikeIsoDate(value: string): boolean {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return false;
  return /\d{4}-\d{2}-\d{2}/.test(value);
}

function validateExtractField(field: unknown, path: string, issues: KomentoValidationIssue[]): void {
  if (!isObject(field)) {
    pushIssue(issues, 'error', path, 'Extract field must be an object.');
    return;
  }

  const hasSelector = isNonEmptyString(field.selector);
  const hasXPath = isNonEmptyString(field.xPath);
  const hasPipeline = Array.isArray(field.pipeline);

  if (!hasSelector && !hasXPath && !hasPipeline) {
    pushIssue(issues, 'warning', path, 'Extract field should define selector, xPath, or pipeline.');
  }

  if (hasPipeline) {
    const pipeline = field.pipeline as unknown[];
    if (pipeline.length === 0) {
      pushIssue(issues, 'warning', `${path}.pipeline`, 'Pipeline should not be empty.');
    }
  }

  if (Array.isArray(field.transforms) && field.transforms.some((item) => !isNonEmptyString(item))) {
    pushIssue(issues, 'warning', `${path}.transforms`, 'Transforms should only contain non-empty strings.');
  }
}

function validatePlacementObject(
  placement: Record<string, unknown>,
  path: string,
  issues: KomentoValidationIssue[],
): void {
  const validateFallback = (fallback: unknown, fallbackPath: string): void => {
    if (!isObject(fallback)) {
      pushIssue(issues, 'error', fallbackPath, 'fallback must be an object.');
      return;
    }

    validateAllowedObjectKeys(fallback, fallbackPath, PLACEMENT_FALLBACK_KEYS, issues);

    if (fallback.display !== undefined) {
      const fallbackDisplay = String(fallback.display);
      if (!DISPLAY_VALUES.has(fallbackDisplay)) {
        pushIssue(issues, 'error', `${fallbackPath}.display`, 'fallback.display has an invalid value.');
      }
    }

    if (fallback.mountSelector !== undefined && typeof fallback.mountSelector !== 'string') {
      pushIssue(issues, 'error', `${fallbackPath}.mountSelector`, 'fallback.mountSelector must be a string when provided.');
    }
  };

  const validatePlacementEntry = (
    config: Record<string, unknown>,
    configPath: string,
    allowedKeys: Set<string>,
  ): void => {
    validateAllowedObjectKeys(config, configPath, allowedKeys, issues);

    if (config.mountSelector !== undefined && typeof config.mountSelector !== 'string') {
      pushIssue(issues, 'error', `${configPath}.mountSelector`, 'mountSelector must be a string when provided.');
    }
    if (config.anchorSelector !== undefined && typeof config.anchorSelector !== 'string') {
      pushIssue(issues, 'error', `${configPath}.anchorSelector`, 'anchorSelector must be a string when provided.');
    }
    if (config.mountXPath !== undefined && typeof config.mountXPath !== 'string') {
      pushIssue(issues, 'error', `${configPath}.mountXPath`, 'mountXPath must be a string when provided.');
    }
    if (config.anchorXPath !== undefined && typeof config.anchorXPath !== 'string') {
      pushIssue(issues, 'error', `${configPath}.anchorXPath`, 'anchorXPath must be a string when provided.');
    }
    if (config.sidePadding !== undefined && typeof config.sidePadding !== 'number') {
      pushIssue(issues, 'error', `${configPath}.sidePadding`, 'sidePadding must be a number when provided.');
    }
    if (config.iconDisplayKind !== undefined && !ICON_DISPLAY_KIND_VALUES.has(String(config.iconDisplayKind))) {
      pushIssue(issues, 'error', `${configPath}.iconDisplayKind`, 'iconDisplayKind must be "text" or "icon" when provided.');
    }
    if (config.iconDisplayAction !== undefined && !ICON_DISPLAY_ACTION_VALUES.has(String(config.iconDisplayAction))) {
      pushIssue(issues, 'error', `${configPath}.iconDisplayAction`, 'iconDisplayAction must be "popup" or "replace" when provided.');
    }
    if (config.iconDisplayText !== undefined && typeof config.iconDisplayText !== 'string') {
      pushIssue(issues, 'error', `${configPath}.iconDisplayText`, 'iconDisplayText must be a string when provided.');
    }

    if (config.fallback !== undefined) {
      validateFallback(config.fallback, `${configPath}.fallback`);
    }
  };

  if ('display' in placement) {
    validatePlacementEntry(placement, path, PLACEMENT_SINGLE_KEYS);

    const display = String(placement.display);
    if (!DISPLAY_VALUES.has(display)) {
      pushIssue(issues, 'error', `${path}.display`, 'placement.display has an invalid value.');
    }
    return;
  }

  const entries = Object.entries(placement);
  if (entries.length === 0) {
    pushIssue(issues, 'error', path, 'placement must define at least one placement mode.');
    return;
  }

  let defaultsSet = 0;
  let hasKnownPlacement = false;

  for (const [display, config] of entries) {
    if (!DISPLAY_VALUES.has(display)) {
      pushIssue(
        issues,
        'error',
        `${path}.${display}`,
        `placement key "${display}" is invalid. Use one of: below, insert, replace, popup, icon.`,
      );
      continue;
    }

    hasKnownPlacement = true;

    if (!isObject(config)) {
      pushIssue(issues, 'error', `${path}.${display}`, 'placement mode config must be an object.');
      continue;
    }

    validatePlacementEntry(config, `${path}.${display}`, PLACEMENT_MODE_ENTRY_KEYS);

    if (config.default !== undefined && typeof config.default !== 'boolean') {
      pushIssue(issues, 'error', `${path}.${display}.default`, 'default must be a boolean when provided.');
    }
    if (config.default === true) {
      defaultsSet += 1;
    }
  }

  if (!hasKnownPlacement) {
    pushIssue(issues, 'error', path, 'placement does not define any valid placement modes.');
  }
  if (defaultsSet > 1) {
    pushIssue(issues, 'error', path, 'Only one placement mode may set default: true.');
  }
}

function validateTarget(target: unknown, path: string, issues: KomentoValidationIssue[]): target is KomentoTarget {
  if (!isObject(target)) {
    pushIssue(issues, 'error', path, 'Target must be an object.');
    return false;
  }

  if (!isNonEmptyString(target.targetId)) {
    pushIssue(issues, 'error', `${path}.targetId`, 'targetId is required.');
  }

  if (target.mergeMode !== undefined && !MERGE_VALUES.has(String(target.mergeMode))) {
    pushIssue(issues, 'error', `${path}.mergeMode`, 'mergeMode must be "replace" or "deep".');
  }

  if (!isObject(target.match)) {
    pushIssue(issues, 'error', `${path}.match`, 'match is required and must be an object.');
  } else {
    const origins = target.match.origins;
    if (!Array.isArray(origins) || origins.length === 0 || origins.some((o) => !isNonEmptyString(o))) {
      pushIssue(issues, 'error', `${path}.match.origins`, 'match.origins must be a non-empty string array.');
    }

    const pathGlobs = target.match.pathGlobs;
    if (pathGlobs !== undefined) {
      if (!Array.isArray(pathGlobs)) {
        pushIssue(issues, 'error', `${path}.match.pathGlobs`, 'match.pathGlobs must be a string array when provided.');
      } else if (pathGlobs.length === 0) {
        pushIssue(issues, 'error', `${path}.match.pathGlobs`, 'match.pathGlobs cannot be an empty array; omit it to match all paths.');
      } else if (pathGlobs.some((glob) => !isNonEmptyString(glob))) {
        pushIssue(issues, 'error', `${path}.match.pathGlobs`, 'match.pathGlobs must contain non-empty strings only.');
      }
    }

    const excludePathGlobs = target.match.excludePathGlobs;
    if (excludePathGlobs !== undefined) {
      if (!Array.isArray(excludePathGlobs)) {
        pushIssue(issues, 'error', `${path}.match.excludePathGlobs`, 'match.excludePathGlobs must be a string array when provided.');
      } else if (excludePathGlobs.some((glob) => !isNonEmptyString(glob))) {
        pushIssue(issues, 'error', `${path}.match.excludePathGlobs`, 'match.excludePathGlobs must contain non-empty strings only.');
      }
    }
  }

  if (target.placement !== undefined) {
    if (!isObject(target.placement)) {
      pushIssue(issues, 'error', `${path}.placement`, 'placement must be an object.');
    } else {
      validatePlacementObject(target.placement, `${path}.placement`, issues);
    }
  }

  if (target.extract !== undefined) {
    if (!isObject(target.extract)) {
      pushIssue(issues, 'error', `${path}.extract`, 'extract must be an object.');
    } else {
      Object.entries(target.extract).forEach(([key, value]) => {
        if (!ALLOWED_EXTRACT_FIELDS.has(key)) {
          pushIssue(
            issues,
            'error',
            `${path}.extract.${key}`,
            `Unsupported extract field: ${key}. Allowed fields are animeTitle, episodeNumber, episodeReleaseDate, anilistId, malId.`,
          );
          return;
        }
        validateExtractField(value as KomentoExtractField, `${path}.extract.${key}`, issues);
      });
    }
  }

  const extract = isObject(target.extract) ? target.extract : undefined;
  const hasRequiredExtractor = Boolean(extract?.animeTitle) && Boolean(extract?.episodeNumber);
  if (!hasRequiredExtractor) {
    pushIssue(
      issues,
      'error',
      `${path}.extract`,
      'animeTitle and episodeNumber extractors are required.',
    );
  }

  if (target.mapping !== undefined && !isObject(target.mapping)) {
    pushIssue(issues, 'error', `${path}.mapping`, 'mapping must be an object.');
  }

  return true;
}

export function validateKomentoScriptPack(input: unknown): KomentoValidationResult {
  const issues: KomentoValidationIssue[] = [];

  if (!isObject(input)) {
    return {
      valid: false,
      issues: [{ path: '$', message: 'KomentoScript pack must be an object.', severity: 'error' }],
    };
  }

  if (!isNonEmptyString(input.komentoVersion)) {
    pushIssue(issues, 'error', '$.komentoVersion', 'komentoVersion is required.');
  }

  if (!isNonEmptyString(input.id)) {
    pushIssue(issues, 'error', '$.id', 'id is required.');
  }

  if (input.updatedAt !== undefined) {
    if (!isNonEmptyString(input.updatedAt) || !looksLikeIsoDate(input.updatedAt)) {
      pushIssue(issues, 'warning', '$.updatedAt', 'updatedAt should be an ISO-8601 date string.');
    }
  }

  if (!Array.isArray(input.targets)) {
    pushIssue(issues, 'error', '$.targets', 'targets is required and must be an array.');
  } else {
    if (input.targets.length === 0) {
      pushIssue(issues, 'warning', '$.targets', 'targets is empty.');
    }
    const seenIds = new Set<string>();
    input.targets.forEach((target, idx) => {
      const path = `$.targets[${idx}]`;
      const ok = validateTarget(target, path, issues);
      if (ok && isObject(target) && isNonEmptyString(target.targetId)) {
        if (seenIds.has(target.targetId)) {
          pushIssue(issues, 'error', `${path}.targetId`, `Duplicate targetId: ${target.targetId}`);
        }
        seenIds.add(target.targetId);
      }
    });

    input.targets.forEach((target, idx) => {
      if (!isObject(target) || !isNonEmptyString(target.extends)) return;
      const ref = target.extends;
      if (!seenIds.has(ref)) {
        pushIssue(issues, 'warning', `$.targets[${idx}].extends`, `extends target not found in pack: ${ref}`);
      }
    });
  }

  if (input.profiles !== undefined) {
    if (!isObject(input.profiles)) {
      pushIssue(issues, 'error', '$.profiles', 'profiles must be an object when provided.');
    } else {
      Object.entries(input.profiles).forEach(([profileId, profile]) => {
        if (!isObject(profile) || !Array.isArray(profile.enabledTargets)) {
          pushIssue(issues, 'error', `$.profiles.${profileId}`, 'Profile must include enabledTargets array.');
          return;
        }
        if (profile.enabledTargets.some((item) => !isNonEmptyString(item))) {
          pushIssue(issues, 'error', `$.profiles.${profileId}.enabledTargets`, 'enabledTargets must contain non-empty strings only.');
        }
      });
    }
  }

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  return { valid: !hasErrors, issues };
}

export function validateKomentoScriptPacks(inputs: unknown[]): KomentoValidationResult {
  const issues: KomentoValidationIssue[] = [];
  inputs.forEach((input, idx) => {
    const result = validateKomentoScriptPack(input);
    result.issues.forEach((issue) => {
      issues.push({
        ...issue,
        path: `$[${idx}]${issue.path === '$' ? '' : issue.path.slice(1)}`,
      });
    });
  });

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  return { valid: !hasErrors, issues };
}

export function parseKomentoScriptPack(input: unknown): { pack: KomentoScriptPack | null; validation: KomentoValidationResult } {
  const validation = validateKomentoScriptPack(input);
  if (!validation.valid) {
    return { pack: null, validation };
  }
  return { pack: input as KomentoScriptPack, validation };
}
