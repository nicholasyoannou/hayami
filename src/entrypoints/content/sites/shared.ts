export interface MapperSeasonSlice {
  start: number;
  end: number;
}

export interface OrderedMapperEntry {
  idx: number;
  episodeCount: number;
  hasZero?: boolean;
}

export function parseEpisodeFromTitle(title: unknown): number | null {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (!trimmed) return null;

  // Common case for manual mapper selectors that point to a compact episode number node.
  if (/^\d{1,4}$/u.test(trimmed)) {
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric)) {
      console.log('[Episode Detection] parseEpisodeFromTitle:', { title, extracted: numeric });
      return numeric;
    }
  }

  // Some sites expose episode labels like: "10 <title>" without an "Episode" prefix.
  const leadingNumericMatch = trimmed.match(/^(\d{1,4})(?:\s|$)/u);
  if (leadingNumericMatch?.[1]) {
    const leadingNumeric = Number.parseInt(leadingNumericMatch[1], 10);
    if (Number.isFinite(leadingNumeric)) {
      console.log('[Episode Detection] parseEpisodeFromTitle:', { title, extracted: leadingNumeric });
      return leadingNumeric;
    }
  }

  const patterns = [
    /\bEpisode\s*[:#\-]?\s*(\d+)\b/i,
    /\bEp\.?\s*[:#\-]?\s*(\d+)\b/i,
    /\bE\s*[:#\-]?\s*(\d+)\b/i,
  ];

  let result: number | null = null;
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      result = parseInt(match[1], 10);
      break;
    }
  }
  console.log('[Episode Detection] parseEpisodeFromTitle:', { title, extracted: result });
  return result;
}

export function parseMapperYear(year: any): number | null {
  if (!year || year === 'movies') {
    return null;
  }
  const parsed = parseInt(String(year), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getEpisodeAirYear(metadata: any): number | null {
  if (!metadata) return null;
  const rawDate = metadata.episode_air_date || metadata.upload_date || metadata.available_date;
  if (!rawDate) return null;
  const d = new Date(rawDate);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

export function isSequelTitle(name: string | undefined): boolean {
  if (!name) return false;
  return /(season\s*2|part\s*2|cour\s*2)/i.test(name);
}

export function normalizeForMatch(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreSeasonTitleMatch(name: string | undefined, seasonTitle: string | undefined): number {
  const normName = normalizeForMatch(name);
  const normSeason = normalizeForMatch(seasonTitle);
  if (!normName || !normSeason) return 0;

  let score = 0;
  if (normName.includes(normSeason) || normSeason.includes(normName)) {
    score += normSeason.length * 2; // strong substring bonus
  }

  const seasonTokens = normSeason.split(' ').filter((t) => t.length >= 3);
  for (const t of seasonTokens) {
    if (normName.includes(t)) {
      score += t.length;
    }
  }

  return score;
}

export function pickPreferredSameYear(candidates: { idx: number; name?: string; episodeCount: number }[], seasonNum?: number): number | null {
  if (candidates.length === 0) return null;
  if (seasonNum === 1) {
    const nonSequel = candidates.find((c) => !isSequelTitle(c.name));
    if (nonSequel) return nonSequel.idx;
  }
  return candidates[0].idx;
}

export function buildMapperSlicesForCrSeasons(
  crSeasons: any[] | undefined,
  orderedMapper: OrderedMapperEntry[],
): Record<number, MapperSeasonSlice> {
  const slices: Record<number, MapperSeasonSlice> = {};
  if (!Array.isArray(crSeasons) || crSeasons.length === 0 || orderedMapper.length === 0) {
    return slices;
  }

  const sortedCr = [...crSeasons].sort(
    (a, b) => (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0),
  );

  let mapperIdx = 0;
  for (const cr of sortedCr) {
    const crSeasonNum = cr.season_sequence_number || cr.season_number;
    const crCount = cr?.number_of_episodes || 0;
    if (!crSeasonNum || crCount <= 0) continue;

    const start = mapperIdx;
    let remaining = crCount;
    while (remaining > 0 && mapperIdx < orderedMapper.length) {
      const lengthCount = orderedMapper[mapperIdx].episodeCount;
      const nextRemaining = remaining - lengthCount;

      if (nextRemaining < 0 && mapperIdx > start && Math.abs(nextRemaining) > lengthCount / 2) {
        break;
      }

      remaining -= lengthCount;
      mapperIdx += 1;
    }
    const end = Math.max(start, mapperIdx - 1);
    slices[crSeasonNum] = { start, end };
  }

  const invalid = Object.values(slices).some((s) => s.start >= orderedMapper.length || s.start > s.end);
  if (invalid) {
    const evenSlices: Record<number, MapperSeasonSlice> = {};
    let idx = 0;
    for (let i = 0; i < sortedCr.length; i++) {
      const crSeasonNum = sortedCr[i].season_sequence_number || sortedCr[i].season_number;
      const remainingEntries = orderedMapper.length - idx;
      const seasonsLeft = sortedCr.length - i;
      const bucket = Math.max(1, Math.ceil(remainingEntries / seasonsLeft));
      const start = idx;
      const end = Math.min(orderedMapper.length - 1, idx + bucket - 1);
      evenSlices[crSeasonNum] = { start, end };
      idx = end + 1;
      if (idx >= orderedMapper.length) {
        for (let j = i + 1; j < sortedCr.length; j++) {
          const seasonNum = sortedCr[j].season_sequence_number || sortedCr[j].season_number;
          evenSlices[seasonNum] = { start: orderedMapper.length, end: orderedMapper.length - 1 };
        }
        break;
      }
    }
    return evenSlices;
  }

  return slices;
}

export function findSliceEpisodeMatch(
  seasonNum: number | undefined,
  episodeWithinSeason: number | undefined,
  seasonsData: any[] | undefined,
  orderedMapper: OrderedMapperEntry[],
): { idx: number; episode: number } | null {
  const slices = buildMapperSlicesForCrSeasons(seasonsData, orderedMapper);
  const debugCapture: any = {
    seasonNum,
    episodeWithinSeason,
    orderedMapper: orderedMapper.map((o) => ({ idx: o.idx, episodeCount: o.episodeCount, hasZero: !!o.hasZero })),
    seasonsDataSlice: Array.isArray(seasonsData)
      ? seasonsData.map((s) => ({
          season_sequence_number: s.season_sequence_number,
          season_number: s.season_number,
          number_of_episodes: s.number_of_episodes,
        }))
      : null,
    slices,
    iterations: [] as any[],
    match: null as any,
  };
  if (typeof window !== 'undefined') {
    (window as any).__lastMapperLogs = debugCapture;
  } else {
    (globalThis as any).__lastMapperLogs = debugCapture;
  }
  console.log('[Mapper Debug] findSliceEpisodeMatch called', {
    seasonNum,
    episodeWithinSeason,
    orderedMapper: orderedMapper.map((o) => ({ idx: o.idx, episodeCount: o.episodeCount, hasZero: !!o.hasZero })),
    seasonsDataSlice: Array.isArray(seasonsData)
      ? seasonsData.map((s) => ({
          season_sequence_number: s.season_sequence_number,
          season_number: s.season_number,
          number_of_episodes: s.number_of_episodes,
        }))
      : null,
    slices,
  });
  if (!seasonNum || episodeWithinSeason === undefined || episodeWithinSeason === null) return null;
  const slice = slices[seasonNum];
  if (!slice) return null;

  const episodesBeforeSeason = Array.isArray(seasonsData)
    ? seasonsData
        .filter((s) => (s.season_sequence_number || s.season_number || 0) < seasonNum)
        .reduce((sum, s) => sum + (s.number_of_episodes || 0), 0)
    : 0;

  const currentSeasonEpisodes = Array.isArray(seasonsData)
    ? seasonsData.find((s) => (s.season_sequence_number || s.season_number || 0) === seasonNum)?.number_of_episodes || 0
    : 0;

  const cumulativeBeforeSlice = orderedMapper
    .slice(0, Math.min(slice.start, orderedMapper.length))
    .reduce((sum, entry) => sum + (entry.hasZero ? Math.max(1, entry.episodeCount - 1) : entry.episodeCount), 0);

  let cumulative = 0;
  for (let i = slice.start; i <= slice.end && i < orderedMapper.length; i++) {
    const entry = orderedMapper[i];
    const effectiveLength = entry.hasZero ? Math.max(1, entry.episodeCount - 1) : entry.episodeCount;
    const local = episodeWithinSeason - cumulative;

    let episode: number | null = null;
    if (entry.hasZero) {
      // For zero-indexed seasons, allow the pre-numbered special at local 0, then map CR ep1→ep1 for the rest.
      if (local === 0) {
        episode = 0;
      } else if (local >= 1 && local <= effectiveLength) {
        episode = local;
      }
    } else {
      if (local >= 1 && local <= effectiveLength) {
        episode = local;
      }
    }

    const iterationLog = {
      seasonNum,
      episodeWithinSeason,
      mapperIdx: entry.idx,
      hasZero: !!entry.hasZero,
      lengthCount: effectiveLength,
      cumulative,
      local,
      sliceStart: slice.start,
      sliceEnd: slice.end,
      mapperLength: orderedMapper.length,
      resolvedEpisode: episode,
    };
    debugCapture.iterations.push(iterationLog);
    console.log('[Mapper Debug] slice iteration', iterationLog);

    if (episode !== null) {
      const matchLog = {
        slice,
        mapperIdx: entry.idx,
        hasZero: !!entry.hasZero,
        cumulative,
        lengthCount: effectiveLength,
        episodeWithinSeason,
        local,
        resolvedEpisode: episode,
      };
      debugCapture.match = matchLog;
      console.log('[Mapper Debug] slice match found', matchLog);
      return { idx: entry.idx, episode };
    }

    cumulative += effectiveLength;
  }

  // If CR episode exceeds the total length of the slice (e.g., dub numbering rolls past expected count),
  // fall back to the first mapper entry in the slice, mapping to episode 1 (or 0 when available).
  if (episodeWithinSeason > cumulative && slice.start < orderedMapper.length) {
    const first = orderedMapper[slice.start];
    const firstLength = first.hasZero ? Math.max(1, first.episodeCount - 1) : first.episodeCount;
    const prevEntry = slice.start > 0 ? orderedMapper[slice.start - 1] : null;
    const prevLength = prevEntry ? (prevEntry.hasZero ? Math.max(1, prevEntry.episodeCount - 1) : prevEntry.episodeCount) : 0;
    // Prefer to anchor overflow to the CR season's own episode count when the CR numbering rolls past that count (e.g., S2 dub uses 26+).
    // Otherwise fall back to aligning to the start of this slice (mapper cumulative before slice minus the preceding mapper length).
    const alignedBaseline = cumulativeBeforeSlice - prevLength > 0 ? cumulativeBeforeSlice - prevLength : cumulativeBeforeSlice;
    const baseline = currentSeasonEpisodes > 0 && episodeWithinSeason > currentSeasonEpisodes ? currentSeasonEpisodes : alignedBaseline;
    const overflow = Math.max(1, episodeWithinSeason - baseline);

    // If the overflow is small (e.g., E26 when CR season len is 25), keep anchoring to the first entry.
    // When the overflow is large (e.g., E50) and the slice carries multiple mapper entries, bias to the
    // latest multi-episode entry so later cours are chosen over the first cour.
    const sliceEntries = orderedMapper.slice(slice.start, Math.min(slice.end + 1, orderedMapper.length));
    const multiEntries = sliceEntries.filter((e) => (e.hasZero ? Math.max(1, e.episodeCount - 1) : e.episodeCount) > 1);
    const lastMulti = multiEntries.length > 0 ? multiEntries[multiEntries.length - 1] : null;

    let fallbackTarget = first;
    let fallbackEpisode = Math.min(overflow, firstLength);

    if (overflow > firstLength && lastMulti) {
      const lastLen = lastMulti.hasZero ? Math.max(1, lastMulti.episodeCount - 1) : lastMulti.episodeCount;
      const remainingAfterFirst = overflow - firstLength;
      fallbackTarget = lastMulti;
      fallbackEpisode = Math.min(lastLen, remainingAfterFirst);
    }

    console.log('[Mapper Debug] slice overrun; falling back within slice', {
      seasonNum,
      episodeWithinSeason,
      slice,
      cumulativeFinal: cumulative,
      cumulativeBeforeSlice,
      episodesBeforeSeason,
      currentSeasonEpisodes,
      prevLength,
      baseline,
      fallbackIdx: fallbackTarget.idx,
      fallbackEpisode,
    });
    return { idx: fallbackTarget.idx, episode: fallbackEpisode };
  }

  console.log('[Mapper Debug] slice match not found', { seasonNum, episodeWithinSeason, slice, cumulativeFinal: cumulative });
  return null;
}
