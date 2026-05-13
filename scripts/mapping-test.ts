import { __mappingTest } from '../src/entrypoints/content/mapping';

// Minimal mapper results to simulate AoT seasons
const mapperResults = [
  {
    anime_name: 'Attack on Titan',
    year: '2013',
    episodes: buildEpisodes(25),
  },
  {
    anime_name: 'Attack on Titan Season 2',
    year: '2017',
    episodes: buildEpisodes(12),
  },
  {
    anime_name: 'Attack on Titan Season 3',
    year: '2018',
    episodes: buildEpisodes(22),
  },
];

const seasonsData = [
  { season_sequence_number: 1, season_number: 1, number_of_episodes: 27 },
  { season_sequence_number: 2, season_number: 2, number_of_episodes: 12 },
  { season_sequence_number: 3, season_number: 3, number_of_episodes: 22 },
];

function buildEpisodes(count: number) {
  const eps: Record<string, string> = {};
  for (let i = 1; i <= count; i++) {
    eps[String(i)] = `https://reddit.test/${i}`;
  }
  return eps;
}

function assertEqual(label: string, actual: number | null, expected: number) {
  if (actual !== expected) {
    console.error(`${label} FAILED: expected ${expected}, got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`${label} OK -> ${actual}`);
  }
}

function runCase(crEpisodeNumber: number, sequenceNumber: number, expected: number) {
  const result = __mappingTest.mapEpisodeWithSeasonsData(
    crEpisodeNumber,
    sequenceNumber,
    3,
    seasonsData,
    mapperResults[2],
    mapperResults,
    2,
  );
  assertEqual(`CR ep ${crEpisodeNumber} seq ${sequenceNumber}`, result, expected);
}

runCase(38, 38, 1);
runCase(39, 39, 2);

// Ascendance of a Bookworm collapsed CR season (all episodes in one bucket, global ordinal numbering)
const bookwormMapper = [
  { anime_name: 'Honzuki no Gekokujou (Ascendance of a Bookworm)', year: '2019', episodes: buildEpisodes(14) },
  { anime_name: 'Honzuki no Gekokujou Season 2** (Ascendance of a Bookworm Season 2)', year: '2020', episodes: buildEpisodes(12) },
  { anime_name: 'Honzuki no Gekokujou: Shisho ni Naru Tame ni wa Shudan wo Erandeiraremasen Season 3 (Ascendance of a Bookworm Season 3)', year: '2022', episodes: buildEpisodes(10) },
];

const bookwormSeasons = [
  { season_sequence_number: 1, season_number: 1, number_of_episodes: 40 }, // CR collapsed bucket
];

function runBookwormCase(crEpisodeNumber: number, sequenceNumber: number, expected: number) {
  const result = __mappingTest.mapEpisodeWithSeasonsData(
    crEpisodeNumber,
    sequenceNumber,
    1,
    bookwormSeasons,
    bookwormMapper[2],
    bookwormMapper,
    2,
  );
  assertEqual(`Bookworm CR ep ${crEpisodeNumber} seq ${sequenceNumber}`, result, expected);
}

runBookwormCase(35, 35, 9);

// Tojima single-season case with noisy other search results; should stay on episode 15.
const tojimaMapper = [
  { anime_name: 'Fate/Zero - [Season 2 here](http://www.reddit.com/r/anime/wiki/discussion_archive/2012#wiki_spring)', year: '2011', episodes: buildEpisodes(11) },
  { anime_name: 'Fate/Zero 2nd Season - [Season 1 here](http://www.reddit.com/r/anime/wiki/discussion_archive/2011#wiki_fall)', year: '2012', episodes: buildEpisodes(11) },
  { anime_name: 'Peeping Life TV: Season 1??', year: '2015', episodes: buildEpisodes(12) },
  { anime_name: '12-sai.: Chicchana Mune no Tokimeki 2nd Season (Age 12., Juuni-sai.)', year: '2016', episodes: buildEpisodes(8) },
  { anime_name: 'Toujima Tanzaburou wa Kamen Rider ni Naritai (Tojima Wants to Be a Kamen Rider)', year: '2025', episodes: buildEpisodes(15) },
];

const tojimaSeasons = [{ season_sequence_number: 1, season_number: 1, number_of_episodes: 15 }];

function runTojimaCase(crEpisodeNumber: number, sequenceNumber: number, expected: number) {
  const result = __mappingTest.mapEpisodeWithSeasonsData(
    crEpisodeNumber,
    sequenceNumber,
    1,
    tojimaSeasons,
    tojimaMapper[4],
    tojimaMapper,
    4,
  );
  assertEqual(`Tojima CR ep ${crEpisodeNumber} seq ${sequenceNumber}`, result, expected);
}

runTojimaCase(15, 15, 15);

// Arne S1 should stay on episode 3 even when other results include a higher-scoring different-year season.
const arneMapper = [
  {
    anime_name: 'Arne no Jikenbo (The Case Book of Arne)',
    year: '2026',
    episodes: {
      1: 'https://reddit.test/arne-1',
      2: 'https://reddit.test/arne-1',
      3: 'https://reddit.test/arne-3',
    },
  },
  { anime_name: 'Yami Shibai Season 15', year: '2025', episodes: buildEpisodes(4) },
];

const arneSeasons = [{ season_sequence_number: 1, season_number: 1, number_of_episodes: 3 }];

function runArneCase(crEpisodeNumber: number, sequenceNumber: number, expected: number) {
  const result = __mappingTest.mapEpisodeWithSeasonsData(
    crEpisodeNumber,
    sequenceNumber,
    1,
    arneSeasons,
    arneMapper[0],
    arneMapper,
    0,
  );
  assertEqual(`Arne CR ep ${crEpisodeNumber} seq ${sequenceNumber}`, result, expected);
}

runArneCase(3, 3, 3);

if (process.exitCode === undefined) {
  console.log('All mapping tests passed.');
}
