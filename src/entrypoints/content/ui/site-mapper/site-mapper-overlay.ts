// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import type { CustomSiteMapping, DisplayPlacement, IconDisplayAction, IconDisplayKind } from './types';
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
import { browser } from 'wxt/browser';
import { getRuntimeUrl } from '@/utils/runtime';
import { extractEpisodeNumber } from '@/utils/episode-utils';
import {
  customSiteMappingsItem,
  displayModeItem,
} from '@/config/storage';

export function setupSiteMapperHotkey(ctx: ContentScriptContext, toast: any, queueHandleWatchPage: (ctx: ContentScriptContext) => void): void {
  if (isMapperHotkeyAttached()) return;
  setMapperHotkeyAttached(true);

  const openOverlay = () => openSiteMapperOverlay(ctx, toast, queueHandleWatchPage);

  const onHotkey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.repeat) return;

    const target = ev.target as HTMLElement | null;
    const tag = (target?.tagName || '').toLowerCase();
    const isTyping = target && (
      ['input', 'textarea', 'select'].includes(tag) ||
      target.isContentEditable
    );

    const usesCtrlOrMeta = ev.ctrlKey || ev.metaKey;
    const key = (ev.key || '').toLowerCase();
    const matchesH = ev.code === 'KeyH' || key === 'h';

    if (usesCtrlOrMeta && ev.shiftKey && !ev.altKey && matchesH && !isTyping) {
      ev.preventDefault();
      ev.stopPropagation();
      openOverlay();
    }
  };

  ctx.addEventListener(
    window,
    'keydown',
    onHotkey,
    { capture: true }
  );

  // Some player/focus contexts dispatch keyboard events on document rather than window.
  ctx.addEventListener(
    document,
    'keydown',
    onHotkey,
    { capture: true }
  );

  // Listen for background command trigger
  // SECURITY: Validate sender to prevent message spoofing from other extensions
  browser.runtime.onMessage.addListener((msg, sender) => {
    // Accept same-extension messages. Some extension contexts may omit sender.id.
    if (sender?.id && sender.id !== browser.runtime.id) {
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
      .pick-indicator {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92);
        color: #e2f7ff;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-family: Inter, system-ui, sans-serif;
        font-weight: 700;
        letter-spacing: 0;
        box-shadow: 0 10px 28px rgba(0,0,0,0.28);
        pointer-events: none;
        z-index: 2147483001;
      }
      .field-loading label { color: rgba(255,255,255,0.72); }
      input.input-loading[type='text'], input.input-loading[type='number'] {
        color: transparent !important;
        caret-color: transparent;
        background: linear-gradient(90deg, rgba(255,255,255,0.08) 25%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.08) 75%);
        background-size: 200% 100%;
        animation: hayami-skeleton 1.9s linear infinite;
      }
      input.input-loading[type='text']::placeholder, input.input-loading[type='number']::placeholder { color: transparent !important; }
      @keyframes hayami-skeleton {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        input.input-loading[type='text'], input.input-loading[type='number'] {
          animation: none;
          background: rgba(255,255,255,0.09);
        }
      }
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
        <button class="tab" data-placement="icon">Icon / Text trigger</button>
      </div>
      <div class="row" data-field="iconKindRow">
        <div class="field" data-field="iconKind" style="grid-column: span 2;">
          <label>Icon mode style</label>
          <div class="tab-row" id="iconKindTabs">
            <button class="tab active" data-icon-kind="text">Text-based</button>
            <button class="tab" data-icon-kind="icon">Icon-based</button>
          </div>
        </div>
      </div>
      <div class="row" data-field="iconActionRow">
        <div class="field" data-field="iconAction" style="grid-column: span 2;">
          <label>On click behavior</label>
          <div class="tab-row" id="iconActionTabs">
            <button class="tab active" data-icon-action="popup">Popup</button>
            <button class="tab" data-icon-action="replace">Replace</button>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field" data-field="mount">
          <label id="mountLabel">Mount selector <span class="hint">Where comments should appear or icon should sit</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="mountSelector" type="text" placeholder="CSS selector" />
            <button class="pick" data-target="mount">Pick</button>
          </div>
        </div>
        <div class="field" data-field="anchor">
          <label id="anchorLabel">Display target selector <span class="hint">Element to anchor below/replace</span></label>
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
        <div class="field" data-field="episodeRegex" style="grid-column: span 2;">
          <label>Episode number extractor <span class="hint">Optional. Build a regex by highlighting the episode number in the raw text</span></label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="episodeRegex" type="text" placeholder="e.g. episode\s*(\d+)" />
            <button class="pick" id="buildEpisodeRegex" type="button">Build from highlight</button>
            <button class="pick" id="clearEpisodeRegex" type="button">Clear</button>
          </div>
          <div id="episodeRegexHelper" style="display:none; margin-top:8px; padding:8px; border-radius:8px; background:rgba(255,255,255,0.05);">
            <div class="hint" style="margin-bottom:6px;">Highlight the episode number (e.g. <code>4</code> or <code>episode 4</code>) in the text below:</div>
            <div id="episodeRegexSourceText" style="user-select:text; cursor:text; padding:6px 8px; border-radius:6px; background:rgba(0,0,0,0.25); font-size:12px; line-height:1.5; white-space:pre-wrap; word-break:break-word;"></div>
            <div style="display:flex; gap:8px; margin-top:6px; align-items:center;">
              <button class="pick" id="episodeRegexApply" type="button">Apply selection</button>
              <button class="pick" id="episodeRegexCancel" type="button">Cancel</button>
              <span id="episodeRegexPreview" class="hint"></span>
            </div>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field" data-field="iconText" style="grid-column: span 2;">
          <label>Text label <span class="hint">Shown when text-based icon mode is selected</span></label>
          <input id="iconDisplayText" type="text" placeholder="Hayami" />
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
        <div class="hint" id="previewHint">Uses your selectors for title and episode extraction.</div>
        <div class="preview-actions">
          <button class="pick" id="previewExtraction">Preview extraction</button>
          <button class="pick" id="resetOverrides">Reset mapping</button>
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
    const episodeRegexInput = shadow.getElementById('episodeRegex') as HTMLInputElement | null;
    const buildEpisodeRegexBtn = shadow.getElementById('buildEpisodeRegex') as HTMLButtonElement | null;
    const clearEpisodeRegexBtn = shadow.getElementById('clearEpisodeRegex') as HTMLButtonElement | null;
    const episodeRegexHelper = shadow.getElementById('episodeRegexHelper') as HTMLElement | null;
    const episodeRegexSourceText = shadow.getElementById('episodeRegexSourceText') as HTMLElement | null;
    const episodeRegexApplyBtn = shadow.getElementById('episodeRegexApply') as HTMLButtonElement | null;
    const episodeRegexCancelBtn = shadow.getElementById('episodeRegexCancel') as HTMLButtonElement | null;
    const episodeRegexPreviewEl = shadow.getElementById('episodeRegexPreview') as HTMLElement | null;
    const paddingInput = shadow.getElementById('sidePadding') as HTMLInputElement | null;
    const placementTabs = shadow.getElementById('placementTabs') as HTMLElement | null;
    const iconKindTabs = shadow.getElementById('iconKindTabs') as HTMLElement | null;
    const iconActionTabs = shadow.getElementById('iconActionTabs') as HTMLElement | null;
    const extractionPreview = shadow.getElementById('extractionPreview') as HTMLElement | null;
    const previewHint = shadow.getElementById('previewHint') as HTMLElement | null;
    const previewBtn = shadow.getElementById('previewExtraction') as HTMLButtonElement | null;
    const resetOverridesBtn = shadow.getElementById('resetOverrides') as HTMLButtonElement | null;
    const iconDisplayTextInput = shadow.getElementById('iconDisplayText') as HTMLInputElement | null;
    const mountLabel = shadow.getElementById('mountLabel') as HTMLElement | null;
    const anchorLabel = shadow.getElementById('anchorLabel') as HTMLElement | null;

    const fieldGroups: Record<string, HTMLElement | null> = {
      mount: shadow.querySelector('[data-field="mount"]') as HTMLElement | null,
      anchor: shadow.querySelector('[data-field="anchor"]') as HTMLElement | null,
      title: shadow.querySelector('[data-field="title"]') as HTMLElement | null,
      episode: shadow.querySelector('[data-field="episode"]') as HTMLElement | null,
      episodeRegex: shadow.querySelector('[data-field="episodeRegex"]') as HTMLElement | null,
      iconKind: shadow.querySelector('[data-field="iconKind"]') as HTMLElement | null,
      iconAction: shadow.querySelector('[data-field="iconAction"]') as HTMLElement | null,
      iconText: shadow.querySelector('[data-field="iconText"]') as HTMLElement | null,
      padding: shadow.querySelector('[data-field="padding"]') as HTMLElement | null,
    };

    let selectedIconKind: IconDisplayKind = 'text';
    let selectedIconAction: IconDisplayAction = 'popup';

    let currentMapping = getCustomSiteMapping();
    if (currentMapping) {
      mountInput.value = currentMapping.mountSelector || '';
      anchorInput.value = currentMapping.anchorSelector || '';
      titleInput.value = currentMapping.titleSelector || '';
      episodeInput.value = currentMapping.episodeSelector || '';
      if (episodeRegexInput) episodeRegexInput.value = currentMapping.episodeRegex || '';
      if (paddingInput) paddingInput.value = (currentMapping.sidePadding ?? '').toString();
      selectedIconKind = currentMapping.iconDisplayKind === 'icon' ? 'icon' : 'text';
      selectedIconAction = currentMapping.iconDisplayAction === 'replace' ? 'replace' : 'popup';
      if (iconDisplayTextInput) {
        iconDisplayTextInput.value = (currentMapping.iconDisplayText || 'Hayami').trim() || 'Hayami';
      }
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
    let clickShield: HTMLElement | null = null;
    let hoverRaf: number | null = null;
    let lastHoverEvent: MouseEvent | null = null;

    const normalizePlacement = (raw: string | undefined | null): DisplayPlacement => {
      if (!raw) return 'below';
      if (raw === 'inline') return 'below';
      const allowed: DisplayPlacement[] = ['below', 'insert', 'replace', 'popup', 'icon'];
      return (allowed.includes(raw as DisplayPlacement) ? raw : 'below') as DisplayPlacement;
    };

    let selectedPlacement: DisplayPlacement = normalizePlacement(currentMapping?.display);

    if (!iconDisplayTextInput?.value.trim()) {
      if (iconDisplayTextInput) iconDisplayTextInput.value = 'Hayami';
    }

    const placementFieldVisibility: Record<DisplayPlacement, string[]> = {
      below: ['anchor', 'mount', 'title', 'episode', 'episodeRegex', 'padding'],
      insert: ['mount', 'title', 'episode', 'episodeRegex', 'padding'],
      replace: ['anchor', 'title', 'episode', 'episodeRegex', 'padding'],
      popup: ['title', 'episode', 'episodeRegex'],
      icon: ['mount', 'title', 'episode', 'episodeRegex', 'iconKind', 'iconAction', 'iconText', 'padding'],
    };

    function syncIconKindSelection() {
      if (!iconKindTabs) return;
      iconKindTabs.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
        const isActive = btn.dataset.iconKind === selectedIconKind;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function syncIconActionSelection() {
      if (!iconActionTabs) return;
      iconActionTabs.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
        const isActive = btn.dataset.iconAction === selectedIconAction;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

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
      if (selectedPlacement === 'icon' && selectedIconAction === 'replace') {
        visible.add('anchor');
      }
      if (selectedPlacement === 'icon' && selectedIconKind === 'icon') {
        visible.delete('iconText');
      }
      Object.entries(fieldGroups).forEach(([key, el]) => {
        if (!el) return;
        el.classList.toggle('hidden', !visible.has(key));
      });

      if (mountLabel) {
        mountLabel.innerHTML = selectedPlacement === 'icon'
          ? 'Trigger selector <span class="hint">Where the Hayami trigger should be inserted</span>'
          : 'Mount selector <span class="hint">Where comments should appear or icon should sit</span>';
      }
      if (anchorLabel) {
        anchorLabel.innerHTML = selectedPlacement === 'icon'
          ? 'Initial comments selector <span class="hint">Used for replace mode to toggle site comments</span>'
          : 'Display target selector <span class="hint">Element to anchor below/replace</span>';
      }

      if (previewHint) {
        const inlineModes: DisplayPlacement[] = ['below', 'insert', 'replace'];
        if (selectedPlacement === 'icon') {
          previewHint.textContent = selectedIconAction === 'replace'
            ? 'Icon/Text replace mode toggles between site comments and Hayami.'
            : 'Icon/Text popup mode opens Hayami in popup from your selected trigger.';
          return;
        }
        previewHint.textContent = inlineModes.includes(selectedPlacement)
          ? 'Preview uses your selectors for extraction.'
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
      syncIconKindSelection();
      syncIconActionSelection();
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

    iconKindTabs?.querySelectorAll<HTMLButtonElement>('button[data-icon-kind]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const next = (btn.dataset.iconKind === 'icon' ? 'icon' : 'text') as IconDisplayKind;
        selectedIconKind = next;
        syncIconKindSelection();
        updateFieldVisibility();
      });
    });

    iconActionTabs?.querySelectorAll<HTMLButtonElement>('button[data-icon-action]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const next = (btn.dataset.iconAction === 'replace' ? 'replace' : 'popup') as IconDisplayAction;
        selectedIconAction = next;
        syncIconActionSelection();
        updateFieldVisibility();
      });
    });

    const identifierFallback = (): string => {
      try {
        const url = new URL(location.href);
        const slug = url.pathname.split('/').filter(Boolean).pop();
        return slug || url.hostname;
      } catch {
        return location.href;
      }
    };

    const safeQuerySelector = (selector: string | undefined): HTMLElement | null => {
      const trimmed = String(selector || '').trim();
      if (!trimmed) return null;
      try {
        return document.querySelector(trimmed) as HTMLElement | null;
      } catch {
        return null;
      }
    };

    const isValidCssSelector = (selector: string | undefined): boolean => {
      const trimmed = String(selector || '').trim();
      if (!trimmed) return false;
      try {
        document.querySelector(trimmed);
        return true;
      } catch {
        return false;
      }
    };

    const delay = (ms: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

    const safeQueryXPath = (xpath: string | undefined): HTMLElement | null => {
      const trimmed = String(xpath || '').trim();
      if (!trimmed) return null;
      try {
        const result = document.evaluate(trimmed, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = result.singleNodeValue;
        return node instanceof HTMLElement ? node : null;
      } catch {
        return null;
      }
    };

    const sanitizePreviewText = (value: string, maxLength = 140): string => {
      const withoutInjectedCss = value
        .replace(/#ri-inline-vue-host[\s\S]*/giu, ' ')
        .replace(/@layer\s+[\s\S]*/giu, ' ');
      const compact = withoutInjectedCss.replace(/\s+/gu, ' ').trim();
      if (!compact) return '';
      if (compact.length <= maxLength) return compact;
      return `${compact.slice(0, maxLength - 1)}...`;
    };

    const getRawTextFromSelector = (selector: string | undefined): string | null => {
      const el = safeQuerySelector(selector);
      const text = (el?.innerText || el?.textContent || '').trim();
      return text && text.length > 0 ? text : null;
    };

    const extractTitlePreviewFromSelector = (selector: string | undefined): string | null => {
      const raw = getRawTextFromSelector(selector);
      if (!raw) return null;
      const compact = sanitizePreviewText(raw, 110);
      return compact || null;
    };

    const extractEpisodeNumberFromSelector = (selector: string | undefined): string | null => {
      const raw = getRawTextFromSelector(selector);
      if (!raw) return null;
      const compact = sanitizePreviewText(raw, 320);
      return extractEpisodeNumber(compact) || null;
    };

    const updateResetButtonVisibility = () => {
      if (!resetOverridesBtn) return;
      const hasMapping = Boolean(currentMapping);
      resetOverridesBtn.style.display = hasMapping ? '' : 'none';
    };

    const toPathGlob = (pathname: string): string => {
      const raw = String(pathname || '/').trim() || '/';
      const normalized = raw.startsWith('/') ? raw : `/${raw}`;
      const compact = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;

      const segments = compact.split('/').filter(Boolean);
      if (segments.length === 0) return '/';

      // Auto-scope to the section root: /w/slug -> /w/*, /watch/title -> /watch/*.
      return `/${segments[0]}/*`;
    };

    const sanitizePathGlobs = (value: unknown): string[] => {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
    };

    const compactIncludePathGlobs = (globs: string[]): string[] => {
      const unique = Array.from(new Set(globs));
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
    };

    const runExtractionPreview = () => {
      if (!extractionPreview) return;

      const manualTitle = extractTitlePreviewFromSelector(titleInput.value);
      const manualEpisode = extractEpisodeNumberFromSelector(episodeInput.value);
      const usingManual = Boolean(manualTitle || manualEpisode);

      if (usingManual || titleInput.value.trim() || episodeInput.value.trim()) {
        const parts = [
          manualTitle ? `Title: ${manualTitle}` : 'Title: (none)',
          manualEpisode ? `Episode: ${manualEpisode}` : 'Episode: (none detected)',
          `Identifier: ${identifierFallback()}`,
          'Source: selectors',
        ];
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
    runExtractionPreview();

    previewBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      runExtractionPreview();
    });

    const escapeRegExpLiteral = (value: string): string =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const buildEpisodeRegexFromSelection = (fullText: string, start: number, end: number): string | null => {
      if (start < 0 || end <= start || end > fullText.length) return null;
      const selected = fullText.slice(start, end);
      if (!selected.trim()) return null;

      // Find a digit run within the selected substring. This becomes the capture group.
      const digitMatch = /\d+/.exec(selected);
      if (!digitMatch) return null;

      const localDigitStart = digitMatch.index;
      const localDigitEnd = localDigitStart + digitMatch[0].length;

      // Everything in the selection around the digit becomes literal context.
      const prefixLiteral = escapeRegExpLiteral(selected.slice(0, localDigitStart))
        .replace(/\\\s+/g, '\\s*')
        .replace(/ +/g, '\\s*');
      const suffixLiteral = escapeRegExpLiteral(selected.slice(localDigitEnd))
        .replace(/\\\s+/g, '\\s*')
        .replace(/ +/g, '\\s*');

      return `${prefixLiteral}(\\d+)${suffixLiteral}`;
    };

    const getEpisodeSourceText = (): string => {
      const el = safeQuerySelector(episodeInput.value);
      if (!el) return '';
      const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
      return sanitizePreviewText(text, 500);
    };

    const closeEpisodeRegexHelper = () => {
      if (episodeRegexHelper) episodeRegexHelper.style.display = 'none';
      if (episodeRegexPreviewEl) episodeRegexPreviewEl.textContent = '';
    };

    buildEpisodeRegexBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const source = getEpisodeSourceText();
      if (!source) {
        toast.error('Set a working episode selector first');
        return;
      }
      if (!episodeRegexHelper || !episodeRegexSourceText) return;
      episodeRegexSourceText.textContent = source;
      episodeRegexHelper.style.display = '';
      if (episodeRegexPreviewEl) episodeRegexPreviewEl.textContent = 'Highlight the episode number, then click "Apply selection".';
    });

    clearEpisodeRegexBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (episodeRegexInput) episodeRegexInput.value = '';
      closeEpisodeRegexHelper();
    });

    episodeRegexCancelBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeEpisodeRegexHelper();
    });

    episodeRegexApplyBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!episodeRegexSourceText || !episodeRegexInput) return;
      const fullText = episodeRegexSourceText.textContent || '';

      // Read the selection inside the shadow DOM.
      const shadowRoot = episodeRegexSourceText.getRootNode() as ShadowRoot;
      let selectedText = '';
      let startOffset = -1;
      let endOffset = -1;

      try {
        const sel = (shadowRoot as any).getSelection ? (shadowRoot as any).getSelection() : window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          if (episodeRegexSourceText.contains(range.startContainer) && episodeRegexSourceText.contains(range.endContainer)) {
            selectedText = range.toString();
            // Compute offset within the flat textContent.
            const preRange = document.createRange();
            preRange.selectNodeContents(episodeRegexSourceText);
            preRange.setEnd(range.startContainer, range.startOffset);
            startOffset = preRange.toString().length;
            endOffset = startOffset + selectedText.length;
          }
        }
      } catch (err) {
        console.warn('[site-mapper] selection read failed', err);
      }

      if (startOffset < 0 || !selectedText.trim()) {
        // Fallback: if user just wants plain digit extraction.
        const digitOnly = /\d+/.exec(fullText);
        if (!digitOnly) {
          toast.error('Please highlight the episode number first');
          return;
        }
        episodeRegexInput.value = '(\\d+)';
        if (episodeRegexPreviewEl) episodeRegexPreviewEl.textContent = `Preview match: ${digitOnly[0]}`;
        closeEpisodeRegexHelper();
        toast.success('Episode regex set');
        return;
      }

      const built = buildEpisodeRegexFromSelection(fullText, startOffset, endOffset);
      if (!built) {
        toast.error('Selection must contain a number');
        return;
      }

      episodeRegexInput.value = built;
      try {
        const re = new RegExp(built, 'i');
        const m = re.exec(fullText);
        if (episodeRegexPreviewEl) {
          episodeRegexPreviewEl.textContent = m ? `Preview match: ${(m[1] ?? m[0]).trim()}` : 'No match on sample text';
        }
      } catch {}
      closeEpisodeRegexHelper();
      toast.success('Episode regex built');
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
        currentMapping = null;
        setCustomSiteMapping(null);
        mountInput.value = '';
        anchorInput.value = '';
        titleInput.value = '';
        episodeInput.value = '';
        if (episodeRegexInput) episodeRegexInput.value = '';
        if (paddingInput) paddingInput.value = '';
        if (iconDisplayTextInput) iconDisplayTextInput.value = 'Hayami';
        (mountInput as any)._hayamiXPath = '';
        (anchorInput as any)._hayamiXPath = '';
        (titleInput as any)._hayamiXPath = '';
        (episodeInput as any)._hayamiXPath = '';
        selectedPlacement = 'below';
        selectedIconKind = 'text';
        selectedIconAction = 'popup';
        syncTabSelection();
        syncIconKindSelection();
        syncIconActionSelection();
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
      if (clickShield) {
        clickShield.removeEventListener('mousemove', handleHover, true);
        clickShield.removeEventListener('click', handlePick, true);
      }
      document.removeEventListener('mousemove', handleHover, true);
      document.removeEventListener('keydown', handlePickerKeydown, true);
      window.removeEventListener('keydown', handlePickerKeydown, true);
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
      if (clickShield) {
        clickShield.remove();
        clickShield = null;
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
        highlightBox.style.border = '2px solid #2dd4bf';
        highlightBox.style.borderRadius = '6px';
        highlightBox.style.pointerEvents = 'none';
        highlightBox.style.boxShadow = '0 0 0 3px rgba(45, 212, 191, 0.28)';
        highlightBox.style.display = 'none';
        document.body.appendChild(highlightBox);
      }
      return highlightBox;
    }

    function ensureClickShield(): HTMLElement {
      if (!clickShield) {
        clickShield = document.createElement('div');
        clickShield.style.position = 'fixed';
        clickShield.style.inset = '0';
        clickShield.style.zIndex = '2147483001';
        clickShield.style.background = 'transparent';
        clickShield.style.cursor = 'crosshair';
        clickShield.style.pointerEvents = 'auto';
        document.body.appendChild(clickShield);
      }
      return clickShield;
    }

    function resolveDeepTarget(x: number, y: number): HTMLElement | null {
      const shield = ensureClickShield();
      const previousPointerEvents = shield.style.pointerEvents;
      shield.style.pointerEvents = 'none';
      let current: HTMLElement | null = document.elementFromPoint(x, y) as HTMLElement | null;
      shield.style.pointerEvents = previousPointerEvents;
      const isIgnored = (el: HTMLElement | null) => {
        if (!el) return true;
        if (el === document.body || el === document.documentElement) return true;
        if (el.id === 'hayami-site-mapper-overlay') return true;
        if (clickShield && (el === clickShield || clickShield.contains(el))) return true;
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
      if (pickIndicator) {
        const indicatorRect = pickIndicator.getBoundingClientRect();
        const hoveringIndicator =
          clientX >= indicatorRect.left &&
          clientX <= indicatorRect.right &&
          clientY >= indicatorRect.top &&
          clientY <= indicatorRect.bottom;
        pickIndicator.style.opacity = hoveringIndicator ? '0' : '1';
      }
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

    const EPISODE_ACTIVE_CLASS_HINTS = [
      'active',
      'current',
      'selected',
      'is-active',
      'is-current',
      'now-playing',
      'playing',
    ];

    const EPISODE_ACTIVE_CLASS_SUFFIX_HINTS = [
      '--active',
      '-active',
      '_active',
      '--current',
      '-current',
      '_current',
      '--selected',
      '-selected',
      '_selected',
    ];

    const isEpisodeActiveClassToken = (token: string): boolean => {
      const normalized = token.toLowerCase();
      if (EPISODE_ACTIVE_CLASS_HINTS.includes(normalized)) return true;
      return EPISODE_ACTIVE_CLASS_SUFFIX_HINTS.some((suffix) => normalized.endsWith(suffix));
    };

    const hasEpisodeActiveMarker = (element: HTMLElement): boolean => {
      const classList = Array.from(element.classList || []);
      if (classList.some((token) => isEpisodeActiveClassToken(token))) {
        return true;
      }
      const ariaCurrent = (element.getAttribute('aria-current') || '').toLowerCase();
      if (ariaCurrent && ariaCurrent !== 'false') return true;
      const ariaSelected = (element.getAttribute('aria-selected') || '').toLowerCase();
      if (ariaSelected === 'true') return true;
      const dataActive = (element.getAttribute('data-active') || '').toLowerCase();
      if (dataActive === 'true' || dataActive === '1') return true;
      return false;
    };

    const getScopeSelector = (element: HTMLElement): string => {
      const maxDepth = 4;
      let current: HTMLElement | null = element.parentElement;
      for (let depth = 0; current && depth < maxDepth; depth += 1) {
        if (current.id) return `#${CSS.escape(current.id)}`;

        const usefulClass = Array.from(current.classList || [])
          .map((name) => name.trim())
          .filter(Boolean)
          .find((name) => !/\d/u.test(name) && name.length >= 3);

        if (usefulClass) {
          return `${current.tagName.toLowerCase()}.${CSS.escape(usefulClass)}`;
        }

        current = current.parentElement;
      }
      return '';
    };

    const buildEpisodeActiveSelector = (pickedTarget: HTMLElement): { selector: string; element: HTMLElement } => {
      const hasListLikeSiblings = (element: HTMLElement): boolean => {
        const parent = element.parentElement;
        if (!parent) return false;
        const sameTagSiblings = Array.from(parent.children)
          .filter((child): child is HTMLElement => child instanceof HTMLElement)
          .filter((child) => child.tagName === element.tagName);
        return sameTagSiblings.length >= 3;
      };

      const resolveEpisodeItemCandidate = (target: HTMLElement): HTMLElement => {
        const explicit = target.closest<HTMLElement>(
          'a.ep-item, li.ep-item, a[data-number], li[data-number], [data-episode], [aria-current], [aria-selected]'
        );
        if (explicit) return explicit;

        const semantic = target.closest<HTMLElement>('a, li, button, article');
        if (semantic) return semantic;

        let cursor: HTMLElement | null = target;
        while (cursor && cursor !== document.body) {
          if (hasEpisodeActiveMarker(cursor)) return cursor;
          if (hasListLikeSiblings(cursor)) return cursor;
          cursor = cursor.parentElement;
        }

        return target;
      };

      const pickedItem = resolveEpisodeItemCandidate(pickedTarget);
      const parent = pickedItem.parentElement;
      const siblingItems = parent
        ? Array.from(parent.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement)
            .filter((child) => child.tagName === pickedItem.tagName)
        : [];

      const activeSibling = siblingItems.find((child) => hasEpisodeActiveMarker(child));
      const activeItem = activeSibling || (hasEpisodeActiveMarker(pickedItem) ? pickedItem : null);

      if (!activeItem) {
        return { selector: getElementCssSelector(pickedItem), element: pickedItem };
      }

      const markerClass = Array.from(activeItem.classList || []).find((token) => isEpisodeActiveClassToken(token));

      const stableClasses = Array.from(activeItem.classList || [])
        .filter((token) => token && token !== markerClass)
        .filter((token) => !/\d/u.test(token))
        .slice(0, 2)
        .map((token) => `.${CSS.escape(token)}`)
        .join('');

      const base = `${activeItem.tagName.toLowerCase()}${stableClasses}`;
      const scope = getScopeSelector(activeItem);

      const selectorCandidates: string[] = [];
      if (markerClass) selectorCandidates.push(`${base}.${CSS.escape(markerClass)}`);
      selectorCandidates.push(`${base}[aria-current]:not([aria-current='false'])`);
      selectorCandidates.push(`${base}[aria-selected='true']`);
      selectorCandidates.push(`${base}[data-active='true']`);

      for (const local of selectorCandidates) {
        const scoped = scope ? `${scope} ${local}` : local;
        if (safeQuerySelector(scoped)) {
          return { selector: scoped, element: activeItem };
        }
      }

      return { selector: getElementCssSelector(activeItem), element: activeItem };
    };

    function handleHover(ev: MouseEvent) {
      lastHoverEvent = ev;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(paintHover);
    }

    function handlePickerKeydown(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return;
      if (!(document.body as any)._hayamiPickingTarget) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof (ev as any).stopImmediatePropagation === 'function') {
        (ev as any).stopImmediatePropagation();
      }
      delete (document.body as any)._hayamiPickingTarget;
      cleanupPickers();
    }

    function handlePick(ev: MouseEvent) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof (ev as any).stopImmediatePropagation === 'function') {
        (ev as any).stopImmediatePropagation();
      }
      const target = resolveDeepTarget(ev.clientX, ev.clientY) || (ev.target as HTMLElement | null);
      const picking = (document.body as any)._hayamiPickingTarget as string | undefined;
      cleanupPickers();
      delete (document.body as any)._hayamiPickingTarget;
      if (!target || !picking || !inputs[picking]) return;

      if (picking === 'episode') {
        const resolved = buildEpisodeActiveSelector(target);
        inputs[picking].value = resolved.selector;
        (inputs[picking] as any)._hayamiXPath = getAbsoluteXPathNoId(resolved.element);
      } else {
        inputs[picking].value = getElementCssSelector(target);
        (inputs[picking] as any)._hayamiXPath = getAbsoluteXPathNoId(target);
      }
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
        pickIndicator.textContent = `Click an element to set ${target} selector (Esc to cancel)`;
        shadow.appendChild(pickIndicator);
        const shield = ensureClickShield();
        shield.addEventListener('mousemove', handleHover, true);
        shield.addEventListener('click', handlePick, true);
        document.addEventListener('mousemove', handleHover, true);
        document.addEventListener('keydown', handlePickerKeydown, true);
        window.addEventListener('keydown', handlePickerKeydown, true);
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
      const currentPathGlob = toPathGlob(window.location.pathname);
      const mergedIncludes = compactIncludePathGlobs([
        ...sanitizePathGlobs(currentMapping?.includePathGlobs),
        currentPathGlob,
      ]);
      const mapping: CustomSiteMapping = {
        origin: location.origin,
        display: placement,
        iconDisplayKind: selectedIconKind,
        iconDisplayAction: selectedIconAction,
        iconDisplayText: (iconDisplayTextInput?.value || '').trim() || 'Hayami',
        includePathGlobs: mergedIncludes,
        excludePathGlobs: sanitizePathGlobs(currentMapping?.excludePathGlobs),
        anchorSelector: anchorInput.value.trim(),
        mountSelector: mountInput.value.trim() || anchorInput.value.trim() || 'body',
        titleSelector: titleInput.value.trim(),
        episodeSelector: episodeInput.value.trim(),
        episodeRegex: (episodeRegexInput?.value || '').trim() || undefined,
        sidePadding,
        anchorXPath: (anchorInput as any)._hayamiXPath || currentMapping?.anchorXPath || '',
        mountXPath: (mountInput as any)._hayamiXPath || currentMapping?.mountXPath || '',
        titleXPath: (titleInput as any)._hayamiXPath || currentMapping?.titleXPath || '',
        episodeXPath: (episodeInput as any)._hayamiXPath || currentMapping?.episodeXPath || '',
      };

      try {
        const map = (await customSiteMappingsItem.getValue()) || {};
        map[location.origin] = mapping;
        await customSiteMappingsItem.setValue(map);
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
