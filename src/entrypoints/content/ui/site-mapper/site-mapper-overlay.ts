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
import type { ChibiOverrideEntry } from '../../chibi';
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import { customSiteMappingsItem, displayModeItem } from '@/config/storage';

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
  browser.runtime.onMessage.addListener((msg, sender) => {
    // Only accept messages from this extension's background script
    if (sender.id !== browser.runtime.id) {
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
      .field.hidden { display: none; }
      .field label { font-weight: 600; font-size: 13px; }
      input[type='text'], input[type='number'] { background: #0c0e14; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 10px 12px; color: #fff; }
      input[type='text']:focus, input[type='number']:focus { outline: none; border-color: #5ba8ff; box-shadow: 0 0 0 2px rgba(91,168,255,0.25); }
      .tab-row { display: flex; gap: 8px; background: #0c0e14; padding: 4px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); }
      .tab { flex: 1; border: none; background: transparent; padding: 10px 12px; border-radius: 10px; color: #cfd2de; font-weight: 700; cursor: pointer; transition: all 160ms ease; }
      .tab.active { background: #5ba8ff; color: #0b1220; }
      .tab:not(.active):hover { background: rgba(255,255,255,0.04); }
      .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
      button { border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); background: #1a1e2a; color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 600; }
      button.primary { background: #5ba8ff; border-color: #5ba8ff; color: #0b1220; }
      button:hover { opacity: 0.92; }
      .pick { padding: 6px 10px; font-size: 12px; }
      .blurred { filter: blur(2px); }
      .hint { font-size: 12px; color: rgba(255,255,255,0.7); }
      .section-title { font-size: 14px; font-weight: 700; margin: 6px 0; }
      .preview-card { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px; background: #0c0e14; display: flex; flex-direction: column; gap: 8px; }
      .preview-line { background: rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.45; }
      .preview-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
      .pick-indicator { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #0d6efd; color: #0b1220; padding: 8px 14px; border-radius: 999px; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.35); pointer-events: none; z-index: 2147483001; }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Map this site to Hayami</h2>
      <div class="tab-row" id="placementTabs">
        <button class="tab active" data-placement="below">Below element</button>
        <button class="tab" data-placement="insert">Insert inline</button>
        <button class="tab" data-placement="replace">Replace element</button>
        <button class="tab" data-placement="popup">Popup only</button>
        <button class="tab" data-placement="icon">Icon toggle</button>
      </div>
      <div class="row">
        <div class="field" data-field="mount">
          <label>Mount selector <span class="hint">Where comments should appear or icon should sit</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="mountSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="mount">Pick</button>
          </div>
        </div>
        <div class="field" data-field="anchor">
          <label>Display target selector <span class="hint">Element to anchor below/replace</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="anchorSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="anchor">Pick</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field" data-field="title">
          <label>Anime title selector</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="titleSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="title">Pick</button>
          </div>
        </div>
        <div class="field" data-field="episode">
          <label>Episode selector</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="episodeSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="episode">Pick</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field" data-field="padding" style="grid-column: span 2;">
          <label>Side padding (px) <span class="hint">Adds horizontal space inside the injected comments</span></label>
          <input id="sidePadding" type="number" min="0" step="4" placeholder="0" />
        </div>
      </div>
      <div class="preview-card">
        <div class="section-title">Extraction preview</div>
        <div class="preview-line" id="extractionPreview">Awaiting preview…</div>
        <div class="hint" id="previewHint">Uses MALSync when available; otherwise your selectors.</div>
        <div class="preview-actions">
          <button class="pick" id="previewExtraction">Preview extraction</button>
          <button class="pick" id="resetOverrides">Reset overrides</button>
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
    const placementTabs = shadow.getElementById('placementTabs') as HTMLElement | null;
    const extractionPreview = shadow.getElementById('extractionPreview') as HTMLElement | null;
    const previewHint = shadow.getElementById('previewHint') as HTMLElement | null;
    const previewBtn = shadow.getElementById('previewExtraction') as HTMLButtonElement | null;
    const resetOverridesBtn = shadow.getElementById('resetOverrides') as HTMLButtonElement | null;
    const chibiMatch = matchChibiPage(location.href);

    const fieldGroups: Record<string, HTMLElement | null> = {
      mount: shadow.querySelector('[data-field="mount"]') as HTMLElement | null,
      anchor: shadow.querySelector('[data-field="anchor"]') as HTMLElement | null,
      title: shadow.querySelector('[data-field="title"]') as HTMLElement | null,
      episode: shadow.querySelector('[data-field="episode"]') as HTMLElement | null,
      padding: shadow.querySelector('[data-field="padding"]') as HTMLElement | null,
    };

    let currentMapping = getCustomSiteMapping();
    if (currentMapping) {
      mountInput.value = currentMapping.mountSelector || '';
      anchorInput.value = currentMapping.anchorSelector || '';
      titleInput.value = currentMapping.titleSelector || '';
      episodeInput.value = currentMapping.episodeSelector || '';
      if (paddingInput) paddingInput.value = (currentMapping.sidePadding ?? '').toString();
      (mountInput as any)._hayamiXPath = currentMapping.mountXPath || '';
      (anchorInput as any)._hayamiXPath = currentMapping.anchorXPath || '';
      (titleInput as any)._hayamiXPath = currentMapping.titleXPath || '';
      (episodeInput as any)._hayamiXPath = currentMapping.episodeXPath || '';
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

    const normalizePlacement = (raw: string | undefined | null): DisplayPlacement => {
      if (!raw) return 'below';
      if (raw === 'inline') return 'below';
      const allowed: DisplayPlacement[] = ['below', 'insert', 'replace', 'popup', 'icon'];
      return (allowed.includes(raw as DisplayPlacement) ? raw : 'below') as DisplayPlacement;
    };

    let selectedPlacement: DisplayPlacement = normalizePlacement(currentMapping?.display);

    const placementFieldVisibility: Record<DisplayPlacement, string[]> = {
      below: ['anchor', 'mount', 'title', 'episode', 'padding'],
      insert: ['mount', 'title', 'episode', 'padding'],
      replace: ['anchor', 'title', 'episode', 'padding'],
      popup: ['title', 'episode'],
      icon: ['mount', 'title', 'episode', 'padding'],
    };

    function syncTabSelection() {
      if (!placementTabs) return;
      placementTabs.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
        const isActive = btn.dataset.placement === selectedPlacement;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function updateFieldVisibility() {
      const visible = new Set(placementFieldVisibility[selectedPlacement] || []);
      Object.entries(fieldGroups).forEach(([key, el]) => {
        if (!el) return;
        el.classList.toggle('hidden', !visible.has(key));
      });
      if (previewHint) {
        const inlineModes: DisplayPlacement[] = ['below', 'insert', 'replace', 'icon'];
        previewHint.textContent = inlineModes.includes(selectedPlacement)
          ? 'Preview uses MALSync if available; otherwise your selectors.'
          : 'Popup mode uses your extraction selectors for preview only.';
      }
    }

    void (async () => {
      if (!currentMapping) {
        try {
          const stored = await displayModeItem.getValue();
          selectedPlacement = normalizePlacement(stored || null);
        } catch {}
      }
      syncTabSelection();
      updateFieldVisibility();
    })();

    placementTabs?.querySelectorAll<HTMLButtonElement>('button[data-placement]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const nextPlacement = (btn.dataset.placement || 'below') as DisplayPlacement;
        selectedPlacement = nextPlacement;
        syncTabSelection();
        updateFieldVisibility();
      });
    });

    let storedChibiOverride: ChibiOverrideEntry | null = null;

    const identifierFallback = (): string => {
      try {
        const url = new URL(location.href);
        const slug = url.pathname.split('/').filter(Boolean).pop();
        return slug || url.hostname;
      } catch {
        return location.href;
      }
    };

    const extractFromSelector = (selector: string | undefined): string | null => {
      const trimmed = (selector || '').trim();
      if (!trimmed) return null;
      const el = document.querySelector(trimmed) as HTMLElement | null;
      const text = el?.textContent?.trim();
      return text && text.length > 0 ? text : null;
    };

    const updateResetButtonVisibility = () => {
      if (!resetOverridesBtn) return;
      const hasMapping = Boolean(currentMapping);
      const hasOverride = Boolean(storedChibiOverride);
      resetOverridesBtn.style.display = hasMapping || hasOverride ? '' : 'none';
    };

    const runExtractionPreview = () => {
      if (!extractionPreview) return;

      const manualTitle = extractFromSelector(titleInput.value);
      const manualEpisode = extractFromSelector(episodeInput.value);
      const usingManual = Boolean(manualTitle || manualEpisode);

      if (usingManual) {
        const parts = [
          manualTitle ? `Title: ${manualTitle}` : 'Title: (none)',
          manualEpisode ? `Episode: ${manualEpisode}` : 'Episode: (none)',
          `Identifier: ${identifierFallback()}`,
          'Source: selectors',
        ];
        extractionPreview.textContent = parts.join(' | ');
        return;
      }

      if (chibiMatch) {
        const overridesToUse = storedChibiOverride && storedChibiOverride.key === chibiMatch.page.key ? storedChibiOverride.overrides : undefined;
        const result = evaluateChibiWithOverrides(chibiMatch, overridesToUse, document, window.location);
        const parts = [
          result.title ? `Title: ${result.title}` : 'Title: (none)',
          result.episode !== undefined && result.episode !== null ? `Episode: ${result.episode}` : 'Episode: (none)',
          result.identifier ? `Identifier: ${result.identifier}` : `Identifier: ${identifierFallback()}`,
          `Source: ${result.source === 'override' ? 'MALSync override' : 'MALSync default'}`,
        ];
        if (result.errors?.length) {
          parts.push(`Errors: ${result.errors.slice(0, 3).join('; ')}`);
        }
        extractionPreview.textContent = parts.join(' | ');
        return;
      }

      const fallbackParts = [
        'Title: (none)',
        'Episode: (none)',
        `Identifier: ${identifierFallback()}`,
        'Source: current page',
      ];
      extractionPreview.textContent = fallbackParts.join(' | ');
    };

    updateResetButtonVisibility();

    void (async () => {
      storedChibiOverride = await loadChibiOverrideForOrigin(location.origin);
      updateResetButtonVisibility();
      runExtractionPreview();
    })();

    previewBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      runExtractionPreview();
    });

    [titleInput, episodeInput].forEach((input) => {
      input.addEventListener('input', () => runExtractionPreview());
      input.addEventListener('change', () => runExtractionPreview());
    });

    resetOverridesBtn?.addEventListener('click', async (ev) => {
      ev.preventDefault();
      try {
        const map = (await customSiteMappingsItem.getValue()) || {};
        if (map[location.origin]) {
          delete map[location.origin];
          await customSiteMappingsItem.setValue(map);
        }
        await saveChibiOverrideForOrigin(location.origin, null);
        currentMapping = null;
        setCustomSiteMapping(null);
        mountInput.value = '';
        anchorInput.value = '';
        titleInput.value = '';
        episodeInput.value = '';
        if (paddingInput) paddingInput.value = '';
        (mountInput as any)._hayamiXPath = '';
        (anchorInput as any)._hayamiXPath = '';
        (titleInput as any)._hayamiXPath = '';
        (episodeInput as any)._hayamiXPath = '';
        storedChibiOverride = null;
        selectedPlacement = 'below';
        syncTabSelection();
        updateFieldVisibility();
        runExtractionPreview();
        updateResetButtonVisibility();
        toast.success('Overrides reset for this site');
      } catch (e) {
        console.warn('[site-mapper] Failed to reset overrides', e);
        toast.error('Failed to reset overrides');
      }
    });

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

    shadow.querySelectorAll('button.pick[data-target]').forEach((btn) => {
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
      const placement = selectedPlacement || 'below';
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
        anchorXPath: (anchorInput as any)._hayamiXPath || currentMapping?.anchorXPath || '',
        mountXPath: (mountInput as any)._hayamiXPath || currentMapping?.mountXPath || '',
        titleXPath: (titleInput as any)._hayamiXPath || currentMapping?.titleXPath || '',
        episodeXPath: (episodeInput as any)._hayamiXPath || currentMapping?.episodeXPath || '',
      };

      const chibiOverrideEntry = chibiMatch && storedChibiOverride && storedChibiOverride.key === chibiMatch.page.key
        ? storedChibiOverride
        : null;

      try {
        const map = (await customSiteMappingsItem.getValue()) || {};
        map[location.origin] = mapping;
        await customSiteMappingsItem.setValue(map);
        await saveChibiOverrideForOrigin(location.origin, chibiOverrideEntry);
        currentMapping = mapping;
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
