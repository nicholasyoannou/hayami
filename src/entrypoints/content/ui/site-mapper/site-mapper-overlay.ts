// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import type { CustomSiteMapping, DisplayPlacement } from './types';
import { CUSTOM_SITE_MAPPINGS_KEY } from './types';
import {
  setCustomSiteMapping,
  getCustomSiteMapping,
  loadCustomMappingForOrigin,
  getElementCssSelector,
  getAbsoluteXPathNoId,
  ensurePermissionForCurrentSite,
  isMapperHotkeyAttached,
  setMapperHotkeyAttached,
} from './site-mapper-utils';
import { matchChibiPage, evaluateChibiWithOverrides, loadChibiOverrideForOrigin, saveChibiOverrideForOrigin } from '../../chibi';
import type { ChibiOverrideEntry, ChibiSync } from '../../chibi';

export function setupSiteMapperHotkey(ctx: ContentScriptContext, toast: any, queueHandleWatchPage: (ctx: ContentScriptContext) => void): void {
  if (isMapperHotkeyAttached()) return;
  setMapperHotkeyAttached(true);

  const openOverlay = () => openSiteMapperOverlay(ctx, toast, queueHandleWatchPage);

  ctx.addEventListener(
    window,
    'keydown',
    (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const isTyping = target && (['input', 'textarea'].includes(target.tagName.toLowerCase()) || target.isContentEditable);
      if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyH' && !isTyping) {
        ev.preventDefault();
        ev.stopPropagation();
        openOverlay();
      }
    },
    { capture: true }
  );

  // Listen for background command trigger
  // SECURITY: Validate sender to prevent message spoofing from other extensions
  chrome.runtime.onMessage.addListener((msg, sender) => {
    // Only accept messages from this extension's background script
    if (sender.id !== chrome.runtime.id) {
      console.warn('[site-mapper] Rejected message from unauthorized sender:', sender.id);
      return;
    }
    
    if (msg?.action === 'open-site-mapper') {
      openOverlay();
    }
    if (msg?.action === 'hayami-site-mapper-permission-denied') {
      toast.error('Hayami needs host permission for this site to continue.');
    }
  });
}

export function openSiteMapperOverlay(ctx: ContentScriptContext, toast: any, queueHandleWatchPage: (ctx: ContentScriptContext) => void): void {
  if (document.getElementById('hayami-site-mapper-overlay')) return;

  ensurePermissionForCurrentSite().then(async (granted) => {
    if (!granted) {
      toast.error('Permission denied. Enable site access to continue.');
      return;
    }

    // Refresh the latest mapping before rendering so the placement radios and inputs preselect correctly
    const existingMapping = await loadCustomMappingForOrigin();
    setCustomSiteMapping(existingMapping);

    const overlay = document.createElement('div');
    overlay.id = 'hayami-site-mapper-overlay';
    overlay.attachShadow({ mode: 'open' });
    const shadow = overlay.shadowRoot!;

    const style = document.createElement('style');
    style.textContent = `
      :host, .overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; }
      .overlay { background: rgba(10,10,14,0.65); backdrop-filter: blur(6px); transition: background 120ms ease, backdrop-filter 120ms ease; }
      .overlay.picking { background: transparent; backdrop-filter: none; pointer-events: none; }
      .panel { width: min(900px, 94vw); background: #11131a; color: #f7f7fb; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; box-shadow: 0 25px 60px rgba(0,0,0,0.45); padding: 18px 20px 16px; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; display: flex; flex-direction: column; gap: 14px; }
      .panel.hidden { display: none; }
      h2 { margin: 0; font-size: 18px; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .field { display: flex; flex-direction: column; gap: 6px; }
      .field label { font-weight: 600; font-size: 13px; }
      input[type='text'], input[type='number'] { background: #0c0e14; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 10px 12px; color: #fff; }
      input[type='text']:focus, input[type='number']:focus { outline: none; border-color: #5ba8ff; box-shadow: 0 0 0 2px rgba(91,168,255,0.25); }
      textarea { background: #0c0e14; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 10px 12px; color: #fff; resize: vertical; min-height: 96px; font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; }
      textarea:focus { outline: none; border-color: #5ba8ff; box-shadow: 0 0 0 2px rgba(91,168,255,0.25); }
      .radio-row { display: flex; gap: 12px; align-items: center; }
      .radio-row label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
      .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
      button { border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); background: #1a1e2a; color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 600; }
      button.primary { background: #5ba8ff; border-color: #5ba8ff; color: #0b1220; }
      button:hover { opacity: 0.92; }
      .pick { padding: 6px 10px; font-size: 12px; }
      .blurred { filter: blur(2px); }
      .hint { font-size: 12px; color: rgba(255,255,255,0.7); }
      .section-title { font-size: 14px; font-weight: 700; margin: 6px 0; }
      .chibi-card { border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px 12px; background: #0c0e14; display: flex; flex-direction: column; gap: 8px; }
      .chibi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: rgba(91,168,255,0.1); color: #cce6ff; font-weight: 600; font-size: 12px; }
      .chibi-preview { background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 1.45; }
      .disabled { opacity: 0.6; pointer-events: none; }
      .pick-indicator { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #0d6efd; color: #0b1220; padding: 8px 14px; border-radius: 999px; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.35); pointer-events: none; z-index: 2147483001; }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Map this site to Hayami</h2>
      <div class="radio-row">
        <label><input type="radio" name="placement" value="below" checked /> Display below target element</label>
        <label><input type="radio" name="placement" value="insert" /> Insert inline at a selector</label>
        <label><input type="radio" name="placement" value="replace" /> Replace target element</label>
        <label><input type="radio" name="placement" value="popup" /> Popup (open extension)</label>
        <label><input type="radio" name="placement" value="icon" /> Icon insertion (toggle inline)</label>
      </div>
      <div class="row">
        <div class="field">
          <label>Mount selector <span class="hint">Where comments should appear</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="mountSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="mount">Pick</button>
          </div>
        </div>
        <div class="field">
          <label>Display target selector <span class="hint">Element to anchor below (for 'below' mode)</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="anchorSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="anchor">Pick</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Anime title selector</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="titleSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="title">Pick</button>
          </div>
        </div>
        <div class="field">
          <label>Episode selector</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="episodeSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="episode">Pick</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field" style="grid-column: span 2;">
          <label>Side padding (px) <span class="hint">Adds horizontal space inside the injected comments</span></label>
          <input id="sidePadding" type="number" min="0" step="4" placeholder="0" />
        </div>
      </div>
      <div class="chibi-card" id="chibiSection">
        <div class="section-title">MALSync site data</div>
        <div class="hint" id="chibiStatus">Loading MALSync match…</div>
        <div class="chibi-grid">
          <div class="field">
            <label>getTitle override <span class="hint">JSON array of steps; blank uses MALSync default</span></label>
            <textarea id="chibiTitleOverride" spellcheck="false" placeholder='e.g. [["querySelector",".title"],["text"],["trim"]]'></textarea>
          </div>
          <div class="field">
            <label>getEpisode override <span class="hint">JSON array of steps</span></label>
            <textarea id="chibiEpisodeOverride" spellcheck="false" placeholder='e.g. [["regex","episode-(\\d+)",1]]'></textarea>
          </div>
        </div>
        <div class="field">
          <label>getIdentifier override <span class="hint">Optional slug/ID extractor</span></label>
          <textarea id="chibiIdentifierOverride" spellcheck="false" placeholder='e.g. [["url"],["urlPart",3]]'></textarea>
        </div>
        <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
          <div class="chibi-preview" id="chibiPreview">Awaiting preview…</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="pick" id="chibiTest">Preview extraction</button>
            <button class="pick" id="chibiReset">Reset overrides</button>
          </div>
        </div>
      </div>
      <div class="actions">
        <button id="cancelMapper">Cancel</button>
        <button id="saveMapper" class="primary">Save & Embed</button>
      </div>
    `;
    container.appendChild(panel);
    shadow.appendChild(container);
    document.body.appendChild(overlay);

    const mountInput = shadow.getElementById('mountSelector') as HTMLInputElement;
    const anchorInput = shadow.getElementById('anchorSelector') as HTMLInputElement;
    const titleInput = shadow.getElementById('titleSelector') as HTMLInputElement;
    const episodeInput = shadow.getElementById('episodeSelector') as HTMLInputElement;
    const paddingInput = shadow.getElementById('sidePadding') as HTMLInputElement | null;

    const chibiSection = shadow.getElementById('chibiSection') as HTMLElement | null;
    const chibiStatus = shadow.getElementById('chibiStatus') as HTMLElement | null;
    const chibiPreview = shadow.getElementById('chibiPreview') as HTMLElement | null;
    const chibiTitleArea = shadow.getElementById('chibiTitleOverride') as HTMLTextAreaElement | null;
    const chibiEpisodeArea = shadow.getElementById('chibiEpisodeOverride') as HTMLTextAreaElement | null;
    const chibiIdentifierArea = shadow.getElementById('chibiIdentifierOverride') as HTMLTextAreaElement | null;
    const chibiTestBtn = shadow.getElementById('chibiTest') as HTMLButtonElement | null;
    const chibiResetBtn = shadow.getElementById('chibiReset') as HTMLButtonElement | null;
    const chibiMatch = matchChibiPage(location.href);
    const chibiDefaults = (chibiMatch?.page.sync || {}) as Partial<ChibiSync>;
    const chibiDefaultStrings = {
      title: chibiDefaults.getTitle ? JSON.stringify(chibiDefaults.getTitle, null, 2) : '',
      episode: chibiDefaults.getEpisode ? JSON.stringify(chibiDefaults.getEpisode, null, 2) : '',
      identifier: chibiDefaults.getIdentifier ? JSON.stringify(chibiDefaults.getIdentifier, null, 2) : '',
    };

    const deepEqualSteps = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
    const serializeSteps = (steps?: any[]) => (steps ? JSON.stringify(steps, null, 2) : '');
    const parseSteps = (raw: string): any[] | null => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : null;
      } catch (e) {
        console.warn('[chibi] failed to parse override', e);
        return null;
      }
    };

    const buildChibiOverrides = (): { overrides: Partial<ChibiSync> } | { error: string } => {
      if (!chibiMatch) return { overrides: {} };
      const overrides: Partial<ChibiSync> = {};

      const parsedTitle = chibiTitleArea ? parseSteps(chibiTitleArea.value) : null;
      const parsedEpisode = chibiEpisodeArea ? parseSteps(chibiEpisodeArea.value) : null;
      const parsedIdentifier = chibiIdentifierArea ? parseSteps(chibiIdentifierArea.value) : null;

      if (chibiTitleArea && chibiTitleArea.value.trim() && !parsedTitle) return { error: 'Invalid JSON for getTitle override' };
      if (chibiEpisodeArea && chibiEpisodeArea.value.trim() && !parsedEpisode) return { error: 'Invalid JSON for getEpisode override' };
      if (chibiIdentifierArea && chibiIdentifierArea.value.trim() && !parsedIdentifier) return { error: 'Invalid JSON for getIdentifier override' };

      if (parsedTitle && !deepEqualSteps(parsedTitle, chibiDefaults.getTitle)) overrides.getTitle = parsedTitle as any[];
      if (parsedEpisode && !deepEqualSteps(parsedEpisode, chibiDefaults.getEpisode)) overrides.getEpisode = parsedEpisode as any[];
      if (parsedIdentifier && !deepEqualSteps(parsedIdentifier, chibiDefaults.getIdentifier)) overrides.getIdentifier = parsedIdentifier as any[];

      return { overrides };
    };

    const updateChibiPreview = () => {
      if (!chibiPreview) return;
      if (!chibiMatch) {
        chibiPreview.textContent = 'No MALSync mapping available for this URL.';
        return;
      }
      const built = buildChibiOverrides();
      if ('error' in built) {
        chibiPreview.textContent = built.error;
        return;
      }
      const result = evaluateChibiWithOverrides(chibiMatch, built.overrides, document, window.location);
      const parts = [
        result.title ? `Title: ${result.title}` : 'Title: (none)',
        result.episode !== undefined && result.episode !== null ? `Episode: ${result.episode}` : 'Episode: (none)',
        result.identifier ? `Identifier: ${result.identifier}` : 'Identifier: (none)',
      ];
      if (result.errors?.length) {
        parts.push(`Errors: ${result.errors.slice(0, 3).join('; ')}`);
      }
      chibiPreview.textContent = parts.join(' | ');
    };

    const hydrateChibiSection = async () => {
      if (!chibiSection) return;
      if (!chibiMatch) {
        chibiSection.classList.add('disabled');
        if (chibiStatus) chibiStatus.textContent = 'No MALSync config found for this site.';
        return;
      }
      if (chibiStatus) {
        chibiStatus.textContent = `Matched MALSync: ${chibiMatch.page.name || chibiMatch.page.key}`;
      }
      const storedOverride = await loadChibiOverrideForOrigin(location.origin);
      const overridesToUse = storedOverride && storedOverride.key === chibiMatch.page.key ? storedOverride.overrides : undefined;

      if (chibiTitleArea) chibiTitleArea.value = overridesToUse?.getTitle ? serializeSteps(overridesToUse.getTitle) : chibiDefaultStrings.title;
      if (chibiEpisodeArea) chibiEpisodeArea.value = overridesToUse?.getEpisode ? serializeSteps(overridesToUse.getEpisode) : chibiDefaultStrings.episode;
      if (chibiIdentifierArea) chibiIdentifierArea.value = overridesToUse?.getIdentifier ? serializeSteps(overridesToUse.getIdentifier) : chibiDefaultStrings.identifier;

      updateChibiPreview();
    };

    void hydrateChibiSection();

    if (chibiTestBtn) {
      chibiTestBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        updateChibiPreview();
      });
    }

    if (chibiResetBtn) {
      chibiResetBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!chibiMatch) return;
        if (chibiTitleArea) chibiTitleArea.value = chibiDefaultStrings.title;
        if (chibiEpisodeArea) chibiEpisodeArea.value = chibiDefaultStrings.episode;
        if (chibiIdentifierArea) chibiIdentifierArea.value = chibiDefaultStrings.identifier;
        updateChibiPreview();
      });
    }

    const customMapping = getCustomSiteMapping();
    if (customMapping) {
      mountInput.value = customMapping.mountSelector || '';
      anchorInput.value = customMapping.anchorSelector || '';
      titleInput.value = customMapping.titleSelector || '';
      episodeInput.value = customMapping.episodeSelector || '';
      if (paddingInput) paddingInput.value = (customMapping.sidePadding ?? '').toString();
      (mountInput as any)._hayamiXPath = customMapping.mountXPath || '';
      (anchorInput as any)._hayamiXPath = customMapping.anchorXPath || '';
      (titleInput as any)._hayamiXPath = customMapping.titleXPath || '';
      (episodeInput as any)._hayamiXPath = customMapping.episodeXPath || '';
    }

    const inputs: Record<string, HTMLInputElement> = {
      mount: mountInput,
      anchor: anchorInput,
      title: titleInput,
      episode: episodeInput,
    };

    let pickIndicator: HTMLElement | null = null;
    let lastHighlight: HTMLElement | null = null;
    let highlightBox: HTMLElement | null = null;
    let hoverRaf: number | null = null;
    let lastHoverEvent: MouseEvent | null = null;

    const placements = Array.from(shadow.querySelectorAll<HTMLInputElement>('input[name="placement"]'));

    // Preselect existing display mode if present
    if (customMapping) {
      const existing = placements.find((p) => p.value === customMapping!.display);
      if (existing) {
        placements.forEach((p) => (p.checked = false));
        existing.checked = true;
      }
    }

    function cleanupPickers() {
      document.body.classList.remove('hayami-picking');
      document.removeEventListener('mousemove', handleHover, true);
      document.removeEventListener('click', handlePick, true);
      container.classList.remove('picking');
      panel.classList.remove('hidden');
      overlay.style.pointerEvents = '';
      lastHoverEvent = null;
      if (hoverRaf) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = null;
      }
      if (pickIndicator) {
        pickIndicator.remove();
        pickIndicator = null;
      }
      if (highlightBox) {
        highlightBox.remove();
        highlightBox = null;
      }
      if (lastHighlight) {
        lastHighlight.style.outline = '';
        lastHighlight = null;
      }
    }

    function ensureHighlightBox(): HTMLElement {
      if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.style.position = 'fixed';
        highlightBox.style.zIndex = '2147483002';
        highlightBox.style.border = '2px solid #5ba8ff';
        highlightBox.style.borderRadius = '6px';
        highlightBox.style.pointerEvents = 'none';
        highlightBox.style.boxShadow = '0 0 0 4px rgba(91,168,255,0.25)';
        highlightBox.style.display = 'none';
        document.body.appendChild(highlightBox);
      }
      return highlightBox;
    }

    function resolveDeepTarget(x: number, y: number): HTMLElement | null {
      let current: HTMLElement | null = document.elementFromPoint(x, y) as HTMLElement | null;
      const isIgnored = (el: HTMLElement | null) => {
        if (!el) return true;
        if (el === document.body || el === document.documentElement) return true;
        if (el.id === 'hayami-site-mapper-overlay') return true;
        if (pickIndicator && (el === pickIndicator || pickIndicator.contains(el))) return true;
        if (highlightBox && (el === highlightBox || highlightBox.contains(el))) return true;
        return false;
      };

      while (current) {
        if (isIgnored(current)) return null;
        if (current.shadowRoot) {
          const next = current.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
          if (!next || next === current) break;
          current = next;
          continue;
        }
        break;
      }
      return isIgnored(current) ? null : current;
    }

    function paintHover() {
      hoverRaf = null;
      if (!lastHoverEvent) return;
      const { clientX, clientY } = lastHoverEvent;
      const target = resolveDeepTarget(clientX, clientY);
      if (!target) {
        if (highlightBox) highlightBox.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      const box = ensureHighlightBox();
      box.style.display = 'block';
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      lastHighlight = target;
    }

    function handleHover(ev: MouseEvent) {
      lastHoverEvent = ev;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(paintHover);
    }

    function handlePick(ev: MouseEvent) {
      ev.preventDefault();
      ev.stopPropagation();
      const target = ev.target as HTMLElement;
      const picking = (document.body as any)._hayamiPickingTarget as string | undefined;
      cleanupPickers();
      delete (document.body as any)._hayamiPickingTarget;
      if (!picking || !inputs[picking]) return;
      inputs[picking].value = getElementCssSelector(target);
      (inputs[picking] as any)._hayamiXPath = getAbsoluteXPathNoId(target);
      if (highlightBox) {
        highlightBox.remove();
        highlightBox = null;
      }
      overlay.style.pointerEvents = '';
    }

    shadow.querySelectorAll('button.pick').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const target = (ev.currentTarget as HTMLElement).getAttribute('data-target') || '';
        (document.body as any)._hayamiPickingTarget = target;
        cleanupPickers();
        container.classList.add('picking');
        panel.classList.add('hidden');
        overlay.style.pointerEvents = 'none';
        pickIndicator = document.createElement('div');
        pickIndicator.className = 'pick-indicator';
        pickIndicator.textContent = `Click an element to set ${target} selector`;
        document.body.appendChild(pickIndicator);
        document.addEventListener('mousemove', handleHover, true);
        document.addEventListener('click', handlePick, true);
      });
    });

    shadow.getElementById('cancelMapper')?.addEventListener('click', () => {
      cleanupPickers();
      overlay.remove();
    });

    shadow.getElementById('saveMapper')?.addEventListener('click', async () => {
      cleanupPickers();
      const placement = placements.find((p) => p.checked)?.value as DisplayPlacement || 'below';
      const parsedPadding = paddingInput ? Number.parseFloat(paddingInput.value) : NaN;
      const sidePadding = Number.isFinite(parsedPadding) && parsedPadding >= 0 ? parsedPadding : 0;
      const mapping: CustomSiteMapping = {
        origin: location.origin,
        display: placement,
        anchorSelector: anchorInput.value.trim(),
        mountSelector: mountInput.value.trim() || anchorInput.value.trim() || 'body',
        titleSelector: titleInput.value.trim(),
        episodeSelector: episodeInput.value.trim(),
        sidePadding,
        anchorXPath: (anchorInput as any)._hayamiXPath || customMapping?.anchorXPath || '',
        mountXPath: (mountInput as any)._hayamiXPath || customMapping?.mountXPath || '',
        titleXPath: (titleInput as any)._hayamiXPath || customMapping?.titleXPath || '',
        episodeXPath: (episodeInput as any)._hayamiXPath || customMapping?.episodeXPath || '',
      };

      let chibiOverrideEntry: ChibiOverrideEntry | null = null;
      if (chibiMatch) {
        const built = buildChibiOverrides();
        if ('error' in built) {
          toast.error(built.error);
          return;
        }
        if (Object.keys(built.overrides).length > 0) {
          chibiOverrideEntry = { key: chibiMatch.page.key, overrides: built.overrides };
        }
      }

      try {
        const stored = await chrome.storage.local.get(CUSTOM_SITE_MAPPINGS_KEY);
        const map = stored?.[CUSTOM_SITE_MAPPINGS_KEY] || {};
        map[location.origin] = mapping;
        await chrome.storage.local.set({ [CUSTOM_SITE_MAPPINGS_KEY]: map });
        await saveChibiOverrideForOrigin(location.origin, chibiOverrideEntry);
        setCustomSiteMapping(mapping);
        toast.success('Site mapping saved');
        overlay.remove();
        queueHandleWatchPage(ctx);
      } catch (e) {
        console.warn('Failed to save mapping', e);
        toast.error('Failed to save mapping');
      }
    });
  });
}
