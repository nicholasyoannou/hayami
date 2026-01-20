import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = (process.env.MALSYNC_ROOT || 'https://chibi.malsync.moe/config').replace(/\/$/, '');
const outputPath = process.env.MALSYNC_OUTPUT || 'src/lib/chibi/malsync-pages.json';
const allowedTypes = new Set(
  (process.env.MALSYNC_TYPES || 'anime')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);
const syncKeys = ['getTitle', 'getIdentifier', 'getEpisode', 'getOverviewUrl', 'getImage', 'nextEpUrl'];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status}`);
  return res.json();
}

function pickSync(sync) {
  if (!sync || typeof sync !== 'object') return undefined;
  const out = {};
  for (const key of syncKeys) {
    if (sync[key] !== undefined) out[key] = sync[key];
  }
  return Object.keys(out).length ? out : undefined;
}

function trimPage(meta, page) {
  return {
    key: meta.key,
    name: meta.name,
    type: page.type || meta.type,
    domain: page.domain || meta.domain,
    languages: page.languages || meta.languages,
    urls: page.urls || meta.urls,
    search: meta.search || page.search,
    database: meta.database || page.database,
    version: meta.version,
    sync: pickSync(page.sync),
  };
}

async function main() {
  const list = await fetchJson(`${root}/list.json`);
  if (!list || !list.pages) throw new Error('Unexpected list.json shape');

  const pageEntries = Object.entries(list.pages).filter(([, meta]) =>
    meta && allowedTypes.has(meta.type),
  );

  const results = {};
  const queue = [...pageEntries];
  const concurrency = Number(process.env.MALSYNC_CONCURRENCY || 8);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) break;
      const [key, meta] = entry;
      const url = `${root}/pages/${key}.json`;
      const page = await fetchJson(url);
      results[key] = trimPage(meta, page);
      process.stdout.write('.');
    }
  });

  await Promise.all(workers);
  process.stdout.write(`\nFetched ${Object.keys(results).length} anime pages.\n`);

  const sorted = Object.fromEntries(
    Object.entries(results).sort(([a], [b]) => a.localeCompare(b)),
  );

  const fullOutput = {
    source: root,
    fetchedAt: new Date().toISOString(),
    pages: sorted,
  };

  const outPath = path.resolve(outputPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(fullOutput, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
