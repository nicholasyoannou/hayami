// Quick local harness to inspect slice mapping. Run with:
// bun x tsx scripts/mapping-debug.ts

import { __mappingDebug } from '../src/entrypoints/content/mapping';

interface MapperEntry {
  idx: number;
  episodeCount: number;
  name: string;
  year: number | null;
  hasZero: boolean;
}

type CrSeason = { season_sequence_number?: number; season_number?: number; number_of_episodes: number };

function orderMapper(raw: any[]): MapperEntry[] {
  return raw
    .filter((r) => r.episodes && typeof r.episodes === 'object' && Object.keys(r.episodes).length > 0 && r.year !== 'movies')
    .map((r, idx) => ({
      idx,
      episodeCount: Object.keys(r.episodes).length,
      name: r.anime_name,
      year: __mappingDebug.parseMapperYear((r as any).year),
      hasZero: Object.prototype.hasOwnProperty.call(r.episodes, '0'),
    }))
    .sort((a, b) => {
      const yearDiff = (a.year ?? 9999) - (b.year ?? 9999);
      if (yearDiff !== 0) return yearDiff;
      const sequelDiff = (__mappingDebug.isSequelTitle(a.name) ? 1 : -1) - (__mappingDebug.isSequelTitle(b.name) ? 1 : -1);
      if (sequelDiff !== 0) return sequelDiff;
      if (a.hasZero !== b.hasZero) return a.hasZero ? 1 : -1;
      return a.idx - b.idx;
    });
}

function runScenario(label: string, crSeasons: CrSeason[], mapperRaw: any[], tests: Array<{ seasonNum: number; episode: number }>) {
  console.log(`\n=== Scenario: ${label} ===`);
  const ordered = orderMapper(mapperRaw);
  const slices = __mappingDebug.buildMapperSlicesForCrSeasons(crSeasons, ordered);
  console.log('CR seasons:', crSeasons);
  console.log('Ordered mapper:', ordered);
  console.log('Slices:', slices);

  for (const t of tests) {
    const match = __mappingDebug.findSliceEpisodeMatch(t.seasonNum, t.episode, crSeasons, ordered);
    console.log(`\nCR season ${t.seasonNum} episode ${t.episode}`);
    console.log('Match:', match);
    if (match) {
      const mapperEntry = mapperRaw[match.idx];
      console.log('Mapped to mapper idx', match.idx, 'name:', mapperEntry.anime_name);
    }
  }
}

// Mushoku Tensei S2 sanity cases (E0, E13)
const mushokuCrSeasons: CrSeason[] = [
  { season_sequence_number: 1, season_number: 1, number_of_episodes: 24 },
  { season_sequence_number: 2, season_number: 2, number_of_episodes: 25 },
];

const mushokuMapper = [
  {
    anime_name: 'Mushoku Tensei: Isekai Ittara Honki Dasu Season 2 Part 2 (Mushoku Tensei: Jobless Reincarnation Season 2 Part 2)',
    year: '2024',
    episodes: {
      1: 'https://www.reddit.com/r/anime/comments/1by6nm7',
      2: 'https://www.reddit.com/r/anime/comments/1c3vn14',
      3: 'https://www.reddit.com/r/anime/comments/1c9k20a',
      4: 'https://www.reddit.com/r/anime/comments/1cf8mcj',
      5: 'https://www.reddit.com/r/anime/comments/1cktcif',
      6: 'https://www.reddit.com/r/anime/comments/1cqa0ba',
      7: 'https://www.reddit.com/r/anime/comments/1d13bvg',
      8: 'https://www.reddit.com/r/anime/comments/1d6fhtx',
      9: 'https://www.reddit.com/r/anime/comments/1dbwfiv',
      10: 'https://www.reddit.com/r/anime/comments/1dha58q',
      11: 'https://www.reddit.com/r/anime/comments/1dmoew7',
      12: 'https://www.reddit.com/r/anime/comments/1ds3l3k',
    },
  },
  {
    anime_name: 'Mushoku Tensei: Isekai Ittara Honki Dasu Season 2 (Mushoku Tensei: Jobless Reincarnation Season 2)',
    year: '2023',
    episodes: {
      0: 'https://www.reddit.com/r/anime/comments/14os9zz',
      1: 'https://www.reddit.com/r/anime/comments/14v32k4',
      2: 'https://www.reddit.com/r/anime/comments/151967f',
      3: 'https://www.reddit.com/r/anime/comments/157hrwh',
      4: 'https://www.reddit.com/r/anime/comments/15dogvs',
      5: 'https://www.reddit.com/r/anime/comments/15jsfn1',
      6: 'https://www.reddit.com/r/anime/comments/15q1uhs',
      7: 'https://www.reddit.com/r/anime/comments/15wefiy',
      8: 'https://www.reddit.com/r/anime/comments/162tgiq',
      9: 'https://www.reddit.com/r/anime/comments/16900wv',
      10: 'https://www.reddit.com/r/anime/comments/16f35ia',
      11: 'https://www.reddit.com/r/anime/comments/16l3n3g',
      12: 'https://www.reddit.com/r/anime/comments/16r0maa',
    },
  },
  {
    anime_name: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
    year: '2021',
    episodes: { 1: 'x1', 2: 'x2' },
  },
  {
    anime_name: 'Mushoku Tensei: Isekai Ittara Honki Dasu Part 2',
    year: '2021',
    episodes: { 1: 'y1' },
  },
];

runScenario('Mushoku Tensei S2', mushokuCrSeasons, mushokuMapper, [
  { seasonNum: 2, episode: 0 },
  { seasonNum: 2, episode: 13 },
]);

// Re:Zero S2 dub case: CR season_number=2, season_sequence_number=5, episode 26 should map to Season 2 part 1 ep 1 (hni41e).
const rezeroCrSeasons: CrSeason[] = [
  { season_sequence_number: 2, season_number: 52, number_of_episodes: 14 }, // Director's Cut
  { season_sequence_number: 4, season_number: 53, number_of_episodes: 1 }, // Frozen Bond
  { season_sequence_number: 5, season_number: 2, number_of_episodes: 25 }, // Season 2
  { season_sequence_number: 6, season_number: 3, number_of_episodes: 16 }, // Season 3
];

const rezeroMapper = [
  {
    anime_name: 'Re:Zero kara Hajimeru Isekai Seikatsu Season 3 (Re:Zero: Starting Life in Another World Season 3)',
    year: '2024',
    episodes: { 1: 'https://www.reddit.com/r/anime/comments/1fug72b/', 2: 'https://www.reddit.com/r/anime/comments/1fzsvls/' },
  },
  {
    anime_name: 'Saiyuki RELOAD -ZEROIN-',
    year: '2022',
    episodes: { 1: 'https://www.reddit.com/r/anime/comments/rxgmr9' },
  },
  {
    anime_name: 'Re:Zero kara Hajimeru Isekai Seikatsu Season 2 Part 2 (Re:Zero -Starting Life in Another World- Season 2 Part 2)',
    year: '2021',
    episodes: {
      1: 'https://www.reddit.com/r/anime/comments/krq3pe',
      2: 'https://www.reddit.com/r/anime/comments/kwisv4',
      3: 'https://www.reddit.com/r/anime/comments/l1bit5',
      4: 'https://www.reddit.com/r/anime/comments/l67arb',
      5: 'https://www.reddit.com/r/anime/comments/lbq4sg',
      6: 'https://www.reddit.com/r/anime/comments/lgw74f',
      7: 'https://www.reddit.com/r/anime/comments/llx314',
      8: 'https://www.reddit.com/r/anime/comments/lrfprl',
      9: 'https://www.reddit.com/r/anime/comments/lwwn5p',
      10: 'https://www.reddit.com/r/anime/comments/m205cm',
      11: 'https://www.reddit.com/r/anime/comments/m71scm',
      12: 'https://www.reddit.com/r/anime/comments/mc7ea5',
    },
  },
  {
    anime_name: 'Re:Zero kara Hajimeru Isekai Seikatsu Season 2** (Re:Zero - Starting Life in Another World Season 2)',
    year: '2020',
    episodes: {
      1: 'https://www.reddit.com/hni41e/',
      2: 'https://www.reddit.com/hroof3/',
      3: 'https://www.reddit.com/hvuxtx/',
      4: 'https://www.reddit.com/i01snn/',
      5: 'https://www.reddit.com/i46id6/',
      6: 'https://www.reddit.com/i8evsi/',
      7: 'https://www.reddit.com/icos1m',
      8: 'https://www.reddit.com/igzwaw',
      9: 'https://www.reddit.com/il7y3i',
      10: 'https://www.reddit.com/ipgz3o',
      11: 'https://www.reddit.com/itws50',
      12: 'https://www.reddit.com/iybar6',
    },
  },
  {
    anime_name: 'Zero kara Hajimeru Mahou no Sho (Grimoire of Zero)',
    year: '2017',
    episodes: { 1: 'https://www.reddit.com/r/anime/comments/64k45v' },
  },
  {
    anime_name: 'Re: Zero Kara Hajimeru Isekai Seikatsu',
    year: '2016',
    episodes: {
      1: 'https://redd.it/4d7an4',
      2: 'https://redd.it/4e6p7b',
      3: 'https://redd.it/4f7k6e',
      4: 'https://redd.it/4g92xe',
      5: 'https://redd.it/4ha7zy',
      6: 'https://redd.it/4ifgx9',
      7: 'https://redd.it/4jh2z1',
      8: 'https://redd.it/4kk3by',
      9: 'https://redd.it/4lm02a',
      10: 'https://redd.it/4mpa5p',
      11: 'https://redd.it/4nraro',
      12: 'https://redd.it/4ou9dm',
      13: 'https://redd.it/4pyrvu',
      14: 'https://redd.it/4r2xp6',
      15: 'https://redd.it/4s6g7i',
      16: 'https://redd.it/4tammi',
      17: 'http://redd.it/4ue59d',
      18: 'http://redd.it/4vi2mg',
      19: 'http://redd.it/4wlsei',
      20: 'https://redd.it/4xp3wm',
      21: 'https://www.reddit.com/r/anime/comments/4yw0hc/',
      22: 'https://www.reddit.com/r/anime/comments/500f6e/',
      23: 'https://www.reddit.com/r/anime/comments/51503n/',
      24: 'https://www.reddit.com/r/anime/comments/529mnx/',
      25: 'https://www.reddit.com/r/anime/comments/53d6hv/',
    },
  },
];

// In CR metadata, Season 2 carries season_sequence_number = 5; use that here.
runScenario('Re:Zero S2 (dub) CR ep 26/27/28/50', rezeroCrSeasons, rezeroMapper, [
  { seasonNum: 5, episode: 26 },
  { seasonNum: 5, episode: 27 },
  { seasonNum: 5, episode: 28 },
  { seasonNum: 5, episode: 50 },
]);
