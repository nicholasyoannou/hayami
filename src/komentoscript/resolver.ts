import type {
  KomentoDisplayPlacement,
  KomentoPlacement,
  KomentoPlacementMap,
  KomentoRuntimeCandidate,
  KomentoScriptPack,
  KomentoTarget,
  ResolveKomentoOptions,
} from './types';

const DISPLAY_PLACEMENTS: KomentoDisplayPlacement[] = ['below', 'insert', 'replace', 'popup', 'icon'];

function isDisplayPlacement(value: unknown): value is KomentoDisplayPlacement {
  return typeof value === 'string' && DISPLAY_PLACEMENTS.includes(value as KomentoDisplayPlacement);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, incoming: Partial<T>): T {
  if (!isObject(base) || !isObject(incoming)) {
    return (incoming as T) ?? base;
  }

  const out: Record<string, unknown> = { ...base };
  Object.entries(incoming).forEach(([key, value]) => {
    const existing = out[key];
    if (isObject(existing) && isObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  });

  return out as T;
}

function asPlacement(value: unknown): KomentoPlacement | null {
  if (!isObject(value)) return null;
  if (!isDisplayPlacement(value.display)) return null;
  return value as KomentoPlacement;
}

type PlacementCandidate = {
  display: KomentoDisplayPlacement;
  definition: Record<string, unknown>;
};

function asPlacementMapCandidates(value: unknown): PlacementCandidate[] {
  if (!isObject(value) || 'display' in value) return [];

  const out: PlacementCandidate[] = [];
  for (const [key, definition] of Object.entries(value)) {
    if (!isDisplayPlacement(key) || !isObject(definition)) continue;
    out.push({ display: key, definition });
  }

  return out;
}

function placementFromCandidate(candidate: PlacementCandidate): KomentoPlacement {
  const {
    default: _default,
    display: _display,
    ...rest
  } = candidate.definition;

  return {
    display: candidate.display,
    ...(rest as Omit<KomentoPlacement, 'display'>),
  };
}

export function resolveKomentoPlacement(
  placement: KomentoTarget['placement'] | null | undefined,
  preferredDisplay?: string | null,
): KomentoPlacement | undefined {
  const direct = asPlacement(placement);
  if (direct) {
    return direct;
  }

  const candidates = asPlacementMapCandidates(placement as KomentoPlacementMap | undefined);
  if (!candidates.length) return undefined;

  const preferred = isDisplayPlacement(preferredDisplay)
    ? candidates.find((candidate) => candidate.display === preferredDisplay)
    : undefined;
  if (preferred) {
    return placementFromCandidate(preferred);
  }

  const preferredDefault = candidates.find((candidate) => candidate.definition.default === true);
  if (preferredDefault) {
    return placementFromCandidate(preferredDefault);
  }

  return placementFromCandidate(candidates[0]);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function pathMatches(pathname: string, globs?: string[]): boolean {
  if (!globs || globs.length === 0) return true;
  return globs.some((glob) => globToRegex(glob).test(pathname));
}

function pathExcluded(pathname: string, globs?: string[]): boolean {
  if (!globs || globs.length === 0) return false;
  return globs.some((glob) => globToRegex(glob).test(pathname));
}

function targetPriorityFor(target: KomentoTarget): number {
  return Number.isFinite(target.priority) ? Number(target.priority) : 0;
}

function updatedEpochFor(pack: KomentoScriptPack): number {
  const parsed = Date.parse(pack.updatedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickProfileTargets(pack: KomentoScriptPack, activeProfileId?: string): Set<string> | null {
  if (!pack.profiles) return null;

  const profile = (activeProfileId && pack.profiles[activeProfileId]) || pack.profiles.default;
  if (!profile || !Array.isArray(profile.enabledTargets) || profile.enabledTargets.length === 0) {
    return null;
  }

  return new Set(profile.enabledTargets);
}

function resolveExtendedTarget(pack: KomentoScriptPack, target: KomentoTarget, stack: string[] = []): KomentoTarget {
  if (!target.extends) return target;

  if (stack.includes(target.targetId)) {
    return target;
  }

  const parent = pack.targets.find((item) => item.targetId === target.extends);
  if (!parent) return target;

  const resolvedParent = resolveExtendedTarget(pack, parent, [...stack, target.targetId]);
  if (target.mergeMode === 'replace') {
    return {
      ...resolvedParent,
      ...target,
      targetId: target.targetId,
    };
  }

  return deepMerge(resolvedParent, {
    ...target,
    targetId: target.targetId,
  });
}

export function collectMatchingKomentoTargets(
  packs: KomentoScriptPack[],
  location: Pick<Location, 'origin' | 'pathname'>,
  options?: ResolveKomentoOptions,
): KomentoRuntimeCandidate[] {
  const out: KomentoRuntimeCandidate[] = [];

  for (const pack of packs) {
    const allowedTargets = pickProfileTargets(
      pack,
      options?.activeProfilesBySourceId?.[pack.id],
    );
    const enabledTargetIds = options?.enabledTargetIdsBySourceId?.[pack.id];
    const enabledTargets = Array.isArray(enabledTargetIds) ? new Set(enabledTargetIds) : null;

    for (const rawTarget of pack.targets) {
      if (allowedTargets && !allowedTargets.has(rawTarget.targetId)) {
        continue;
      }
      if (enabledTargets && !enabledTargets.has(rawTarget.targetId)) {
        continue;
      }

      const target = resolveExtendedTarget(pack, rawTarget);
      const match = target.match;
      const originMatches = Array.isArray(match.origins) && match.origins.includes(location.origin);
      if (!originMatches) continue;

      const include = pathMatches(location.pathname, match.pathGlobs);
      const exclude = pathExcluded(location.pathname, match.excludePathGlobs);
      if (!include || exclude) continue;

      out.push({
        pack,
        sourceId: pack.id,
        target,
        targetPriority: targetPriorityFor(target),
        updatedAtEpoch: updatedEpochFor(pack),
      });
    }
  }

  return out;
}

function compareCandidates(a: KomentoRuntimeCandidate, b: KomentoRuntimeCandidate): number {
  if (a.updatedAtEpoch !== b.updatedAtEpoch) return b.updatedAtEpoch - a.updatedAtEpoch;
  if (a.targetPriority !== b.targetPriority) return b.targetPriority - a.targetPriority;
  if (a.sourceId !== b.sourceId) return a.sourceId.localeCompare(b.sourceId);
  return a.target.targetId.localeCompare(b.target.targetId);
}

export function resolveEffectiveKomentoTarget(
  candidates: KomentoRuntimeCandidate[],
): KomentoRuntimeCandidate | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort(compareCandidates);
  return sorted[0] || null;
}

export function mergeEffectiveKomentoTarget(
  candidates: KomentoRuntimeCandidate[],
): KomentoRuntimeCandidate | null {
  if (!candidates.length) return null;

  const sorted = [...candidates].sort(compareCandidates);
  const [first, ...rest] = sorted;
  if (!first) return null;

  let mergedTarget = first.target;
  for (const candidate of rest) {
    mergedTarget = deepMerge(mergedTarget, candidate.target);
  }

  return {
    ...first,
    target: mergedTarget,
  };
}
