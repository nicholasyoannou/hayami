// Quick local harness to inspect slice mapping for Mushoku Tensei S2 E13
// Run with: bun x ts-node scripts/mapping-debug.ts  (or) bun run tsx scripts/mapping-debug.ts

import { __mappingDebug } from '../src/entrypoints/content/mapping';

interface MapperEntry {
  idx: number;
  episodeCount: number;
  name: string;
  year: number | null;
  hasZero: boolean;
}

// Crunchyroll seasons data (from API response)
const crSeasons = [
  { season_sequence_number: 1, season_number: 1, number_of_episodes: 24 },
  { season_sequence_number: 2, season_number: 2, number_of_episodes: 25 },
];

// Hayami mapper results (abbreviated to fields we need)
const mapperRaw = [
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

function orderMapper(raw: typeof mapperRaw): MapperEntry[] {
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

function runEpisode(seasonNum: number, episodeWithinSeason: number) {
  const ordered = orderMapper(mapperRaw);
  const slices = __mappingDebug.buildMapperSlicesForCrSeasons(crSeasons, ordered);
  const match = __mappingDebug.findSliceEpisodeMatch(seasonNum, episodeWithinSeason, crSeasons, ordered);
  console.log('\nCR season', seasonNum, 'episode', episodeWithinSeason);
  console.log('Ordered mapper:', ordered);
  console.log('Slices:', slices);
  console.log('Match:', match);
  if (match) {
    const mapperEntry = mapperRaw[match.idx];
    console.log('Mapped to mapper idx', match.idx, 'name:', mapperEntry.anime_name);
  }
}

// Crunchyroll Season 2, Episode 0 (E0 "Guardian Fitz")
runEpisode(2, 0);

// Crunchyroll Season 2, Episode 13 (E13 "My Dream Home")
runEpisode(2, 13);
