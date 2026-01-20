import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  process.env.MALSYNC_ROOT,
  'https://chibi.malsync.moe/config',
  'https://raw.githubusercontent.com/MALSync/chibi/master/config',
  'https://raw.githubusercontent.com/MALSync/MALSync/master/chibi/config',
]
  .filter(Boolean)
  .map(r => r.replace(/\/$/, ''));
const outputPath = process.env.MALSYNC_OUTPUT || 'src/lib/chibi/malsync-pages.json';
const allowedTypes = new Set(
  (process.env.MALSYNC_TYPES || 'anime')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
);
const syncKeys = ['getTitle', 'getIdentifier', 'getEpisode', 'getOverviewUrl', 'getImage', 'nextEpUrl'];
let activeRoot = roots[0];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed fetch ${url}: ${res.status}`);
  return res.json();
}

async function fetchJsonFromRoots(relPath, preferredRoot) {
  const attempts = preferredRoot
    ? [preferredRoot, ...roots.filter(r => r !== preferredRoot)]
    : roots;

  const trimmed = relPath.replace(/^\//, '');
  const errors = [];

  for (const base of attempts) {
    const url = `${base}/${trimmed}`;
    try {
      const data = await fetchJson(url);
      return { data, root: base };
    } catch (err) {
      errors.push(`${url}: ${err?.message || err}`);
    }
  }

  throw new Error(`Failed to fetch ${trimmed} from all roots:\n${errors.join('\n')}`);
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

function typeMatches(meta) {
  const norm = String(meta?.type || '').toLowerCase();
  const hasFilter = allowedTypes.size > 0;
  if (!norm) return !hasFilter || allowedTypes.has('');
  if (allowedTypes.has(norm)) return true;
  if (allowedTypes.has('anime') && norm.includes('anime')) return true;
  if (!hasFilter && norm.includes('anime')) return true; // permissive default
  return false;
}

async function main() {
  const { data: list, root: discoveredRoot } = await fetchJsonFromRoots('list.json');
  activeRoot = discoveredRoot || roots[0];
  if (!list || !list.pages) throw new Error('Unexpected list.json shape');

  const pageEntries = Object.entries(list.pages).filter(([, meta]) =>
    meta && typeMatches(meta),
  );

  const results = {};
  const queue = [...pageEntries];
  const concurrency = Number(process.env.MALSYNC_CONCURRENCY || 8);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) break;
      const [key, meta] = entry;
      try {
        const { data: page } = await fetchJsonFromRoots(`pages/${key}.json`, activeRoot);
        results[key] = trimPage(meta, page);
        process.stdout.write('.');
      } catch (err) {
        console.warn(`\nFailed to fetch ${key}:`, err?.message || err);
      }
    }
  });

  await Promise.all(workers);
  process.stdout.write(`\nFetched ${Object.keys(results).length} anime pages.\n`);

  const sorted = Object.fromEntries(
    Object.entries(results).sort(([a], [b]) => a.localeCompare(b)),
  );

  const fullOutput = {
    source: activeRoot,
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
