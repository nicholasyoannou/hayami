<script setup lang="ts">
/**
 * Surfaces host permissions Hayami needs but hasn't been granted, with a
 * one-gesture "Allow" that requests the missing ones.
 *
 * Hayami declares its hosts as OPTIONAL on every browser (see wxt.config.ts) and
 * none are auto-granted, so until the user approves, comment and media loading
 * silently fails. Renders nothing once every passed-in origin is granted.
 *
 * Look: an amber "Site permissions needed" card (popup Home).
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { browser } from 'wxt/browser';
import { streamingSiteHosts } from '@/config';
import { containsOrigins, requestOrigins } from '@/utils/permissions';

const props = defineProps<{
  /** Host match patterns Hayami needs for this context. */
  origins: string[];
}>();

const missing = ref<string[]>([]);
const requesting = ref(false);

// Match patterns ('https://www.reddit.com/*', '*://*.crunchyroll.com/*') → bare
// host ('www.reddit.com', 'crunchyroll.com').
function patternToHost(pattern: string): string {
  return pattern
    .replace(/^\*:\/\//, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\*\./, '');
}

// Registrable site for display/dedupe. Reddit has four patterns (www/api/oauth/
// old) but is one site, so collapse to the last two labels — correct for every
// host in our config (all single-label public suffixes: .com/.net/.co/.moe/.cc).
function siteDomain(pattern: string): string {
  const host = patternToHost(pattern);
  const parts = host.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : host;
}

function faviconFor(pattern: string): string {
  const host = patternToHost(pattern);
  if (!host) return 'https://www.google.com/s2/favicons?domain=';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

const STREAMING_DOMAINS = new Set(streamingSiteHosts.map(siteDomain));

function purposeFor(domain: string): string {
  if (STREAMING_DOMAINS.has(domain)) return 'built-in streaming site';
  return 'comments & media';
}

// Distinct sites among the missing patterns (keeps the first pattern per site
// for the favicon), sorted so streaming/discussion sites surface above CDNs.
const missingSites = computed(() => {
  const seen = new Map<string, string>();
  for (const pattern of missing.value) {
    const domain = siteDomain(pattern);
    if (!seen.has(domain)) seen.set(domain, pattern);
  }
  return Array.from(seen, ([domain, pattern]) => ({ domain, pattern, purpose: purposeFor(domain) }))
    .sort((a, b) => Number(b.purpose !== 'comments & media') - Number(a.purpose !== 'comments & media'));
});

const show = computed(() => missing.value.length > 0);

function isBroadOrigin(o: string): boolean {
  return o === '<all_urls>' || o === '*://*/*' || o === 'http://*/*' || o === 'https://*/*';
}

async function refresh() {
  // "Always Allow on Every Website" grants a broad origin pattern that Safari's
  // per-host permissions.contains() doesn't report as covering specific hosts —
  // so the alert would wrongly persist and its Allow button (re-requesting the
  // already-granted <all_urls>) would no-op. Read the ACTUAL granted origins and
  // treat any broad pattern as full coverage.
  try {
    const all = await browser.permissions.getAll();
    if (((all && all.origins) || []).some(isBroadOrigin)) { missing.value = []; return; }
  } catch { /* fall through to the per-host check */ }
  const checks = await Promise.all(
    props.origins.map(async (origin) => ({ origin, granted: await containsOrigins([origin]) })),
  );
  missing.value = checks.filter((c) => !c.granted).map((c) => c.origin);
}

async function allow() {
  if (requesting.value || !missing.value.length) return;
  requesting.value = true;
  try {
    // Request the missing hosts — Safari prompts per-site (it won't let an
    // extension request broad <all_urls>; that's user-opt-in via Safari's UI).
    // Snapshot to a plain array — a Vue reactive proxy can't be structured-cloned
    // into the native permissions API.
    await requestOrigins([...missing.value]);
  } finally {
    requesting.value = false;
  }
  await refresh();
}

const onPermChange = () => { void refresh(); };

// Re-check when the caller's origin set changes (e.g. user toggles a built-in
// site in settings while the popup is open).
watch(() => props.origins, () => { void refresh(); }, { deep: true });

onMounted(() => {
  void refresh();
  try { browser.permissions?.onAdded?.addListener?.(onPermChange); } catch {}
  try { browser.permissions?.onRemoved?.addListener?.(onPermChange); } catch {}
});

onUnmounted(() => {
  try { browser.permissions?.onAdded?.removeListener?.(onPermChange); } catch {}
  try { browser.permissions?.onRemoved?.removeListener?.(onPermChange); } catch {}
});
</script>

<template>
  <!-- Amber card — popup Home view. -->
  <div v-if="show" class="msp-card">
    <div class="msp-card-head">
      <div class="msp-card-heading">
        <p class="msp-card-title">Site permissions needed</p>
        <p class="msp-card-sub">Hayami needs access to sites to provide comments to you.</p>
      </div>
      <button class="msp-card-btn" type="button" :disabled="requesting" @click="allow">
        <span v-if="requesting" class="msp-spinner" aria-hidden="true"></span>
        <span v-else>Allow all</span>
      </button>
    </div>
    <p class="msp-card-count">{{ missingSites.length }} site{{ missingSites.length === 1 ? '' : 's' }} need access</p>
    <div class="msp-list">
      <div v-for="site in missingSites" :key="site.domain" class="msp-row">
        <img :src="faviconFor(site.pattern)" :alt="site.domain" class="msp-favicon" referrerpolicy="no-referrer" />
        <div class="msp-row-text">
          <div class="msp-row-domain">{{ site.domain }}</div>
          <div class="msp-row-purpose">{{ site.purpose }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msp-spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: msp-spin 0.7s linear infinite;
}

@keyframes msp-spin { to { transform: rotate(360deg); } }

.msp-card {
  padding: 18px 20px;
  border-radius: 24px;
  border: 1px solid rgba(252, 211, 77, 0.3);
  background: rgba(245, 158, 11, 0.1);
}

.msp-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.msp-card-heading { min-width: 0; }
.msp-card-title { margin: 0; font-size: 14px; font-weight: 600; color: #fde68a; }
.msp-card-sub { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: rgba(253, 230, 138, 0.8); }

.msp-card-btn {
  flex-shrink: 0;
  min-width: 76px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 13px;
  border: 0;
  border-radius: 999px;
  background: rgba(252, 211, 77, 0.2);
  color: #fde68a;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.msp-card-btn:hover:not(:disabled) { background: rgba(252, 211, 77, 0.3); }
.msp-card-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.msp-card-count { margin: 0 0 8px; font-size: 12px; color: rgba(253, 230, 138, 0.8); }
.msp-list { display: flex; flex-direction: column; gap: 7px; }

.msp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.15);
}

.msp-favicon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}

.msp-row-text { min-width: 0; }
.msp-row-domain { font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msp-row-purpose { font-size: 11px; color: rgba(255, 255, 255, 0.55); }
</style>
