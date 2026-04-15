<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { browser } from 'wxt/browser';
import { customSiteMappingsItem } from '@/config/storage';
import type { CustomSiteMapping } from '@/entrypoints/content/ui/site-mapper/types';
import type {
  PublishProviderId,
  PublishedSelection,
  PublishedVisibility,
} from '@/config/storage';
import { usePublishedCollections } from '@/composables/usePublishedCollections';

const props = defineProps<{
  backIcon: string;
  settingsIcon: string;
  isLargeLayout?: boolean;
  onBack: () => void;
}>();

function showSuccess(message: string) {
  toastMessage.value = { text: message, kind: 'success' };
  window.setTimeout(() => { toastMessage.value = null; }, 3000);
}
function showError(message: string) {
  toastMessage.value = { text: message, kind: 'error' };
  window.setTimeout(() => { toastMessage.value = null; }, 4000);
}
const toastMessage = ref<{ text: string; kind: 'success' | 'error' } | null>(null);

const {
  collections,
  githubAuth,
  gitlabAuth,
  hasGithub,
  hasGitlab,
  busyCollectionId,
  creating,
  loadAuth,
  logoutProvider,
  createCollection,
  republishCollection,
  deleteCollection,
} = usePublishedCollections({ showSuccess, showError });

// ── Available custom sites for the selection picker ──────────────────
const allCustomSites = ref<CustomSiteMapping[]>([]);
async function loadAllCustomSites() {
  const map = (await customSiteMappingsItem.getValue()) || {};
  allCustomSites.value = Object.values(map) as CustomSiteMapping[];
}
onMounted(loadAllCustomSites);

// ── GitHub device flow UI state ──────────────────────────────────────
const ghDeviceModal = ref<null | {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  polling: boolean;
  status: 'pending' | 'error';
  statusText?: string;
}>(null);

async function send<T = any>(message: any): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

async function startGithubSignIn() {
  const result = await send<any>({ action: 'hayami_publish_github_startDeviceFlow' });
  if (!result?.ok) {
    showError(result?.error || 'Failed to start device flow');
    return;
  }
  ghDeviceModal.value = {
    userCode: result.userCode,
    verificationUri: result.verificationUri,
    deviceCode: result.deviceCode,
    intervalMs: (result.interval || 5) * 1000,
    expiresAt: Date.now() + (result.expiresIn || 900) * 1000,
    polling: true,
    status: 'pending',
  };
  await pollLoop();
}

async function pollLoop() {
  const state = ghDeviceModal.value;
  if (!state || !state.polling) return;
  if (Date.now() >= state.expiresAt) {
    state.polling = false;
    state.status = 'error';
    state.statusText = 'Code expired.';
    return;
  }
  await new Promise((r) => setTimeout(r, state.intervalMs));
  if (!ghDeviceModal.value || !ghDeviceModal.value.polling) return;
  const result = await send<any>({
    action: 'hayami_publish_github_pollDeviceFlow',
    deviceCode: state.deviceCode,
    intervalMs: state.intervalMs,
  });
  if (result?.ok) {
    ghDeviceModal.value = null;
    await loadAuth();
    showSuccess(`Signed in as ${result.state?.username || 'GitHub user'}`);
    return;
  }
  if (result?.pending) {
    state.intervalMs = result.nextIntervalMs || state.intervalMs;
    await pollLoop();
    return;
  }
  state.polling = false;
  state.status = 'error';
  state.statusText = result?.error || 'Sign-in failed.';
}

function cancelGithubDevice() {
  if (ghDeviceModal.value) ghDeviceModal.value.polling = false;
  ghDeviceModal.value = null;
}

// ── GitHub PAT fallback ──────────────────────────────────────────────
const patEntryOpen = ref(false);
const patInput = ref('');
const patSaving = ref(false);
async function submitPat() {
  patSaving.value = true;
  try {
    const result = await send<any>({ action: 'hayami_publish_github_setPat', token: patInput.value });
    if (!result?.ok) { showError(result?.error || 'Invalid token'); return; }
    patInput.value = '';
    patEntryOpen.value = false;
    await loadAuth();
    showSuccess(`Signed in as ${result.state?.username || 'GitHub user'}`);
  } finally {
    patSaving.value = false;
  }
}

// ── GitLab popup OAuth ───────────────────────────────────────────────
const gitlabSigningIn = ref(false);
async function startGitlabSignIn() {
  if (gitlabSigningIn.value) return;
  gitlabSigningIn.value = true;
  try {
    showSuccess('Complete the sign-in in the opened tab…');
    const result = await send<any>({ action: 'hayami_publish_gitlab_runAuthFlow' });
    if (!result?.ok) {
      showError(result?.error || 'GitLab sign-in failed');
      return;
    }
    await loadAuth();
    showSuccess(`Signed in as ${result.state?.username || 'GitLab user'}`);
  } finally {
    gitlabSigningIn.value = false;
  }
}

// ── New collection form ──────────────────────────────────────────────
const newOpen = ref(false);
const newProvider = ref<PublishProviderId>('github');
const newName = ref('');
const newSelectionKind = ref<'all' | 'all-future' | 'pick'>('all-future');
const newPickedOrigins = ref<Set<string>>(new Set());
const newVisibility = ref<PublishedVisibility>('private');

function togglePick(origin: string) {
  const set = new Set(newPickedOrigins.value);
  if (set.has(origin)) set.delete(origin); else set.add(origin);
  newPickedOrigins.value = set;
}

function resetNewForm() {
  newOpen.value = false;
  newName.value = '';
  newSelectionKind.value = 'all-future';
  newPickedOrigins.value = new Set();
  newVisibility.value = 'private';
}

const providerReady = computed(() => (newProvider.value === 'github' ? hasGithub.value : hasGitlab.value));

async function submitNewCollection() {
  if (!providerReady.value) { showError('Sign in to the chosen provider first'); return; }
  if (newSelectionKind.value === 'pick' && newPickedOrigins.value.size === 0) {
    showError('Pick at least one site'); return;
  }
  const selection: PublishedSelection =
    newSelectionKind.value === 'all' ? { kind: 'all' }
    : newSelectionKind.value === 'all-future' ? { kind: 'all-future' }
    : { kind: 'pick', origins: Array.from(newPickedOrigins.value) };

  const entry = await createCollection({
    name: newName.value,
    provider: newProvider.value,
    selection,
    visibility: newVisibility.value,
  });
  if (entry) resetNewForm();
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    showSuccess('Link copied');
  } catch {
    showError('Could not copy — select and copy manually');
  }
}

function formatSelection(selection: PublishedSelection): string {
  if (selection.kind === 'all') return 'All current mappings';
  if (selection.kind === 'all-future') return 'All current + future';
  return `${selection.origins.length} picked`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString();
}
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="onBack">
      <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="settingsIcon" alt="Publish custom sites" class="h-6 w-6 settings-icon" />
      <span>Publish custom sites</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="settingsIcon" alt="Publish custom sites" class="h-6 w-6 settings-icon" />
    <span>Publish custom sites</span>
  </div>

  <div
    v-if="toastMessage"
    class="mb-3 rounded-lg px-3 py-2 text-xs"
    :class="toastMessage.kind === 'success' ? 'bg-emerald-500/20 text-emerald-100' : 'bg-rose-500/20 text-rose-100'"
  >{{ toastMessage.text }}</div>

  <div class="space-y-4">
    <div class="hy-section-card px-4 py-3 text-xs text-white/70">
      Publish selected custom site mappings as a GitHub Gist or GitLab Snippet.
      You'll get a shareable link others can paste into
      <span class="text-white/90">Custom Sites Sync → Add Source</span> to automatically subscribe.
      Changes you make locally are republished automatically.
    </div>

    <!-- Provider sign-in -->
    <div class="hy-section-card">
      <div class="hy-section-header">
        <p class="text-sm font-semibold text-white/90">Providers</p>
      </div>

      <!-- GitHub row -->
      <div class="hy-row">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">GitHub</p>
          <p v-if="githubAuth?.username" class="text-xs text-emerald-200/80">
            Signed in as {{ githubAuth.username }}{{ githubAuth.isPat ? ' (PAT)' : '' }}
          </p>
          <p v-else class="text-xs text-white/60">Sign in to host via Gist.</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            v-if="!hasGithub"
            class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
            @click="startGithubSignIn"
          >Sign in</button>
          <button
            v-if="!hasGithub"
            class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
            @click="patEntryOpen = !patEntryOpen"
          >Use token</button>
          <button
            v-if="hasGithub"
            class="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25"
            @click="logoutProvider('github')"
          >Sign out</button>
        </div>
      </div>
      <div v-if="patEntryOpen && !hasGithub" class="border-b border-white/[0.06] px-4 py-3 space-y-2">
        <p class="text-[11px] text-white/60">
          Paste a fine-grained personal access token with Gist: Read and write permission.
        </p>
        <input
          v-model="patInput"
          type="password"
          placeholder="github_pat_..."
          class="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40"
        />
        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
            :disabled="patSaving"
            @click="submitPat"
          >{{ patSaving ? 'Verifying...' : 'Save token' }}</button>
          <button
            class="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
            @click="patEntryOpen = false; patInput = ''"
          >Cancel</button>
        </div>
      </div>

      <!-- GitLab row -->
      <div class="hy-row">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-white/85">GitLab</p>
          <p v-if="gitlabAuth?.username" class="text-xs text-emerald-200/80">
            Signed in as {{ gitlabAuth.username }}
          </p>
          <p v-else class="text-xs text-white/60">Sign in to host via Snippet.</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            v-if="!hasGitlab"
            class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
            @click="startGitlabSignIn"
          >Sign in</button>
          <button
            v-if="hasGitlab"
            class="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25"
            @click="logoutProvider('gitlab')"
          >Sign out</button>
        </div>
      </div>
    </div>

    <!-- Collections -->
    <div class="hy-section-card">
      <div class="hy-section-header">
        <p class="text-sm font-semibold text-white/90">Published collections</p>
        <button
          class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
          :disabled="!hasGithub && !hasGitlab"
          @click="newOpen = true"
        >New collection</button>
      </div>

      <div v-if="newOpen" class="border-b border-white/[0.06] px-4 py-3 space-y-3">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-white/70">Name</label>
          <input
            v-model="newName"
            type="text"
            placeholder="My anime sites"
            class="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/40"
          />
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-white/70">Provider</label>
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-white/80">
              <input type="radio" value="github" v-model="newProvider" :disabled="!hasGithub" /> GitHub Gist
            </label>
            <label class="flex items-center gap-1.5 text-xs text-white/80">
              <input type="radio" value="gitlab" v-model="newProvider" :disabled="!hasGitlab" /> GitLab Snippet
            </label>
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-white/70">What to include</label>
          <div class="flex flex-col gap-1 text-xs text-white/80">
            <label class="flex items-center gap-1.5">
              <input type="radio" value="all-future" v-model="newSelectionKind" /> All current + future mappings
            </label>
            <label class="flex items-center gap-1.5">
              <input type="radio" value="all" v-model="newSelectionKind" /> All current mappings (snapshot)
            </label>
            <label class="flex items-center gap-1.5">
              <input type="radio" value="pick" v-model="newSelectionKind" /> Pick specific sites
            </label>
          </div>
          <div v-if="newSelectionKind === 'pick'" class="mt-2 max-h-40 overflow-y-auto rounded border border-white/10">
            <label
              v-for="site in allCustomSites"
              :key="site.origin"
              class="flex items-center gap-2 border-b border-white/[0.05] px-2 py-1.5 text-[11px] text-white/80 last:border-b-0 hover:bg-white/[0.04]"
            >
              <input
                type="checkbox"
                :checked="newPickedOrigins.has(site.origin)"
                @change="togglePick(site.origin)"
              />
              <span class="truncate">{{ site.origin }}</span>
            </label>
            <div v-if="allCustomSites.length === 0" class="px-2 py-2 text-[11px] text-white/50">
              No custom sites yet.
            </div>
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-white/70">Visibility</label>
          <div class="flex items-center gap-2 text-xs text-white/80">
            <label class="flex items-center gap-1.5">
              <input type="radio" value="private" v-model="newVisibility" /> Private (shareable by link)
            </label>
            <label class="flex items-center gap-1.5">
              <input type="radio" value="public" v-model="newVisibility" /> Public
            </label>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
            :disabled="creating"
            @click="submitNewCollection"
          >{{ creating ? 'Publishing...' : 'Publish' }}</button>
          <button
            class="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
            @click="resetNewForm"
          >Cancel</button>
        </div>
      </div>

      <div v-if="collections.length === 0 && !newOpen" class="px-4 py-3 text-xs text-white/60">
        Nothing published yet.
      </div>

      <div v-else>
        <div
          v-for="entry in collections"
          :key="entry.id"
          class="space-y-2 border-b border-white/[0.06] px-4 py-3 last:border-b-0"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-white/90">{{ entry.name }}</div>
              <div class="text-[11px] text-white/55">
                {{ entry.provider === 'github' ? 'GitHub Gist' : 'GitLab Snippet' }}
                · {{ formatSelection(entry.selection) }}
                · {{ entry.visibility }}
              </div>
              <div class="text-[11px] text-white/55">
                Last published: {{ formatWhen(entry.lastPublishedAt) }}
              </div>
              <div v-if="entry.lastError" class="text-[11px] text-rose-300/80 truncate">
                {{ entry.lastError }}
              </div>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1.5">
              <button
                class="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                :disabled="busyCollectionId === entry.id"
                @click="republishCollection(entry.id)"
              >Republish</button>
              <button
                class="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60"
                :disabled="busyCollectionId === entry.id"
                @click="deleteCollection(entry.id, { removeRemote: true })"
              >Delete</button>
            </div>
          </div>

          <div class="rounded-lg bg-white/[0.04] p-2 space-y-1.5">
            <p class="text-[10px] uppercase tracking-wide text-white/55">Share this link</p>
            <div class="flex items-center gap-2">
              <input
                :value="entry.rawUrl"
                readonly
                class="min-w-0 flex-1 truncate rounded border border-white/10 bg-transparent px-2 py-1 text-[11px] text-white/80"
              />
              <button
                class="shrink-0 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/30"
                @click="copyUrl(entry.rawUrl)"
              >Copy</button>
            </div>
            <p class="text-[10px] text-white/50">
              Paste this in Custom Sites Sync → Add Source on another device to subscribe.
            </p>
            <a
              v-if="entry.htmlUrl"
              :href="entry.htmlUrl"
              target="_blank"
              rel="noopener"
              class="inline-block text-[10px] text-white/60 underline hover:text-white"
            >View on {{ entry.provider === 'github' ? 'GitHub' : 'GitLab' }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- GitHub device flow modal -->
  <div
    v-if="ghDeviceModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    @click.self="cancelGithubDevice"
  >
    <div class="w-full max-w-sm rounded-xl bg-neutral-900 p-5 text-white shadow-xl">
      <h3 class="mb-2 text-base font-semibold">Sign in to GitHub</h3>
      <p class="mb-3 text-xs text-white/70">
        Open the link below, then enter this code to authorize Hayami.
      </p>
      <div class="mb-3 select-all rounded-lg bg-white/[0.08] px-3 py-2 text-center font-mono text-lg tracking-widest">
        {{ ghDeviceModal.userCode }}
      </div>
      <a
        :href="ghDeviceModal.verificationUri"
        target="_blank"
        rel="noopener"
        class="mb-3 block truncate rounded-lg bg-emerald-500/20 px-3 py-2 text-center text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
      >Open {{ ghDeviceModal.verificationUri }}</a>
      <p v-if="ghDeviceModal.status === 'pending'" class="text-[11px] text-white/60">
        Waiting for you to authorize…
      </p>
      <p v-else class="text-[11px] text-rose-300">{{ ghDeviceModal.statusText }}</p>
      <div class="mt-4 flex justify-end">
        <button
          class="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
          @click="cancelGithubDevice"
        >Close</button>
      </div>
    </div>
  </div>
</template>
