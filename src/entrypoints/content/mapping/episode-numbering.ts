type CourPartMarker = {
  kind: 'cour' | 'part' | 'season';
  number: number;
};

export type CourRelativeEpisodeInference = CourPartMarker & {
  episode: number;
  span: number;
  offset: number;
};

export type PlannedCountEpisodeInference = {
  episode: number;
  plannedEpisodeCount: number;
  offset: number;
};

function compareByHighestEpisodeThenSmallestSpan(
  a: CourRelativeEpisodeInference,
  b: CourRelativeEpisodeInference,
): number {
  if (a.episode !== b.episode) return b.episode - a.episode;
  return a.span - b.span;
}

function extractCourPartMarker(titles: Array<string | null | undefined>): CourPartMarker | null {
  for (const title of titles) {
    const text = String(title || '').trim();
    if (!text) continue;

    const suffixMatch = text.match(/\b(cour|part)\s*(\d{1,2})\b/i);
    if (suffixMatch?.[1] && suffixMatch?.[2]) {
      const number = Number.parseInt(suffixMatch[2], 10);
      if (Number.isFinite(number) && number > 1) {
        return { kind: suffixMatch[1].toLowerCase() as 'cour' | 'part', number };
      }
    }

    const prefixMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(cour|part)\b/i);
    if (prefixMatch?.[1] && prefixMatch?.[2]) {
      const number = Number.parseInt(prefixMatch[1], 10);
      if (Number.isFinite(number) && number > 1) {
        return { kind: prefixMatch[2].toLowerCase() as 'cour' | 'part', number };
      }
    }

    const seasonSuffixMatch = text.match(/\bseason\s*(\d{1,2})\b/i);
    if (seasonSuffixMatch?.[1]) {
      const number = Number.parseInt(seasonSuffixMatch[1], 10);
      if (Number.isFinite(number) && number > 1) {
        return { kind: 'season', number };
      }
    }

    const seasonPrefixMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i);
    if (seasonPrefixMatch?.[1]) {
      const number = Number.parseInt(seasonPrefixMatch[1], 10);
      if (Number.isFinite(number) && number > 1) {
        return { kind: 'season', number };
      }
    }
  }

  return null;
}

function normalizeAvailableEpisodeKeys(keys: Iterable<string | number>): Set<number> {
  const out = new Set<number>();
  for (const key of keys) {
    const parsed = typeof key === 'number'
      ? key
      : Number.parseInt(String(key), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      out.add(parsed);
    }
  }
  return out;
}

export function inferPlannedCountEpisode(input: {
  episode: number | null | undefined;
  plannedEpisodeCount: number | null | undefined;
  availableEpisodeKeys: Iterable<string | number>;
}): PlannedCountEpisodeInference | null {
  const episode = input.episode ?? null;
  const plannedEpisodeCount = input.plannedEpisodeCount ?? null;
  if (!Number.isFinite(episode) || episode == null || episode <= 0) return null;
  if (!Number.isFinite(plannedEpisodeCount) || plannedEpisodeCount == null || plannedEpisodeCount <= 0) return null;
  if (episode <= plannedEpisodeCount) return null;

  const available = normalizeAvailableEpisodeKeys(input.availableEpisodeKeys);
  if (!available.has(plannedEpisodeCount)) return null;

  return {
    episode: plannedEpisodeCount,
    plannedEpisodeCount,
    offset: episode - plannedEpisodeCount,
  };
}

export function inferCourRelativeEpisode(input: {
  episode: number | null | undefined;
  titles: Array<string | null | undefined>;
  availableEpisodeKeys: Iterable<string | number>;
}): CourRelativeEpisodeInference | null {
  const episode = input.episode ?? null;
  if (!Number.isFinite(episode) || episode == null || episode <= 0) return null;

  const available = normalizeAvailableEpisodeKeys(input.availableEpisodeKeys);
  if (!available.size) return null;

  const maxAvailable = Math.max(...available);
  if (episode <= maxAvailable) return null;

  const marker = extractCourPartMarker(input.titles);
  if (!marker) return null;

  const spans = marker.kind === 'season' ? [12, 13, 24, 25] : [12, 13];
  const candidates: CourRelativeEpisodeInference[] = [];

  for (const span of spans) {
    const offset = (marker.number - 1) * span;
    const inferredEpisode = episode - offset;
    if (inferredEpisode > 0 && available.has(inferredEpisode)) {
      candidates.push({
        ...marker,
        episode: inferredEpisode,
        span,
        offset,
      });
    }
  }

  if (marker.kind !== 'season') return candidates[0] ?? null;
  if (candidates.length <= 1) return candidates[0] ?? null;

  // Season markers are weaker than explicit cour/part markers. Keep short
  // 12/13-span ambiguity conservative, but allow later seasons with competing
  // 24/25-span matches to pick the candidate furthest into the available
  // episode range. This covers AnimePahe-style S4 cumulative numbering:
  // Episode 77 -> S4E5 beats the weaker 25-span S4E2 interpretation.
  if (marker.number >= 3) {
    const longSeasonCandidates = candidates
      .filter((candidate) => candidate.span >= 24)
      .sort(compareByHighestEpisodeThenSmallestSpan);
    if (longSeasonCandidates.length >= 2) return longSeasonCandidates[0] ?? null;
  }

  return null;
}
