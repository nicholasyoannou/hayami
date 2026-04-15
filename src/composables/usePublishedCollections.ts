/**
 * Manages the user's Published Collections (gists/snippets that mirror selected
 * custom site mappings). Responsibilities:
 *   - CRUD over publishedCollectionsItem storage
 *   - Auth status for both providers
 *   - Create / update / delete remote (routed through background)
 *   - Auto-republish on local custom site changes (debounced)
 *
 * Kept popup-local: the composable is instantiated from PublishCustomSitesPanel.vue.
 * Auto-republish watch is installed only while the popup is open, which is fine
 * since the local mutation that triggered it is still resident — and the popup
 * is where users edit mappings anyway. A future background alarm can handle
 * drift if needed.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { browser } from 'wxt/browser';
import {
  customSiteMappingsItem,
  publishedCollectionsItem,
  type PublishedCollection,
  type PublishProviderId,
  type PublishedSelection,
  type PublishedVisibility,
  type PublishAuthState,
} from '@/config/storage';
import type { CustomSiteMapping } from '@/entrypoints/content/ui/site-mapper/types';
import { buildPublishPayload, hashPayload } from '@/utils/publishProviders';
import { con } from '@/utils/logger';

const log = con.m('PublishedCollections');

type Callbacks = {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
};

function rid(): string {
  return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function send<T = any>(message: any): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function selectMappings(all: CustomSiteMapping[], selection: PublishedSelection): CustomSiteMapping[] {
  if (selection.kind === 'all' || selection.kind === 'all-future') return [...all];
  const wanted = new Set(selection.origins);
  return all.filter((m) => wanted.has(m.origin));
}

export function usePublishedCollections({ showSuccess, showError }: Callbacks) {
  const collections = ref<PublishedCollection[]>([]);
  const githubAuth = ref<PublishAuthState | null>(null);
  const gitlabAuth = ref<PublishAuthState | null>(null);
  const busyCollectionId = ref<string | null>(null);
  const creating = ref(false);
  const republishTimer = ref<number | null>(null);

  const hasGithub = computed(() => !!githubAuth.value?.accessToken);
  const hasGitlab = computed(() => !!gitlabAuth.value?.accessToken);

  async function loadAuth() {
    try {
      const [gh, gl] = await Promise.all([
        send<{ ok: boolean; state: PublishAuthState | null }>({ action: 'hayami_publish_github_getAuth' }),
        send<{ ok: boolean; state: PublishAuthState | null }>({ action: 'hayami_publish_gitlab_getAuth' }),
      ]);
      githubAuth.value = gh?.state || null;
      gitlabAuth.value = gl?.state || null;
    } catch (err) {
      log.warn('loadAuth failed', err);
    }
  }

  async function loadCollections() {
    try {
      collections.value = (await publishedCollectionsItem.getValue()) || [];
    } catch (err) {
      log.warn('loadCollections failed', err);
    }
  }

  async function persist() {
    await publishedCollectionsItem.setValue([...collections.value]);
  }

  // ── Auth actions ───────────────────────────────────────────────────

  async function logoutProvider(provider: PublishProviderId) {
    await send({ action: provider === 'github' ? 'hayami_publish_github_logout' : 'hayami_publish_gitlab_logout' });
    if (provider === 'github') githubAuth.value = null; else gitlabAuth.value = null;
    showSuccess(`Signed out of ${provider === 'github' ? 'GitHub' : 'GitLab'}`);
  }

  // ── Collection CRUD ────────────────────────────────────────────────

  async function createCollection(input: {
    name: string;
    provider: PublishProviderId;
    selection: PublishedSelection;
    visibility: PublishedVisibility;
  }): Promise<PublishedCollection | null> {
    if (creating.value) return null;
    creating.value = true;
    try {
      const name = (input.name || '').trim() || 'My custom sites';
      const allMap = (await customSiteMappingsItem.getValue()) || {};
      const all = Object.values(allMap) as CustomSiteMapping[];
      const chosen = selectMappings(all, input.selection);
      const payload = buildPublishPayload(name, chosen);

      const result = await send<any>({
        action: 'hayami_publish_createRemote',
        provider: input.provider,
        name,
        payload,
        visibility: input.visibility,
      });
      if (!result?.ok) {
        showError(result?.error || 'Failed to create collection');
        return null;
      }

      const entry: PublishedCollection = {
        id: rid(),
        name,
        provider: input.provider,
        remoteId: result.remoteId,
        rawUrl: result.rawUrl,
        htmlUrl: result.htmlUrl,
        selection: input.selection,
        visibility: input.visibility,
        createdAt: new Date().toISOString(),
        lastPublishedAt: new Date().toISOString(),
        lastHash: await hashPayload(payload),
        lastError: null,
      };
      collections.value = [entry, ...collections.value];
      await persist();
      showSuccess(`Published "${name}" — ${chosen.length} mapping${chosen.length === 1 ? '' : 's'}`);
      return entry;
    } catch (err) {
      log.error('createCollection failed', err);
      showError(err instanceof Error ? err.message : 'Failed to publish');
      return null;
    } finally {
      creating.value = false;
    }
  }

  async function republishCollection(id: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const entry = collections.value.find((c) => c.id === id);
    if (!entry) return false;
    if (busyCollectionId.value) return false;
    busyCollectionId.value = id;
    try {
      const allMap = (await customSiteMappingsItem.getValue()) || {};
      const all = Object.values(allMap) as CustomSiteMapping[];
      const chosen = selectMappings(all, entry.selection);
      const payload = buildPublishPayload(entry.name, chosen);
      const nextHash = await hashPayload(payload);
      if (entry.lastHash === nextHash && !opts.silent) {
        showSuccess('Already up to date');
        return true;
      }

      const result = await send<any>({
        action: 'hayami_publish_updateRemote',
        provider: entry.provider,
        remoteId: entry.remoteId,
        name: entry.name,
        payload,
      });
      if (!result?.ok) {
        entry.lastError = result?.error || 'Update failed';
        await persist();
        if (!opts.silent) showError(result?.error || 'Failed to update');
        return false;
      }
      entry.rawUrl = result.rawUrl;
      entry.htmlUrl = result.htmlUrl;
      entry.lastPublishedAt = new Date().toISOString();
      entry.lastHash = nextHash;
      entry.lastError = null;
      await persist();
      if (!opts.silent) showSuccess(`Republished "${entry.name}"`);
      return true;
    } catch (err) {
      log.error('republish failed', err);
      if (!opts.silent) showError(err instanceof Error ? err.message : 'Failed to republish');
      return false;
    } finally {
      busyCollectionId.value = null;
    }
  }

  async function deleteCollection(id: string, opts: { removeRemote: boolean }): Promise<boolean> {
    const entry = collections.value.find((c) => c.id === id);
    if (!entry) return false;
    busyCollectionId.value = id;
    try {
      if (opts.removeRemote) {
        const result = await send<any>({
          action: 'hayami_publish_deleteRemote',
          provider: entry.provider,
          remoteId: entry.remoteId,
        });
        if (!result?.ok) {
          showError(result?.error || 'Could not delete on the remote');
          // continue anyway — user asked to remove locally; proceed so they aren't stuck
        }
      }
      collections.value = collections.value.filter((c) => c.id !== id);
      await persist();
      showSuccess('Collection removed');
      return true;
    } finally {
      busyCollectionId.value = null;
    }
  }

  async function renameCollection(id: string, name: string): Promise<void> {
    const entry = collections.value.find((c) => c.id === id);
    if (!entry) return;
    entry.name = name.trim() || entry.name;
    await persist();
    await republishCollection(id, { silent: true });
  }

  async function updateSelection(id: string, selection: PublishedSelection): Promise<void> {
    const entry = collections.value.find((c) => c.id === id);
    if (!entry) return;
    entry.selection = selection;
    await persist();
    await republishCollection(id, { silent: true });
  }

  // ── Auto-republish on local mapping changes ────────────────────────

  const scheduleAutoRepublish = () => {
    if (republishTimer.value) window.clearTimeout(republishTimer.value);
    republishTimer.value = window.setTimeout(async () => {
      republishTimer.value = null;
      for (const entry of collections.value) {
        await republishCollection(entry.id, { silent: true });
      }
    }, 5000);
  };

  const unwatch = customSiteMappingsItem.watch(() => {
    if (collections.value.length === 0) return;
    scheduleAutoRepublish();
  });

  onMounted(async () => {
    await loadAuth();
    await loadCollections();
  });

  onUnmounted(() => {
    if (republishTimer.value) window.clearTimeout(republishTimer.value);
    try { unwatch(); } catch { /* noop */ }
  });

  return {
    collections,
    githubAuth,
    gitlabAuth,
    hasGithub,
    hasGitlab,
    busyCollectionId,
    creating,

    loadAuth,
    loadCollections,
    logoutProvider,
    createCollection,
    republishCollection,
    deleteCollection,
    renameCollection,
    updateSelection,
  };
}
