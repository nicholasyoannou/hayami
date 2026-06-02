import { computed, ref } from 'vue';
import { browser } from 'wxt/browser';
import { customSiteMappingsItem } from '@/config/storage';
import { MAX_DOMAINS_PER_CUSTOM_SITE } from '@/entrypoints/content/ui/site-mapper/types';
import type { CustomSiteMapping, DisplayPlacement } from '@/entrypoints/content/ui/site-mapper/types';
import { sanitizeCustomSiteMapping } from '@/entrypoints/content/ui/site-mapper/sanitize-mapping';
import { con } from '@/utils/logger';

const log = con.m('CustomSiteManagement');

type Callbacks = {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
};

export function useCustomSiteManagement({ showSuccess, showError }: Callbacks) {
  const customSiteMappings = ref<CustomSiteMapping[]>([]);
  const isLoadingCustomSites = ref(false);
  const removingSiteOrigin = ref<string | null>(null);
  const selectedCustomSite = ref<CustomSiteMapping | null>(null);
  const customSiteIncludePathGlobsDraft = ref<string[]>([]);
  const customSiteExcludePathGlobsDraft = ref<string[]>([]);
  const customSiteIncludePathInput = ref('');
  const customSiteExcludePathInput = ref('');
  const customSitePathGlobsSaving = ref(false);
  const customSiteAdvancedExpanded = ref(false);
  const commentsBackgroundColorDraft = ref('');
  const customSiteRawFieldsSaving = ref(false);
  const customSiteExtraDomainsDraft = ref<string[]>([]);
  const customSiteDomainInput = ref('');
  const customSiteDomainsSaving = ref(false);
  /** Saving indicator for the advanced editor (popout, replaces whole mapping). */
  const customSiteAdvancedSaving = ref(false);

  const sortedCustomSiteMappings = computed(() =>
    [...customSiteMappings.value].sort((a, b) => (a.origin || '').localeCompare(b.origin || '')),
  );

  // ── Path glob utilities ──────────────────────────────────────────

  function normalizePathGlob(input: unknown): string | null {
    const raw = String(input || '').trim();
    if (!raw) return null;

    let glob = raw.startsWith('/') ? raw : `/${raw}`;
    glob = glob.length > 1 ? glob.replace(/\/+$/, '') : glob;
    if (!glob) return null;

    if (glob.includes('*')) return glob;

    const segments = glob.split('/').filter(Boolean);
    if (segments.length === 0) return '/';

    return `/${segments[0]}/*`;
  }

  function normalizePathGlobList(input: unknown): string[] {
    const source = Array.isArray(input) ? input : [];
    const normalized = source
      .map((item) => normalizePathGlob(item))
      .filter((item): item is string => Boolean(item));

    const unique = Array.from(new Set(normalized));
    const wildcardPrefixes = unique
      .filter((glob) => glob.endsWith('/*'))
      .map((glob) => glob.slice(0, -2));

    if (wildcardPrefixes.length === 0) return unique;

    return unique.filter((glob) => {
      for (const prefix of wildcardPrefixes) {
        if (glob === `${prefix}/*`) return true;
        if (glob.startsWith(`${prefix}/`)) return false;
      }
      return true;
    });
  }

  // ── Extra domains utilities ──────────────────────────────────────

  /**
   * Normalize an arbitrary user-typed domain/URL to its canonical `origin`
   * form (scheme + host + port, no trailing slash). Returns null for any
   * non-http(s) or malformed value.
   */
  function normalizeDomainToOrigin(input: unknown): string | null {
    const trimmed = String(input || '').trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (!/^https?:$/.test(url.protocol)) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  /**
   * Produce a clean extraDomains list: normalize each entry, drop the
   * primary origin, dedupe, and cap at MAX_DOMAINS_PER_CUSTOM_SITE - 1
   * (the primary counts as the 10th slot).
   */
  function sanitizeExtraDomains(primaryOrigin: string | undefined, input: unknown): string[] {
    const source = Array.isArray(input) ? input : [];
    const primary = String(primaryOrigin || '').trim();
    const normalized: string[] = [];
    const seen = new Set<string>();
    if (primary) seen.add(primary);
    for (const item of source) {
      const origin = normalizeDomainToOrigin(item);
      if (!origin) continue;
      if (seen.has(origin)) continue;
      seen.add(origin);
      normalized.push(origin);
      if (normalized.length >= MAX_DOMAINS_PER_CUSTOM_SITE - 1) break;
    }
    return normalized;
  }

  // ── Hydrate / refresh helpers ────────────────────────────────────

  function hydrateSelectedCustomSitePathGlobDrafts() {
    customSiteIncludePathGlobsDraft.value = normalizePathGlobList(selectedCustomSite.value?.includePathGlobs);
    customSiteExcludePathGlobsDraft.value = normalizePathGlobList(selectedCustomSite.value?.excludePathGlobs);
    customSiteIncludePathInput.value = '';
    customSiteExcludePathInput.value = '';
    commentsBackgroundColorDraft.value = selectedCustomSite.value?.commentsBackgroundColor || '';
    customSiteExtraDomainsDraft.value = sanitizeExtraDomains(
      selectedCustomSite.value?.origin,
      selectedCustomSite.value?.extraDomains,
    );
    customSiteDomainInput.value = '';
  }

  async function loadCustomSiteMappings() {
    isLoadingCustomSites.value = true;
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const mappings = Object.values(map || {}) as CustomSiteMapping[];
      customSiteMappings.value = mappings
        .filter((entry) => Boolean(entry?.origin))
        .map((entry) => ({
          ...entry,
          includePathGlobs: normalizePathGlobList(entry?.includePathGlobs),
          excludePathGlobs: normalizePathGlobList(entry?.excludePathGlobs),
          extraDomains: sanitizeExtraDomains(entry?.origin, entry?.extraDomains),
        }));
    } catch (error) {
      log.warn('Failed to load custom site mappings', error);
      showError('Failed to load custom websites');
    } finally {
      isLoadingCustomSites.value = false;
    }
  }

  async function refreshSelectedCustomSite() {
    await loadCustomSiteMappings();
    if (!selectedCustomSite.value) return;
    const updated = customSiteMappings.value.find((entry) => entry.origin === selectedCustomSite.value?.origin);
    if (updated) {
      selectedCustomSite.value = updated;
      hydrateSelectedCustomSitePathGlobDrafts();
    }
  }

  // ── Path glob CRUD ───────────────────────────────────────────────

  function addCustomSitePathGlob(kind: 'include' | 'exclude', rawInput?: string) {
    const normalized = normalizePathGlob(rawInput ?? (kind === 'include' ? customSiteIncludePathInput.value : customSiteExcludePathInput.value));
    if (!normalized) return;

    const target = kind === 'include' ? customSiteIncludePathGlobsDraft : customSiteExcludePathGlobsDraft;
    target.value = normalizePathGlobList([...target.value, normalized]);

    if (kind === 'include') {
      customSiteIncludePathInput.value = '';
    } else {
      customSiteExcludePathInput.value = '';
    }
  }

  function removeCustomSitePathGlob(kind: 'include' | 'exclude', glob: string) {
    const target = kind === 'include' ? customSiteIncludePathGlobsDraft : customSiteExcludePathGlobsDraft;
    target.value = target.value.filter((item) => item !== glob);
  }

  async function saveSelectedCustomSitePathGlobs() {
    const site = selectedCustomSite.value;
    if (!site?.origin || customSitePathGlobsSaving.value) return;

    customSitePathGlobsSaving.value = true;
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const existing = map[site.origin] as CustomSiteMapping | undefined;
      if (!existing) {
        showError('This custom site no longer exists');
        await refreshSelectedCustomSite();
        return;
      }

      const next: CustomSiteMapping = {
        ...existing,
        includePathGlobs: normalizePathGlobList(customSiteIncludePathGlobsDraft.value),
        excludePathGlobs: normalizePathGlobList(customSiteExcludePathGlobsDraft.value),
      };

      map[site.origin] = next;
      await customSiteMappingsItem.setValue(map);
      await loadCustomSiteMappings();

      const updated = customSiteMappings.value.find((entry) => entry.origin === site.origin) || next;
      selectedCustomSite.value = updated;
      hydrateSelectedCustomSitePathGlobDrafts();
      showSuccess('Custom website path globs saved');
    } catch (error) {
      log.warn('Failed to save custom site path globs', error);
      showError('Could not save path globs');
    } finally {
      customSitePathGlobsSaving.value = false;
    }
  }

  // ── Extra domains CRUD ───────────────────────────────────────────

  /**
   * Add a new domain to the extra-domains draft. Normalizes the input,
   * rejects duplicates / the primary origin / over-limit additions, and
   * requests host permission so the extension can actually run there. On
   * denial or failure we surface a toast and leave the draft unchanged.
   */
  async function addCustomSiteDomain(rawInput?: string): Promise<void> {
    const site = selectedCustomSite.value;
    if (!site?.origin) return;

    const candidate = rawInput ?? customSiteDomainInput.value;
    const origin = normalizeDomainToOrigin(candidate);
    if (!origin) {
      showError('Enter a valid domain (e.g. example.com)');
      return;
    }

    if (origin === site.origin) {
      showError('That domain is already this site');
      return;
    }
    if (customSiteExtraDomainsDraft.value.includes(origin)) {
      showError('That domain is already in the list');
      return;
    }
    if (customSiteExtraDomainsDraft.value.length + 1 >= MAX_DOMAINS_PER_CUSTOM_SITE) {
      showError(`A site can have at most ${MAX_DOMAINS_PER_CUSTOM_SITE} domains`);
      return;
    }

    const granted = await requestHostPermission(origin);
    if (!granted) {
      showError('Host permission is required for this domain');
      return;
    }

    customSiteExtraDomainsDraft.value = [...customSiteExtraDomainsDraft.value, origin];
    customSiteDomainInput.value = '';
  }

  function removeCustomSiteDomain(domain: string) {
    customSiteExtraDomainsDraft.value = customSiteExtraDomainsDraft.value.filter(
      (item) => item !== domain,
    );
  }

  async function saveSelectedCustomSiteDomains(): Promise<void> {
    const site = selectedCustomSite.value;
    if (!site?.origin || customSiteDomainsSaving.value) return;

    customSiteDomainsSaving.value = true;
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const existing = map[site.origin] as CustomSiteMapping | undefined;
      if (!existing) {
        showError('This custom site no longer exists');
        await refreshSelectedCustomSite();
        return;
      }

      const nextExtraDomains = sanitizeExtraDomains(site.origin, customSiteExtraDomainsDraft.value);
      const next: CustomSiteMapping = { ...existing, extraDomains: nextExtraDomains };
      map[site.origin] = next;
      await customSiteMappingsItem.setValue(map);
      await loadCustomSiteMappings();

      const updated = customSiteMappings.value.find((entry) => entry.origin === site.origin) || next;
      selectedCustomSite.value = updated;
      customSiteExtraDomainsDraft.value = sanitizeExtraDomains(updated.origin, updated.extraDomains);
      showSuccess('Domains saved');
    } catch (error) {
      log.warn('Failed to save custom site domains', error);
      showError('Could not save domains');
    } finally {
      customSiteDomainsSaving.value = false;
    }
  }

  // ── Background color ─────────────────────────────────────────────

  function isValidCssColor(value: string): boolean {
    const trimmed = (value || '').trim();
    if (!trimmed) return false;
    return /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)$/.test(trimmed);
  }

  async function saveCommentsBackgroundColor() {
    const site = selectedCustomSite.value;
    if (!site?.origin) return;
    const color = commentsBackgroundColorDraft.value.trim();
    if (!color) {
      showError('Enter a color or press Clear');
      return;
    }
    if (!isValidCssColor(color)) {
      showError('Invalid color value');
      return;
    }
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const existing = map[site.origin] as CustomSiteMapping | undefined;
      if (!existing) {
        showError('This custom site no longer exists');
        await refreshSelectedCustomSite();
        return;
      }
      const next: CustomSiteMapping = { ...existing, commentsBackgroundColor: color };
      map[site.origin] = next;
      await customSiteMappingsItem.setValue(map);
      await loadCustomSiteMappings();
      const updated = customSiteMappings.value.find((entry) => entry.origin === site.origin) || next;
      selectedCustomSite.value = updated;
      commentsBackgroundColorDraft.value = updated.commentsBackgroundColor || '';
      showSuccess('Comments background color saved');
    } catch (error) {
      log.warn('Failed to save comments background color', error);
      showError('Could not save background color');
    }
  }

  async function clearCommentsBackgroundColor() {
    const site = selectedCustomSite.value;
    if (!site?.origin) return;
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const existing = map[site.origin] as CustomSiteMapping | undefined;
      if (!existing) {
        showError('This custom site no longer exists');
        await refreshSelectedCustomSite();
        return;
      }
      const { commentsBackgroundColor: _removed, ...rest } = existing as any;
      map[site.origin] = rest as CustomSiteMapping;
      await customSiteMappingsItem.setValue(map);
      await loadCustomSiteMappings();
      const updated = customSiteMappings.value.find((entry) => entry.origin === site.origin) || (rest as CustomSiteMapping);
      selectedCustomSite.value = updated;
      commentsBackgroundColorDraft.value = '';
      showSuccess('Background color cleared');
    } catch (error) {
      log.warn('Failed to clear comments background color', error);
      showError('Could not clear background color');
    }
  }

  // ── Raw field editing ────────────────────────────────────────────

  type CustomSiteRawFieldsDraft = {
    mountSelector: string;
    anchorSelector: string;
    titleSelector: string;
    titleRegex: string;
    episodeSelector: string;
    episodeRegex: string;
    releaseDateSelector: string;
    releaseDateRegex: string;
    episodeListSelector: string;
    episodeListItemRegex: string;
    sidePadding: number;
  };

  async function saveSelectedCustomSiteRawFields(draft: CustomSiteRawFieldsDraft): Promise<void> {
    const site = selectedCustomSite.value;
    if (!site?.origin || customSiteRawFieldsSaving.value) return;

    customSiteRawFieldsSaving.value = true;
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const existing = map[site.origin] as CustomSiteMapping | undefined;
      if (!existing) {
        showError('This custom site no longer exists');
        await refreshSelectedCustomSite();
        return;
      }

      const sidePaddingNum = Number(draft.sidePadding);
      // Optional selector/regex fields are written conditionally: when the
      // user blanked the field we omit it from `next` AND delete it from
      // `existing` first, otherwise the spread below would carry the old
      // value through and the cleared field would silently come back on
      // the next load. Required fields (mount/anchor/title/episode) keep
      // their current "save empty string when blank" behaviour.
      const optionalString = (value: string): string | undefined => {
        const trimmed = String(value || '').trim();
        return trimmed || undefined;
      };
      const next: CustomSiteMapping = {
        ...existing,
        mountSelector: String(draft.mountSelector || '').trim(),
        anchorSelector: String(draft.anchorSelector || '').trim(),
        titleSelector: String(draft.titleSelector || '').trim(),
        titleRegex: String(draft.titleRegex || '').trim(),
        episodeSelector: String(draft.episodeSelector || '').trim(),
        episodeRegex: String(draft.episodeRegex || '').trim(),
        sidePadding: Number.isFinite(sidePaddingNum) ? sidePaddingNum : 0,
      };
      const releaseDateSelector = optionalString(draft.releaseDateSelector);
      if (releaseDateSelector) next.releaseDateSelector = releaseDateSelector;
      else delete next.releaseDateSelector;
      const releaseDateRegex = optionalString(draft.releaseDateRegex);
      if (releaseDateRegex) next.releaseDateRegex = releaseDateRegex;
      else delete next.releaseDateRegex;
      const episodeListSelector = optionalString(draft.episodeListSelector);
      if (episodeListSelector) next.episodeListSelector = episodeListSelector;
      else delete next.episodeListSelector;
      const episodeListItemRegex = optionalString(draft.episodeListItemRegex);
      if (episodeListItemRegex) next.episodeListItemRegex = episodeListItemRegex;
      else delete next.episodeListItemRegex;

      map[site.origin] = next;
      await customSiteMappingsItem.setValue(map);
      await loadCustomSiteMappings();

      const updated = customSiteMappings.value.find((entry) => entry.origin === site.origin) || next;
      selectedCustomSite.value = updated;
      showSuccess('Mapping updated');
    } catch (error) {
      log.warn('Failed to save custom site raw fields', error);
      showError('Could not save mapping');
    } finally {
      customSiteRawFieldsSaving.value = false;
    }
  }

  /**
   * Save a fully-formed mapping from the advanced editor. Unlike the
   * field-level saves above, this **replaces** the stored mapping rather
   * than merging — the editor's draft IS the new shape, including any
   * fields the user blanked out.
   *
   * Also requests host permission for any extras that aren't yet
   * granted, so the user gets a single native Chrome prompt the same
   * way the popup card's "Approve all hosts" button does it. Missing
   * permission is the most common reason a freshly-saved cross-page
   * mapping doesn't work, so closing that loop here saves a round trip
   * through the toast-on-detail-page UX.
   */
  async function saveCustomSiteMappingDirect(next: CustomSiteMapping): Promise<void> {
    if (!next?.origin || customSiteAdvancedSaving.value) return;
    customSiteAdvancedSaving.value = true;
    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      const previousOrigin = selectedCustomSite.value?.origin;
      // If the user changed the origin in the editor, rekey the entry.
      if (previousOrigin && previousOrigin !== next.origin && map[previousOrigin]) {
        delete map[previousOrigin];
      }
      map[next.origin] = next;
      await customSiteMappingsItem.setValue(map);
      await loadCustomSiteMappings();
      const updated = customSiteMappings.value.find((entry) => entry.origin === next.origin) || next;
      selectedCustomSite.value = updated;

      // Sync the field-level draft refs so other panels stay consistent
      // if the user navigates back to the standard detail view.
      customSiteExtraDomainsDraft.value = sanitizeExtraDomains(updated.origin, updated.extraDomains);
      customSiteIncludePathGlobsDraft.value = normalizePathGlobList(updated.includePathGlobs);
      customSiteExcludePathGlobsDraft.value = normalizePathGlobList(updated.excludePathGlobs);
      commentsBackgroundColorDraft.value = updated.commentsBackgroundColor || '';

      // Ask Chrome for permission on the primary origin + every extra
      // in one shot. Already-granted entries are silently allowed
      // through; the user sees only the truly-new ones.
      try {
        const wantedPatterns = [updated.origin, ...(updated.extraDomains || [])]
          .map((origin) => String(origin || '').trim())
          .filter(Boolean)
          .map((origin) => `${origin.replace(/\/$/, '')}/*`);
        if (wantedPatterns.length > 0 && browser.permissions?.contains && browser.permissions?.request) {
          const alreadyGranted = await new Promise<boolean>((resolve) => {
            try {
              browser.permissions.contains({ origins: wantedPatterns }, (ok) => resolve(Boolean(ok)));
            } catch {
              resolve(false);
            }
          });
          if (!alreadyGranted) {
            await new Promise<boolean>((resolve) => {
              try {
                browser.permissions.request({ origins: wantedPatterns }, (ok) => resolve(Boolean(ok)));
              } catch {
                resolve(false);
              }
            });
          }
        }
      } catch (permError) {
        log.warn('Failed to request host permissions after save', permError);
      }

      showSuccess('Mapping saved');
    } catch (error) {
      log.warn('Failed to save mapping from advanced editor', error);
      showError('Could not save mapping');
    } finally {
      customSiteAdvancedSaving.value = false;
    }
  }

  // ── Import / export ──────────────────────────────────────────────

  /**
   * Thin wrapper around the shared `sanitizeCustomSiteMapping` so the
   * import path and the advanced editor share validation logic. Prior
   * versions of this function silently dropped regex variants, XPaths,
   * and the new `episodeIndex`/`episodeKey` blocks — the shared module
   * preserves every field defined on `CustomSiteMapping`.
   */
  function sanitizeImportedCustomSiteMapping(input: unknown): CustomSiteMapping | null {
    return sanitizeCustomSiteMapping(input);
  }

  function collectImportedCustomSiteMappings(payload: unknown): CustomSiteMapping[] {
    const out: CustomSiteMapping[] = [];

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const mapping = sanitizeImportedCustomSiteMapping(item);
        if (mapping) out.push(mapping);
      }
      return out;
    }

    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;

      const direct = sanitizeImportedCustomSiteMapping(obj);
      if (direct) {
        out.push(direct);
        return out;
      }

      const wrappedCandidates = [obj.mapping, obj.mappings, obj.customSiteMappings, obj.custom_site_mappings];
      for (const candidate of wrappedCandidates) {
        if (Array.isArray(candidate)) {
          for (const item of candidate) {
            const mapping = sanitizeImportedCustomSiteMapping(item);
            if (mapping) out.push(mapping);
          }
          if (out.length) return out;
        }
      }

      const asMap = (obj.mappings && typeof obj.mappings === 'object' && !Array.isArray(obj.mappings))
        ? obj.mappings as Record<string, unknown>
        : (obj.custom_site_mappings && typeof obj.custom_site_mappings === 'object' && !Array.isArray(obj.custom_site_mappings))
          ? obj.custom_site_mappings as Record<string, unknown>
          : obj;

      for (const value of Object.values(asMap)) {
        const mapping = sanitizeImportedCustomSiteMapping(value);
        if (mapping) out.push(mapping);
      }
    }

    return out;
  }

  function buildCustomMappingExportFilename(site: CustomSiteMapping): string {
    let host = 'site';
    try {
      host = new URL(site.origin).host.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
      host = String(site.origin || 'site').replace(/[^a-zA-Z0-9.-]/g, '_');
    }
    return `hayami-custom-mapping-${host}.json`;
  }

  async function exportAllCustomSiteMappings() {
    try {
      const all = [...customSiteMappings.value];
      if (all.length === 0) {
        showError('No custom site mappings to export');
        return;
      }
      const payload = {
        format: 'hayami.custom-site-mappings',
        version: 1,
        exportedAt: new Date().toISOString(),
        mappings: all,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      anchor.download = `hayami-custom-mappings-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showSuccess(`Exported ${all.length} mapping${all.length === 1 ? '' : 's'}`);
    } catch (error) {
      log.warn('Failed to export all custom site mappings', error);
      showError('Could not export custom site mappings');
    }
  }

  async function exportCustomSiteMapping(site: CustomSiteMapping) {
    try {
      const payload = {
        format: 'hayami.custom-site-mapping',
        version: 1,
        exportedAt: new Date().toISOString(),
        mapping: site,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildCustomMappingExportFilename(site);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showSuccess('Custom site mapping exported');
    } catch (error) {
      log.warn('Failed to export custom site mapping', error);
      showError('Could not export this site mapping');
    }
  }

  async function onImportCustomMappingsFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0] || null;
    if (!file) return;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        showError('Import failed: invalid JSON file');
        return;
      }

      const imported = collectImportedCustomSiteMappings(parsed);
      if (imported.length === 0) {
        showError('No valid custom site mappings found in file');
        return;
      }

      const currentMap = (await customSiteMappingsItem.getValue()) || {};
      let added = 0;
      let updated = 0;
      for (const mapping of imported) {
        if (currentMap[mapping.origin]) {
          updated += 1;
        } else {
          added += 1;
        }
        currentMap[mapping.origin] = mapping;
      }

      await customSiteMappingsItem.setValue(currentMap);
      await loadCustomSiteMappings();
      showSuccess(`Imported ${imported.length} mapping${imported.length === 1 ? '' : 's'} (${added} added, ${updated} updated)`);
    } catch (error) {
      log.warn('Failed to import custom site mappings', error);
      showError('Could not import custom mappings');
    } finally {
      if (input) input.value = '';
    }
  }

  // ── Site removal ─────────────────────────────────────────────────

  async function removeCustomSite(site: CustomSiteMapping) {
    removingSiteOrigin.value = site.origin;

    const previousList = customSiteMappings.value;
    customSiteMappings.value = previousList.filter((entry) => entry.origin !== site.origin);

    if (selectedCustomSite.value?.origin === site.origin) {
      selectedCustomSite.value = null;
    }

    try {
      const map = (await customSiteMappingsItem.getValue()) || {};
      if (map[site.origin]) {
        delete map[site.origin];
        await customSiteMappingsItem.setValue(map);
      }

      const originPatterns = [site.origin, ...(site.extraDomains || [])]
        .filter((origin): origin is string => Boolean(origin))
        .map((origin) => `${origin}/*`);
      const permissions = browser.permissions;
      if (permissions?.remove && originPatterns.length > 0) {
        await new Promise<void>((resolve) => {
          try {
            permissions.remove({ origins: originPatterns }, () => resolve());
          } catch {
            resolve();
          }
        });
      }

      showSuccess('Custom site removed');
    } catch (error) {
      log.warn('Failed to remove custom site', error);
      customSiteMappings.value = previousList;
      showError('Could not remove this site');
    } finally {
      removingSiteOrigin.value = null;
    }
  }

  // ── Site mapper (open in tab) ────────────────────────────────────

  function normalizeUrlToOrigin(input: string): string | null {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (!/^https?:$/.test(url.protocol)) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  async function requestHostPermission(origin: string): Promise<boolean> {
    const permissions = browser.permissions;
    if (!permissions || !permissions.request || !permissions.contains) return true;

    const originPattern = `${origin}/*`;
    const alreadyGranted = await new Promise<boolean>((resolve) => {
      try {
        permissions.contains({ origins: [originPattern] }, (granted: boolean) => resolve(Boolean(granted)));
      } catch {
        resolve(false);
      }
    });
    if (alreadyGranted) return true;

    return new Promise((resolve) => {
      try {
        permissions.request({ origins: [originPattern] }, (granted: boolean) => resolve(Boolean(granted)));
      } catch (error) {
        log.warn('Permission request failed', error);
        resolve(false);
      }
    });
  }

  async function waitForMapperTab(tabId: number): Promise<void> {
    const attemptSend = async () => {
      try {
        await browser.tabs.sendMessage(tabId, { action: 'open-site-mapper' });
        return true;
      } catch {
        return false;
      }
    };

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        browser.tabs.onUpdated.removeListener(listener);
        reject(new Error('Timed out opening mapper'));
      }, 15000);

      const listener = (updatedTabId: number, info: any) => {
        if (updatedTabId !== tabId || info.status !== 'complete') return;
        void attemptSend().then((ok) => {
          if (ok) {
            window.clearTimeout(timeout);
            browser.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      };

      browser.tabs.onUpdated.addListener(listener);

      void attemptSend().then((ok) => {
        if (ok) {
          window.clearTimeout(timeout);
          browser.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  async function openSiteMapperForOrigin(rawValue: string) {
    const origin = normalizeUrlToOrigin(rawValue);
    if (!origin) {
      showError('Enter a valid site URL');
      return;
    }
    try {
      const granted = await requestHostPermission(origin);
      if (!granted) {
        showError('Host permission is required for this site');
        return;
      }

      const tab = await browser.tabs.create({ url: `${origin}/`, active: true });
      if (!tab?.id) {
        throw new Error('Failed to open configuration tab');
      }

      await waitForMapperTab(tab.id);
    } catch (error) {
      log.warn('Failed to open site mapper', error);
      showError('Could not open the site mapper for this site');
    }
  }

  // ── Detail navigation ────────────────────────────────────────────

  function openCustomSiteDetail(site: CustomSiteMapping) {
    selectedCustomSite.value = site;
    customSiteAdvancedExpanded.value = false;
    hydrateSelectedCustomSitePathGlobDrafts();
  }

  function closeCustomSiteDetail() {
    selectedCustomSite.value = null;
  }

  // ── Formatting helpers ───────────────────────────────────────────

  function getFaviconUrl(origin: string) {
    try {
      const url = new URL(origin);
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.origin)}`;
    } catch {
      return 'https://www.google.com/s2/favicons?domain=';
    }
  }

  function formatOrigin(origin: string) {
    try {
      const url = new URL(origin);
      return url.host || origin;
    } catch (error) {
      log.warn('Failed to format origin', error);
      return origin;
    }
  }

  function formatPlacementLabel(placement?: DisplayPlacement) {
    const labels: Record<DisplayPlacement, string> = {
      below: 'Below element',
      insert: 'Insert inline',
      replace: 'Replace element',
      popup: 'Popup only',
      icon: 'Icon toggle',
    };
    return placement && labels[placement] ? labels[placement] : 'Custom mapping';
  }

  return {
    // State
    customSiteMappings,
    isLoadingCustomSites,
    removingSiteOrigin,
    selectedCustomSite,
    customSiteIncludePathGlobsDraft,
    customSiteExcludePathGlobsDraft,
    customSiteIncludePathInput,
    customSiteExcludePathInput,
    customSitePathGlobsSaving,
    customSiteAdvancedExpanded,
    commentsBackgroundColorDraft,
    customSiteRawFieldsSaving,
    customSiteAdvancedSaving,
    customSiteExtraDomainsDraft,
    customSiteDomainInput,
    customSiteDomainsSaving,
    sortedCustomSiteMappings,

    // Actions
    loadCustomSiteMappings,
    refreshSelectedCustomSite,
    addCustomSitePathGlob,
    removeCustomSitePathGlob,
    saveSelectedCustomSitePathGlobs,
    addCustomSiteDomain,
    removeCustomSiteDomain,
    saveSelectedCustomSiteDomains,
    saveCommentsBackgroundColor,
    clearCommentsBackgroundColor,
    saveSelectedCustomSiteRawFields,
    saveCustomSiteMappingDirect,
    exportAllCustomSiteMappings,
    exportCustomSiteMapping,
    onImportCustomMappingsFileChange,
    removeCustomSite,
    openSiteMapperForOrigin,
    openCustomSiteDetail,
    closeCustomSiteDetail,

    // Helpers
    getFaviconUrl,
    formatOrigin,
    formatPlacementLabel,
    normalizeUrlToOrigin,
  };
}
