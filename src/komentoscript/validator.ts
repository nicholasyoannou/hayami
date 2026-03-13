import type {
  KomentoExtractField,
  KomentoScriptPack,
  KomentoTarget,
  KomentoValidationIssue,
  KomentoValidationResult,
} from './types';

const DISPLAY_VALUES = new Set(['below', 'insert', 'replace', 'popup', 'icon']);
const MERGE_VALUES = new Set(['replace', 'deep']);

function pushIssue(issues: KomentoValidationIssue[], severity: 'error' | 'warning', path: string, message: string): void {
  issues.push({ severity, path, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
  }

  if (target.placement !== undefined) {
    if (!isObject(target.placement)) {
      pushIssue(issues, 'error', `${path}.placement`, 'placement must be an object.');
    } else if (!DISPLAY_VALUES.has(String(target.placement.display))) {
      pushIssue(issues, 'error', `${path}.placement.display`, 'placement.display has an invalid value.');
    }
  }

  if (target.extract !== undefined) {
    if (!isObject(target.extract)) {
      pushIssue(issues, 'error', `${path}.extract`, 'extract must be an object.');
    } else {
      Object.entries(target.extract).forEach(([key, value]) => {
        validateExtractField(value as KomentoExtractField, `${path}.extract.${key}`, issues);
      });
    }
  }

  const extract = isObject(target.extract) ? target.extract : undefined;
  const hasRequiredExtractor = Boolean(extract?.animeTitle) && Boolean(extract?.episodeNumber);
  const isPopupOnly = isObject(target.placement) && target.placement.display === 'popup';
  if (!hasRequiredExtractor && !isPopupOnly) {
    pushIssue(
      issues,
      'error',
      `${path}.extract`,
      'animeTitle and episodeNumber extractors are required unless placement.display is popup.',
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
