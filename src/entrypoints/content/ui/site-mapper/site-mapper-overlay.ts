// @ts-ignore Missing types for wxt in this context
import { ContentScriptContext } from 'wxt/utils/content-scripts-context';
import { con } from '@/utils/logger';

const log = con.m('SiteMapper');
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
  siteMapperAdvancedModeItem,
} from '@/config/storage';
import { setLastProcessedKey } from '../../state';
import { getUiManager } from '../../core/ui-manager';

export function setupSiteMapperHotkey(ctx: ContentScriptContext, toast: any, queueHandleWatchPage: (ctx: ContentScriptContext) => void, ensureFeatureInitialized?: () => void): void {
  if (isMapperHotkeyAttached()) return;
  setMapperHotkeyAttached(true);

  const openOverlay = () => openSiteMapperOverlay(ctx, toast, queueHandleWatchPage, ensureFeatureInitialized);

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
      log.warn('Rejected message from unauthorized sender:', sender.id);
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

export function openSiteMapperOverlay(ctx: ContentScriptContext, toast: any, queueHandleWatchPage: (ctx: ContentScriptContext) => void, ensureFeatureInitialized?: () => void): void {
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

    // Apply the popup's "Show more advanced options" preference; CSS
    // (`:host(.advanced-mode) .mapper-row[data-field="releaseDate"]`) reveals
    // the Release date row when the toggle is on.
    void (async () => {
      try {
        const enabled = await siteMapperAdvancedModeItem.getValue();
        overlay.classList.toggle('advanced-mode', Boolean(enabled));
      } catch {}
    })();

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

      /* ---- Compact "Map site" UI ---- */
      .panel { width: min(900px, 94vw); padding: 24px 26px 22px; gap: 18px; }
      .panel h2 { font-size: 18px; }
      .tab-row { padding: 5px; gap: 6px; }
      .tab-row .tab { padding: 9px 12px; font-size: 12px; font-weight: 600; border-radius: 8px; }
      .mapper-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px 22px;
        min-width: 0;
      }
      .mapper-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 34px;
        min-width: 0;
      }
      .mapper-row.hidden { display: none; }
      /* Release date and episode list are advanced rows — hidden unless
         the popup's "Show more advanced options" toggle adds .advanced-mode
         to the host. */
      .mapper-row[data-field="releaseDate"] { display: none; }
      .mapper-row[data-field="episodeList"] { display: none; }
      :host(.advanced-mode) .mapper-row[data-field="releaseDate"] { display: flex; }
      :host(.advanced-mode) .mapper-row[data-field="episodeList"] { display: flex; }
      .mapper-row .row-label {
        font-size: 13px;
        font-weight: 600;
        color: rgba(255,255,255,0.82);
        flex-shrink: 0;
        white-space: nowrap;
      }
      .mapper-row .row-value {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        color: rgba(255,255,255,0.55);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 6px 10px;
        border-radius: 7px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.06);
        outline: none;
      }
      .mapper-row.is-set .row-value { color: #f7f7fb; }
      .mapper-row .row-value:focus-visible { border-color: rgba(91,168,255,0.5); }
      .info-tip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.28);
        color: rgba(255,255,255,0.72);
        background: transparent;
        cursor: help;
        flex-shrink: 0;
        font-size: 10px;
        font-weight: 700;
        font-family: inherit;
        line-height: 1;
        padding: 0;
      }
      .info-tip:hover { border-color: rgba(255,255,255,0.5); color: #fff; }
      /* ---- Custom floating tooltip (shared) ---- */
      .hayami-tooltip {
        position: fixed;
        z-index: 2147483002;
        max-width: 260px;
        padding: 8px 10px;
        border-radius: 8px;
        background: #171c24;
        border: 1px solid rgba(255,255,255,0.15);
        color: rgba(255,255,255,0.88);
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 11px;
        line-height: 1.45;
        box-shadow: 0 10px 28px rgba(0,0,0,0.5);
        pointer-events: none;
        white-space: normal;
        word-break: break-word;
        opacity: 0;
        transform: translate(-50%, -4px);
        transition: opacity 120ms ease;
      }
      .hayami-tooltip.is-visible { opacity: 1; transform: translate(-50%, 0); }
      .pick-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 6px;
        border: 1px solid rgba(91,168,255,0.5);
        background: rgba(91,168,255,0.1);
        color: #cfe5ff;
        cursor: pointer;
        flex-shrink: 0;
        min-width: 52px;
      }
      .pick-btn:hover { background: rgba(91,168,255,0.22); }
      .pick-btn.is-set {
        border-color: rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.82);
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.14);
        background: transparent;
        color: rgba(255,255,255,0.65);
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
      }
      .icon-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
      .icon-btn.is-active {
        border-color: rgba(91,168,255,0.6);
        color: #cfe5ff;
        background: rgba(91,168,255,0.12);
      }
      .icon-btn svg { width: 12px; height: 12px; }
      .regex-popover {
        grid-column: 1 / -1;
        margin: 2px 0 4px;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        display: none;
        flex-direction: column;
        gap: 6px;
      }
      .regex-popover.is-open { display: flex; }
      .regex-popover .source-text {
        user-select: text;
        cursor: text;
        padding: 6px 8px;
        border-radius: 6px;
        background: rgba(0,0,0,0.3);
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 80px;
        overflow: auto;
      }
      .regex-popover .hint { font-size: 11px; color: rgba(255,255,255,0.6); }
      .regex-popover ::selection { background: rgba(45, 212, 191, 0.4); color: #fff; }
      .regex-popover .popover-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .regex-popover .popover-actions .hint { margin-left: auto; }
      .regex-popover .pick-btn { padding: 3px 8px; min-width: 0; }
      /* Raw selector inputs are hidden by default. Mount / Anchor rows can be
         revealed individually via the inline pencil (adds .is-open to that row);
         all other raw inputs stay hidden as machinery written to by the picker
         and read by the save/extract code. */
      .raw-selector-row {
        display: none;
        grid-column: 1 / -1;
        align-items: center;
        gap: 6px;
        margin-top: -2px;
      }
      .raw-selector-row .raw-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: rgba(255,255,255,0.4);
        min-width: 58px;
      }
      .raw-selector-row.is-open { display: flex; }
      .raw-selector-row input {
        flex: 1;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10px;
        padding: 5px 8px;
        border-radius: 6px;
      }
      .inline-inputs {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 140px);
        gap: 10px;
        align-items: center;
        min-width: 0;
      }
      .inline-inputs .mini-field {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .inline-inputs .mini-field > input { min-width: 0; }
      .inline-inputs .mini-field > .tab-row { min-width: 0; flex: 1; }
      .inline-inputs .mini-field label {
        font-size: 11px;
        font-weight: 600;
        color: rgba(255,255,255,0.68);
        white-space: nowrap;
      }
      .inline-inputs .mini-field input {
        flex: 1;
        padding: 6px 9px;
        font-size: 12px;
        border-radius: 7px;
      }
      .inline-inputs .mini-field.hidden { display: none; }
      .inline-inputs.hidden { display: none; }
      .inline-inputs.icon-tabs-row {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      .footer-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .footer-row .left-actions { display: flex; gap: 6px; }
      .footer-row .right-actions { display: flex; gap: 8px; }
      .footer-row button { padding: 7px 12px; font-size: 12px; }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'overlay';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const pencilIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>`;
    const escapeAttr = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tip = (text: string, id?: string) =>
      `<button type="button" class="info-tip"${id ? ` id="${id}"` : ''} data-hayami-tip="${escapeAttr(text)}" aria-label="${escapeAttr(text)}" tabindex="0">?</button>`;

    panel.innerHTML = `
      <h2>Map this site to Hayami</h2>
      <div class="tab-row" id="placementTabs">
        <button class="tab active" data-placement="below">Below</button>
        <button class="tab" data-placement="insert">Inline</button>
        <button class="tab" data-placement="replace">Replace</button>
        <button class="tab" data-placement="popup">Popup</button>
        <button class="tab" data-placement="icon">Icon</button>
      </div>

      <div class="inline-inputs icon-tabs-row" data-field="iconKindRow">
        <div class="mini-field" data-field="iconKind">
          <label>Icon style</label>
          <div class="tab-row" id="iconKindTabs" style="flex:1;">
            <button class="tab active" data-icon-kind="text">Text</button>
            <button class="tab" data-icon-kind="icon">Icon</button>
          </div>
        </div>
        <div class="mini-field" data-field="iconAction">
          <label>Click</label>
          <div class="tab-row" id="iconActionTabs" style="flex:1;">
            <button class="tab active" data-icon-action="popup">Popup</button>
            <button class="tab" data-icon-action="replace">Replace</button>
          </div>
        </div>
      </div>

      <div class="mapper-grid">
        <div class="mapper-row" data-field="title">
          <button class="pick-btn" data-target="title" data-pick-kind="title">Pick</button>
          <span class="row-label">Title</span>
          ${tip('The element on the page that contains the anime or show title.')}
          <span class="row-value" data-preview-value="title" data-tip-overflow tabindex="0">Not picked</span>
          <button class="icon-btn" id="titleRegexToggle" type="button" aria-label="Build title extractor" data-hayami-tip="Build a regex to clean up the title">${pencilIconSvg}</button>
        </div>
        <div class="mapper-row" data-field="episode">
          <button class="pick-btn" data-target="episode" data-pick-kind="episode">Pick</button>
          <span class="row-label">Episode</span>
          ${tip('The element that contains the episode number.')}
          <span class="row-value" data-preview-value="episode" data-tip-overflow tabindex="0">Not picked</span>
          <button class="icon-btn" id="episodeRegexToggle" type="button" aria-label="Build episode extractor" data-hayami-tip="Build a regex to extract the episode number">${pencilIconSvg}</button>
        </div>

        <div class="regex-popover" data-regex-popover="title">
          <div class="hint">Highlight just the <b>title</b> portion below, then Apply.</div>
          <div class="source-text" data-regex-source="title"></div>
          <div class="popover-actions">
            <button class="pick-btn" data-regex-apply="title" type="button">Apply</button>
            <button class="icon-btn" data-regex-clear="title" type="button" aria-label="Clear" title="Clear">✕</button>
            <span class="hint" data-regex-preview="title"></span>
          </div>
        </div>
        <div class="regex-popover" data-regex-popover="episode">
          <div class="hint">Highlight just the <b>episode number</b> below, then Apply.</div>
          <div class="source-text" data-regex-source="episode"></div>
          <div class="popover-actions">
            <button class="pick-btn" data-regex-apply="episode" type="button">Apply</button>
            <button class="icon-btn" data-regex-clear="episode" type="button" aria-label="Clear" title="Clear">✕</button>
            <span class="hint" data-regex-preview="episode"></span>
          </div>
        </div>

        <div class="mapper-row" data-field="mount">
          <button class="pick-btn" data-target="mount" data-pick-kind="mount">Pick</button>
          <span class="row-label" id="mountLabelText">Mount selector</span>
          ${tip('Parent container Hayami will mount its comments inside. If left blank, Display target is used.', 'mountInfoTip')}
          <button class="icon-btn" id="mountRawToggle" type="button" aria-label="Edit raw mount selector" data-hayami-tip="Edit the raw CSS selector manually">${pencilIconSvg}</button>
        </div>
        <div class="mapper-row" data-field="anchor">
          <button class="pick-btn" data-target="anchor" data-pick-kind="anchor">Pick</button>
          <span class="row-label" id="anchorLabelText">Display target</span>
          ${tip("The site's existing comments element. Hayami will append inside it, replace it, or hide it depending on the display mode.", 'anchorInfoTip')}
          <button class="icon-btn" id="anchorRawToggle" type="button" aria-label="Edit raw anchor selector" data-hayami-tip="Edit the raw CSS selector manually">${pencilIconSvg}</button>
        </div>

        <div class="mapper-row" data-field="releaseDate">
          <button class="pick-btn" data-target="releaseDate" data-pick-kind="releaseDate">Pick</button>
          <span class="row-label">Release date</span>
          ${tip('Optional. The element that shows when the episode aired (e.g. "Aired: Jan 9, 2026"). Helps pick the right discussion for multi-season shows.')}
          <span class="row-value" data-preview-value="releaseDate" data-tip-overflow tabindex="0">Not picked</span>
          <button class="icon-btn" id="releaseDateRegexToggle" type="button" aria-label="Build release-date extractor" data-hayami-tip="Build a regex to extract just the date">${pencilIconSvg}</button>
        </div>
        <div class="mapper-row" data-field="episodeList">
          <button class="pick-btn" data-target="episodeList" data-pick-kind="episodeList">Pick</button>
          <span class="row-label">Episode list</span>
          ${tip('Optional. The container holding the page’s episode list (dropdown / sidebar / grid). Lets Hayami spot when a sub-cour page labels episodes cumulatively (e.g. "Episode 25–30" for Cour 3) and offset them to the right discussion thread.')}
          <span class="row-value" data-preview-value="episodeList" data-tip-overflow tabindex="0">Not picked</span>
          <button class="icon-btn" id="episodeListRegexToggle" type="button" aria-label="Build episode-list item extractor" data-hayami-tip="Build a regex to pull the episode number out of each list item">${pencilIconSvg}</button>
        </div>
        <div class="regex-popover" data-regex-popover="releaseDate">
          <div class="hint">Highlight just the <b>date</b> portion below, then Apply.</div>
          <div class="source-text" data-regex-source="releaseDate"></div>
          <div class="popover-actions">
            <button class="pick-btn" data-regex-apply="releaseDate" type="button">Apply</button>
            <button class="icon-btn" data-regex-clear="releaseDate" type="button" aria-label="Clear" title="Clear">✕</button>
            <span class="hint" data-regex-preview="releaseDate"></span>
          </div>
        </div>
        <div class="regex-popover" data-regex-popover="episodeList">
          <div class="hint">Highlight just the <b>episode number</b> in one item below, then Apply.</div>
          <div class="source-text" data-regex-source="episodeList"></div>
          <div class="popover-actions">
            <button class="pick-btn" data-regex-apply="episodeList" type="button">Apply</button>
            <button class="icon-btn" data-regex-clear="episodeList" type="button" aria-label="Clear" title="Clear">✕</button>
            <span class="hint" data-regex-preview="episodeList"></span>
          </div>
        </div>

        <!-- Hidden raw inputs: written to by the picker/regex-popover machinery
             and read by save/extraction code. Never shown to the user. -->
        <div class="raw-selector-row"><span class="raw-label">Title CSS</span><input id="titleSelector" type="text" placeholder="CSS selector" /></div>
        <div class="raw-selector-row"><span class="raw-label">Episode CSS</span><input id="episodeSelector" type="text" placeholder="CSS selector" /></div>
        <div class="raw-selector-row" data-raw-for="mount"><span class="raw-label">Mount CSS</span><input id="mountSelector" type="text" placeholder="CSS selector" /></div>
        <div class="raw-selector-row" data-raw-for="anchor"><span class="raw-label">Anchor CSS</span><input id="anchorSelector" type="text" placeholder="CSS selector" /></div>
        <div class="raw-selector-row"><span class="raw-label">Title regex</span><input id="titleRegex" type="text" placeholder="Title regex" /></div>
        <div class="raw-selector-row"><span class="raw-label">Episode regex</span><input id="episodeRegex" type="text" placeholder="Episode regex" /></div>
        <div class="raw-selector-row"><span class="raw-label">Date CSS</span><input id="releaseDateSelector" type="text" placeholder="CSS selector" /></div>
        <div class="raw-selector-row"><span class="raw-label">Date regex</span><input id="releaseDateRegex" type="text" placeholder="Date regex" /></div>
        <div class="raw-selector-row"><span class="raw-label">Episode list CSS</span><input id="episodeListSelector" type="text" placeholder="CSS selector" /></div>
        <div class="raw-selector-row"><span class="raw-label">Episode list item regex</span><input id="episodeListItemRegex" type="text" placeholder="Episode list item regex" /></div>
      </div>

      <div class="inline-inputs">
        <div class="mini-field" data-field="iconText">
          <label>Label</label>
          <input id="iconDisplayText" type="text" placeholder="Hayami" />
        </div>
        <div class="mini-field" data-field="padding">
          <label>Padding</label>
          <input id="sidePadding" type="number" min="0" step="4" placeholder="0" />
        </div>
      </div>

      <div class="footer-row">
        <div class="left-actions">
          <button class="pick" id="resetOverrides">Reset</button>
        </div>
        <div class="right-actions">
          <button id="cancelMapper">Cancel</button>
          <button id="saveMapper" class="primary">Save & Embed</button>
        </div>
      </div>
    `;
    container.appendChild(panel);
    shadow.appendChild(container);
    document.body.appendChild(overlay);

    // ---- Custom tooltip (shared by info icons and ellipsis overflow) ----
    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'hayami-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    shadow.appendChild(tooltipEl);
    let tooltipHideTimer: number | null = null;
    const showTooltip = (target: HTMLElement, text: string) => {
      if (!text) return;
      if (tooltipHideTimer !== null) {
        window.clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
      }
      tooltipEl.textContent = text;
      tooltipEl.classList.add('is-visible');
      const rect = target.getBoundingClientRect();
      // Temporarily measure to clamp to viewport.
      tooltipEl.style.left = '0px';
      tooltipEl.style.top = '0px';
      const tipRect = tooltipEl.getBoundingClientRect();
      const margin = 8;
      const center = rect.left + rect.width / 2;
      const half = tipRect.width / 2;
      const minCenter = margin + half;
      const maxCenter = window.innerWidth - margin - half;
      const clamped = Math.min(Math.max(center, minCenter), maxCenter);
      let top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - tipRect.height - 8);
      }
      tooltipEl.style.left = `${clamped}px`;
      tooltipEl.style.top = `${top}px`;
    };
    const hideTooltip = () => {
      tooltipEl.classList.remove('is-visible');
    };
    const resolveTipText = (el: HTMLElement): string | null => {
      const direct = el.getAttribute('data-hayami-tip');
      if (direct) return direct;
      // Ellipsis-overflow detection for elements marked with data-tip-overflow.
      if (el.hasAttribute('data-tip-overflow')) {
        const full = el.getAttribute('data-full-text') || el.textContent || '';
        if (el.scrollWidth > el.clientWidth + 1 && full) return full;
      }
      return null;
    };
    const onTipEnter = (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const owner = target.closest('[data-hayami-tip],[data-tip-overflow]') as HTMLElement | null;
      if (!owner) return;
      const text = resolveTipText(owner);
      if (text) showTooltip(owner, text);
    };
    const onTipLeave = (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-hayami-tip],[data-tip-overflow]')) hideTooltip();
    };
    shadow.addEventListener('mouseover', onTipEnter, true);
    shadow.addEventListener('mouseout', onTipLeave, true);
    shadow.addEventListener('focusin', onTipEnter, true);
    shadow.addEventListener('focusout', onTipLeave, true);

    const mountInput = shadow.getElementById('mountSelector') as HTMLInputElement;
    const anchorInput = shadow.getElementById('anchorSelector') as HTMLInputElement;
    const titleInput = shadow.getElementById('titleSelector') as HTMLInputElement;
    const episodeInput = shadow.getElementById('episodeSelector') as HTMLInputElement;
    const episodeRegexInput = shadow.getElementById('episodeRegex') as HTMLInputElement | null;
    const titleRegexInput = shadow.getElementById('titleRegex') as HTMLInputElement | null;
    const releaseDateInput = shadow.getElementById('releaseDateSelector') as HTMLInputElement | null;
    const releaseDateRegexInput = shadow.getElementById('releaseDateRegex') as HTMLInputElement | null;
    const episodeListInput = shadow.getElementById('episodeListSelector') as HTMLInputElement | null;
    const episodeListItemRegexInput = shadow.getElementById('episodeListItemRegex') as HTMLInputElement | null;
    const titleRegexToggleBtn = shadow.getElementById('titleRegexToggle') as HTMLButtonElement | null;
    const episodeRegexToggleBtn = shadow.getElementById('episodeRegexToggle') as HTMLButtonElement | null;
    const releaseDateRegexToggleBtn = shadow.getElementById('releaseDateRegexToggle') as HTMLButtonElement | null;
    const episodeListRegexToggleBtn = shadow.getElementById('episodeListRegexToggle') as HTMLButtonElement | null;
    const paddingInput = shadow.getElementById('sidePadding') as HTMLInputElement | null;
    const placementTabs = shadow.getElementById('placementTabs') as HTMLElement | null;
    const iconKindTabs = shadow.getElementById('iconKindTabs') as HTMLElement | null;
    const iconActionTabs = shadow.getElementById('iconActionTabs') as HTMLElement | null;
    const resetOverridesBtn = shadow.getElementById('resetOverrides') as HTMLButtonElement | null;
    const iconDisplayTextInput = shadow.getElementById('iconDisplayText') as HTMLInputElement | null;
    const mountLabelText = shadow.getElementById('mountLabelText') as HTMLElement | null;
    const anchorLabelText = shadow.getElementById('anchorLabelText') as HTMLElement | null;
    const previewTitleValue = shadow.querySelector('[data-preview-value="title"]') as HTMLElement | null;
    const previewEpisodeValue = shadow.querySelector('[data-preview-value="episode"]') as HTMLElement | null;
    const previewReleaseDateValue = shadow.querySelector('[data-preview-value="releaseDate"]') as HTMLElement | null;
    const previewEpisodeListValue = shadow.querySelector('[data-preview-value="episodeList"]') as HTMLElement | null;
    const previewTitleRow = shadow.querySelector('.mapper-row[data-field="title"]') as HTMLElement | null;
    const previewEpisodeRow = shadow.querySelector('.mapper-row[data-field="episode"]') as HTMLElement | null;
    const previewReleaseDateRow = shadow.querySelector('.mapper-row[data-field="releaseDate"]') as HTMLElement | null;
    const previewEpisodeListRow = shadow.querySelector('.mapper-row[data-field="episodeList"]') as HTMLElement | null;
    const iconKindRowEl = shadow.querySelector('[data-field="iconKindRow"]') as HTMLElement | null;

    const fieldGroups: Record<string, HTMLElement | null> = {
      mount: shadow.querySelector('.mapper-row[data-field="mount"]') as HTMLElement | null,
      anchor: shadow.querySelector('.mapper-row[data-field="anchor"]') as HTMLElement | null,
      title: shadow.querySelector('.mapper-row[data-field="title"]') as HTMLElement | null,
      episode: shadow.querySelector('.mapper-row[data-field="episode"]') as HTMLElement | null,
      iconKind: shadow.querySelector('.mini-field[data-field="iconKind"]') as HTMLElement | null,
      iconAction: shadow.querySelector('.mini-field[data-field="iconAction"]') as HTMLElement | null,
      iconText: shadow.querySelector('.mini-field[data-field="iconText"]') as HTMLElement | null,
      padding: shadow.querySelector('.mini-field[data-field="padding"]') as HTMLElement | null,
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
      if (titleRegexInput) titleRegexInput.value = currentMapping.titleRegex || '';
      if (releaseDateInput) releaseDateInput.value = currentMapping.releaseDateSelector || '';
      if (releaseDateRegexInput) releaseDateRegexInput.value = currentMapping.releaseDateRegex || '';
      if (episodeListInput) episodeListInput.value = currentMapping.episodeListSelector || '';
      if (episodeListItemRegexInput) episodeListItemRegexInput.value = currentMapping.episodeListItemRegex || '';
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
      if (releaseDateInput) (releaseDateInput as any)._hayamiXPath = currentMapping.releaseDateXPath || '';
      if (episodeListInput) (episodeListInput as any)._hayamiXPath = currentMapping.episodeListXPath || '';
    }

    const inputs: Record<string, HTMLInputElement> = {
      mount: mountInput,
      anchor: anchorInput,
      title: titleInput,
      episode: episodeInput,
      ...(releaseDateInput ? { releaseDate: releaseDateInput } : {}),
      ...(episodeListInput ? { episodeList: episodeListInput } : {}),
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
      below: ['anchor', 'mount', 'title', 'episode', 'padding'],
      insert: ['mount', 'title', 'episode', 'padding'],
      replace: ['anchor', 'title', 'episode', 'padding'],
      popup: ['title', 'episode'],
      icon: ['mount', 'title', 'episode', 'iconKind', 'iconAction', 'iconText', 'padding'],
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

      if (iconKindRowEl) {
        const showIconBar = visible.has('iconKind') || visible.has('iconAction');
        iconKindRowEl.classList.toggle('hidden', !showIconBar);
      }

      const isIconMode = selectedPlacement === 'icon';
      if (mountLabelText) {
        mountLabelText.textContent = isIconMode ? 'Trigger location' : 'Mount selector';
      }
      if (anchorLabelText) {
        anchorLabelText.textContent = isIconMode ? 'Initial comments element' : 'Display target';
      }
      const mountTip = shadow.getElementById('mountInfoTip');
      if (mountTip) {
        const text = isIconMode
          ? 'Where the Hayami icon or text trigger will be inserted on the page.'
          : 'Parent container Hayami will mount its comments inside. If left blank, Display target is used.';
        mountTip.setAttribute('data-hayami-tip', text);
        mountTip.setAttribute('aria-label', text);
      }
      const anchorTip = shadow.getElementById('anchorInfoTip');
      if (anchorTip) {
        const text = isIconMode
          ? "The site's existing comments element. In Replace mode it toggles with Hayami when the trigger is clicked; in Popup mode it stays hidden while Hayami is open."
          : "The site's existing comments element. Hayami will append inside it, replace it, or hide it depending on the display mode.";
        anchorTip.setAttribute('data-hayami-tip', text);
        anchorTip.setAttribute('aria-label', text);
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

    /**
     * Live preview helper: walk the picked episode-list container and parse
     * episode numbers out of its descendants. Mirrors the runtime behaviour
     * of `getCustomEpisodeNumbers` in site-mapper-utils — the saved mapping
     * is read by the runtime helper there, but during overlay editing the
     * mapping isn't saved yet, so we reproduce the parse against the input
     * value directly.
     */
    const previewEpisodeListNumbers = (
      selector: string | undefined,
      itemRegex: string | undefined,
    ): number[] => {
      const container = safeQuerySelector(selector);
      if (!container) return [];

      const patterns: RegExp[] = [];
      const userPattern = String(itemRegex || '').trim();
      if (userPattern) {
        try { patterns.push(new RegExp(userPattern, 'i')); } catch {}
      }
      patterns.push(
        /\b(?:Episode|Ep\.?|EP)\s*[:#-]?\s*(\d{1,4})\b/i,
        /^\s*(\d{1,4})\s*$/,
      );

      const parseNumber = (text: string): number | null => {
        for (const re of patterns) {
          const m = text.match(re);
          if (!m) continue;
          const captured = m[1] ?? m[0];
          const parsed = Number.parseInt(String(captured).trim(), 10);
          if (Number.isFinite(parsed) && parsed > 0 && parsed <= 9999) return parsed;
        }
        return null;
      };

      const found = new Set<number>();
      const containerText = (container.textContent || '').trim();
      if (containerText.length < 20) {
        const direct = parseNumber(containerText);
        if (direct !== null) found.add(direct);
      }

      const candidates = container.querySelectorAll('a, li, button, span, div, p');
      for (const el of Array.from(candidates)) {
        if (el.children.length > 0 && el.tagName !== 'A' && el.tagName !== 'BUTTON' && el.tagName !== 'LI') continue;
        const text = (el.textContent || '').trim();
        if (!text || text.length > 60) continue;
        const num = parseNumber(text);
        if (num !== null) found.add(num);
      }

      return Array.from(found).sort((a, b) => a - b);
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

      // Single-segment pathnames (e.g. /ascendance-of-a-bookworm-episode-1)
      // have no "section root" to scope to — the slug itself IS
      // the page. Using `/${slug}/*` would compile to `^/slug/.*$` which does
      // not match the saved page, so the mapping never re-matches. Fall back
      // to `/*` so every top-level slug on the origin is covered.
      if (segments.length === 1) return '/*';

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

    const applyUserRegex = (text: string, pattern: string | undefined | null): string | null => {
      const trimmed = String(pattern || '').trim();
      if (!trimmed) return null;
      try {
        const re = new RegExp(trimmed, 'i');
        const m = re.exec(text);
        if (!m) return null;
        return (m[1] ?? m[0] ?? '').trim() || null;
      } catch {
        return null;
      }
    };

    const setPreviewRow = (row: HTMLElement | null, valueEl: HTMLElement | null, value: string | null) => {
      if (!row || !valueEl) return;
      if (value && value.length > 0) {
        row.classList.add('is-set');
        valueEl.textContent = value;
        valueEl.setAttribute('data-full-text', value);
      } else {
        row.classList.remove('is-set');
        valueEl.textContent = 'Not picked';
        valueEl.removeAttribute('data-full-text');
      }
    };

    const updateStatusPill = (field: 'mount' | 'anchor' | 'title' | 'episode' | 'releaseDate' | 'episodeList') => {
      const input = inputsByField(field);
      const value = (input?.value || '').trim();
      const row = shadow.querySelector(`.mapper-row[data-field="${field}"]`) as HTMLElement | null;
      const pickBtn = shadow.querySelector(`.pick-btn[data-target="${field}"]`) as HTMLButtonElement | null;
      const isSet = value.length > 0;
      if (row) row.classList.toggle('is-set', isSet);
      if (pickBtn) {
        pickBtn.classList.toggle('is-set', isSet);
        pickBtn.textContent = isSet ? 'Re-pick' : pickBtn.dataset.defaultLabel || 'Pick';
      }
    };

    const inputsByField = (field: string): HTMLInputElement | null => {
      if (field === 'mount') return mountInput;
      if (field === 'anchor') return anchorInput;
      if (field === 'title') return titleInput;
      if (field === 'episode') return episodeInput;
      if (field === 'releaseDate') return releaseDateInput;
      if (field === 'episodeList') return episodeListInput;
      return null;
    };

    // Cache default pick button labels for restore after "Re-pick".
    shadow.querySelectorAll<HTMLButtonElement>('.pick-btn[data-target]').forEach((btn) => {
      btn.dataset.defaultLabel = btn.textContent || '';
    });

    const runExtractionPreview = () => {
      const rawTitle = extractTitlePreviewFromSelector(titleInput.value);
      const rawEpisode = getRawTextFromSelector(episodeInput.value);

      let finalTitle: string | null = rawTitle;
      if (rawTitle && titleRegexInput?.value.trim()) {
        const extracted = applyUserRegex(rawTitle, titleRegexInput.value);
        if (extracted) finalTitle = extracted;
      }

      let finalEpisode: string | null = null;
      if (rawEpisode) {
        const compact = sanitizePreviewText(rawEpisode, 320);
        if (episodeRegexInput?.value.trim()) {
          finalEpisode = applyUserRegex(compact, episodeRegexInput.value);
        }
        if (!finalEpisode) {
          finalEpisode = extractEpisodeNumber(compact) || null;
        }
      }

      let finalReleaseDate: string | null = null;
      if (releaseDateInput?.value) {
        const rawDate = getRawTextFromSelector(releaseDateInput.value);
        if (rawDate) {
          const compact = sanitizePreviewText(rawDate, 160);
          if (releaseDateRegexInput?.value.trim()) {
            finalReleaseDate = applyUserRegex(compact, releaseDateRegexInput.value) || compact;
          } else {
            finalReleaseDate = compact;
          }
        }
      }

      let finalEpisodeList: string | null = null;
      if (episodeListInput?.value) {
        const numbers = previewEpisodeListNumbers(
          episodeListInput.value,
          episodeListItemRegexInput?.value || '',
        );
        if (numbers.length > 0) {
          const min = numbers[0];
          const max = numbers[numbers.length - 1];
          const offsetHint = min > 1 ? ` · offset ${min - 1}` : '';
          finalEpisodeList = `${numbers.length} episodes (${min}–${max})${offsetHint}`;
        }
      }

      setPreviewRow(previewTitleRow, previewTitleValue, finalTitle);
      setPreviewRow(previewEpisodeRow, previewEpisodeValue, finalEpisode);
      setPreviewRow(previewReleaseDateRow, previewReleaseDateValue, finalReleaseDate);
      setPreviewRow(previewEpisodeListRow, previewEpisodeListValue, finalEpisodeList);

      (['mount', 'anchor', 'title', 'episode', 'releaseDate', 'episodeList'] as const).forEach((f) =>
        updateStatusPill(f)
      );
    };

    updateResetButtonVisibility();
    runExtractionPreview();

    const escapeRegExpLiteral = (value: string): string =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build an episode regex from a selection within a source string.
    // Prefers capturing a digit run within the selection using its literal surrounding context.
    const buildEpisodeRegexFromSelection = (fullText: string, start: number, end: number): string | null => {
      if (start < 0 || end <= start || end > fullText.length) return null;
      const selected = fullText.slice(start, end);
      if (!selected.trim()) return null;
      const digitMatch = /\d+/.exec(selected);
      if (!digitMatch) return null;
      const localDigitStart = digitMatch.index;
      const localDigitEnd = localDigitStart + digitMatch[0].length;
      const prefix = escapeRegExpLiteral(selected.slice(0, localDigitStart))
        .replace(/\\\s+/g, '\\s*')
        .replace(/ +/g, '\\s*');
      const suffix = escapeRegExpLiteral(selected.slice(localDigitEnd))
        .replace(/\\\s+/g, '\\s*')
        .replace(/ +/g, '\\s*');
      return `${prefix}(\\d+)${suffix}`;
    };

    // Build a title regex by treating the selection as the capture region and using
    // the surrounding full text (with digit runs generalized to \d+) as literal context.
    const buildTitleRegexFromSelection = (fullText: string, start: number, end: number): string | null => {
      if (start < 0 || end <= start || end > fullText.length) return null;
      const selectedTrimmed = fullText.slice(start, end).trim();
      if (!selectedTrimmed) return null;

      const normalize = (value: string): string =>
        escapeRegExpLiteral(value)
          .replace(/\\\s+/g, '\\s*')
          .replace(/ +/g, '\\s*')
          .replace(/\d+/g, '\\d+');

      const before = fullText.slice(0, start);
      const after = fullText.slice(end);
      const prefix = normalize(before);
      const suffix = normalize(after);
      const startAnchor = before.trim().length === 0 ? '^' : '';
      const endAnchor = after.trim().length === 0 ? '$' : '';
      return `${startAnchor}${prefix}(.+?)${suffix}${endAnchor}`;
    };

    type RegexField = 'title' | 'episode' | 'releaseDate' | 'episodeList';

    const getSourceTextForField = (field: RegexField): string => {
      const input =
        field === 'title' ? titleInput
        : field === 'episode' ? episodeInput
        : field === 'releaseDate' ? releaseDateInput
        : episodeListInput;
      if (!input) return '';
      const el = safeQuerySelector(input.value);
      if (!el) return '';
      // For the episode-list container, show the text of the first
      // representative item rather than the whole container — it's what the
      // user wants to write a per-item regex against.
      if (field === 'episodeList') {
        const firstItem = el.querySelector('a, li, button, span, div, p');
        const text = ((firstItem || el) as HTMLElement).innerText || (firstItem || el).textContent || '';
        return sanitizePreviewText(text.trim(), 200);
      }
      const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
      return sanitizePreviewText(text, 500);
    };

    const getPopoverEls = (field: RegexField) => ({
      popover: shadow.querySelector(`.regex-popover[data-regex-popover="${field}"]`) as HTMLElement | null,
      sourceEl: shadow.querySelector(`[data-regex-source="${field}"]`) as HTMLElement | null,
      previewEl: shadow.querySelector(`[data-regex-preview="${field}"]`) as HTMLElement | null,
      toggleBtn:
        field === 'title' ? titleRegexToggleBtn
        : field === 'episode' ? episodeRegexToggleBtn
        : field === 'releaseDate' ? releaseDateRegexToggleBtn
        : episodeListRegexToggleBtn,
      regexInput:
        field === 'title' ? titleRegexInput
        : field === 'episode' ? episodeRegexInput
        : field === 'releaseDate' ? releaseDateRegexInput
        : episodeListItemRegexInput,
    });

    const closeRegexPopover = (field: RegexField) => {
      const { popover, previewEl, toggleBtn } = getPopoverEls(field);
      popover?.classList.remove('is-open');
      if (previewEl) previewEl.textContent = '';
      toggleBtn?.classList.remove('is-active');
    };

    const openRegexPopover = (field: RegexField) => {
      const { popover, sourceEl, previewEl, toggleBtn } = getPopoverEls(field);
      if (!popover || !sourceEl) return;

      // Close any other popovers if open.
      (['title', 'episode', 'releaseDate', 'episodeList'] as const).forEach((other) => {
        if (other !== field) closeRegexPopover(other);
      });

      const source = getSourceTextForField(field);
      if (!source) {
        const noun =
          field === 'releaseDate' ? 'release date'
          : field === 'episodeList' ? 'episode list'
          : field;
        toast.error(`Pick the ${noun} element first`);
        return;
      }
      sourceEl.textContent = source;
      popover.classList.add('is-open');
      toggleBtn?.classList.add('is-active');
      if (previewEl) {
        previewEl.textContent =
          field === 'episode' ? 'Highlight the episode number, then Apply.'
          : field === 'releaseDate' ? 'Highlight the date portion, then Apply.'
          : field === 'episodeList' ? 'Highlight just the episode number in this item, then Apply.'
          : 'Highlight the title portion, then Apply.';
      }
    };

    const applyRegexFromPopover = (field: RegexField) => {
      const { sourceEl, previewEl, regexInput } = getPopoverEls(field);
      if (!sourceEl || !regexInput) return;
      const fullText = sourceEl.textContent || '';

      const shadowRoot = sourceEl.getRootNode() as ShadowRoot;
      let selectedText = '';
      let startOffset = -1;
      let endOffset = -1;

      try {
        const sel = (shadowRoot as any).getSelection ? (shadowRoot as any).getSelection() : window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          if (sourceEl.contains(range.startContainer) && sourceEl.contains(range.endContainer)) {
            selectedText = range.toString();
            const preRange = document.createRange();
            preRange.selectNodeContents(sourceEl);
            preRange.setEnd(range.startContainer, range.startOffset);
            startOffset = preRange.toString().length;
            endOffset = startOffset + selectedText.length;
          }
        }
      } catch (err) {
        log.warn('Selection read failed', err);
      }

      if (startOffset < 0 || !selectedText.trim()) {
        if (field === 'episode' || field === 'episodeList') {
          const digitOnly = /\d+/.exec(fullText);
          if (!digitOnly) {
            toast.error('Highlight the episode number first');
            return;
          }
          regexInput.value = '(\\d+)';
          if (previewEl) previewEl.textContent = `Preview: ${digitOnly[0]}`;
          closeRegexPopover(field);
          runExtractionPreview();
          toast.success(field === 'episodeList' ? 'List item extractor set' : 'Episode extractor set');
          return;
        }
        toast.error(field === 'releaseDate' ? 'Highlight the date first' : 'Highlight the title first');
        return;
      }

      const built = (field === 'episode' || field === 'episodeList')
        ? buildEpisodeRegexFromSelection(fullText, startOffset, endOffset)
        : buildTitleRegexFromSelection(fullText, startOffset, endOffset);

      if (!built) {
        toast.error((field === 'episode' || field === 'episodeList') ? 'Selection must contain a number' : 'Invalid selection');
        return;
      }

      regexInput.value = built;
      try {
        const re = new RegExp(built, 'i');
        const m = re.exec(fullText);
        if (previewEl) {
          previewEl.textContent = m ? `Preview: ${(m[1] ?? m[0]).trim()}` : 'No match on sample text';
        }
      } catch {}
      closeRegexPopover(field);
      runExtractionPreview();
      toast.success(
        field === 'episode' ? 'Episode extractor built'
        : field === 'episodeList' ? 'List item extractor built'
        : field === 'releaseDate' ? 'Release date extractor built'
        : 'Title extractor built'
      );
    };

    titleRegexToggleBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const popover = shadow.querySelector('.regex-popover[data-regex-popover="title"]') as HTMLElement | null;
      if (popover?.classList.contains('is-open')) {
        closeRegexPopover('title');
      } else {
        openRegexPopover('title');
      }
    });

    releaseDateRegexToggleBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const popover = shadow.querySelector('.regex-popover[data-regex-popover="releaseDate"]') as HTMLElement | null;
      if (popover?.classList.contains('is-open')) {
        closeRegexPopover('releaseDate');
      } else {
        openRegexPopover('releaseDate');
      }
    });

    episodeListRegexToggleBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const popover = shadow.querySelector('.regex-popover[data-regex-popover="episodeList"]') as HTMLElement | null;
      if (popover?.classList.contains('is-open')) {
        closeRegexPopover('episodeList');
      } else {
        openRegexPopover('episodeList');
      }
    });

    episodeRegexToggleBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const popover = shadow.querySelector('.regex-popover[data-regex-popover="episode"]') as HTMLElement | null;
      if (popover?.classList.contains('is-open')) {
        closeRegexPopover('episode');
      } else {
        openRegexPopover('episode');
      }
    });

    // Inline pencil toggles on Mount / Anchor rows. Reveal the raw CSS
    // selector input for just that row so the user can refine or paste a
    // selector directly.
    const mountRawToggleBtn = shadow.getElementById('mountRawToggle') as HTMLButtonElement | null;
    mountRawToggleBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const rawRow = shadow.querySelector('.raw-selector-row[data-raw-for="mount"]') as HTMLElement | null;
      if (!rawRow) return;
      const isOpen = rawRow.classList.toggle('is-open');
      mountRawToggleBtn.classList.toggle('is-active', isOpen);
      if (isOpen) {
        const input = rawRow.querySelector('input') as HTMLInputElement | null;
        input?.focus();
      }
    });

    const anchorRawToggleBtn = shadow.getElementById('anchorRawToggle') as HTMLButtonElement | null;
    anchorRawToggleBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      const rawRow = shadow.querySelector('.raw-selector-row[data-raw-for="anchor"]') as HTMLElement | null;
      if (!rawRow) return;
      const isOpen = rawRow.classList.toggle('is-open');
      anchorRawToggleBtn.classList.toggle('is-active', isOpen);
      if (isOpen) {
        const input = rawRow.querySelector('input') as HTMLInputElement | null;
        input?.focus();
      }
    });

    shadow.querySelectorAll<HTMLButtonElement>('[data-regex-apply]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const field = btn.getAttribute('data-regex-apply') as RegexField | null;
        if (field) applyRegexFromPopover(field);
      });
    });

    shadow.querySelectorAll<HTMLButtonElement>('[data-regex-clear]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const field = btn.getAttribute('data-regex-clear') as RegexField | null;
        if (!field) return;
        const { regexInput, previewEl } = getPopoverEls(field);
        if (regexInput) regexInput.value = '';
        if (previewEl) previewEl.textContent = 'Cleared.';
        runExtractionPreview();
      });
    });

    [titleInput, episodeInput, mountInput, anchorInput, releaseDateInput, episodeListInput].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => runExtractionPreview());
      input.addEventListener('change', () => runExtractionPreview());
    });

    [titleRegexInput, episodeRegexInput, releaseDateRegexInput, episodeListItemRegexInput].forEach((input) => {
      if (!input) return;
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
        if (titleRegexInput) titleRegexInput.value = '';
        if (releaseDateInput) releaseDateInput.value = '';
        if (releaseDateRegexInput) releaseDateRegexInput.value = '';
        if (episodeListInput) episodeListInput.value = '';
        if (episodeListItemRegexInput) episodeListItemRegexInput.value = '';
        if (paddingInput) paddingInput.value = '';
        if (iconDisplayTextInput) iconDisplayTextInput.value = 'Hayami';
        (mountInput as any)._hayamiXPath = '';
        (anchorInput as any)._hayamiXPath = '';
        (titleInput as any)._hayamiXPath = '';
        (episodeInput as any)._hayamiXPath = '';
        if (releaseDateInput) (releaseDateInput as any)._hayamiXPath = '';
        if (episodeListInput) (episodeListInput as any)._hayamiXPath = '';
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
        log.warn('Failed to reset overrides', e);
        toast.error('Failed to reset overrides');
      }
    });

    function cleanupPickers() {
      document.body.classList.remove('hayami-picking');
      if (clickShield) {
        clickShield.removeEventListener('mousemove', handleHover, true);
        clickShield.removeEventListener('click', handlePick, true);
        clickShield.removeEventListener('keydown', handlePickerKeydown, true);
      }
      document.removeEventListener('mousemove', handleHover, true);
      document.removeEventListener('keydown', handlePickerKeydown, true);
      window.removeEventListener('keydown', handlePickerKeydown, true);
      shadow.removeEventListener('keydown', handlePickerKeydown as any, true);
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
        clickShield.tabIndex = 0;
        clickShield.style.outline = 'none';
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
      // Programmatic .value assignment doesn't fire 'input'/'change' events,
      // so refresh the extraction preview and status pills manually.
      runExtractionPreview();
    }

    shadow.querySelectorAll('.pick-btn[data-target]').forEach((btn) => {
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
        shield.addEventListener('keydown', handlePickerKeydown, true);
        document.addEventListener('mousemove', handleHover, true);
        document.addEventListener('keydown', handlePickerKeydown, true);
        window.addEventListener('keydown', handlePickerKeydown, true);
        shadow.addEventListener('keydown', handlePickerKeydown as any, true);
        document.addEventListener('click', handlePick, true);
        // Move keyboard focus to the shield so Escape isn't swallowed by the
        // host page (e.g. video players that capture keyboard events).
        try { shield.focus({ preventScroll: true } as FocusOptions); } catch {}
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
        titleRegex: (titleRegexInput?.value || '').trim() || undefined,
        releaseDateSelector: (releaseDateInput?.value || '').trim() || undefined,
        releaseDateRegex: (releaseDateRegexInput?.value || '').trim() || undefined,
        episodeListSelector: (episodeListInput?.value || '').trim() || undefined,
        episodeListItemRegex: (episodeListItemRegexInput?.value || '').trim() || undefined,
        sidePadding,
        anchorXPath: (anchorInput as any)._hayamiXPath || currentMapping?.anchorXPath || '',
        mountXPath: (mountInput as any)._hayamiXPath || currentMapping?.mountXPath || '',
        titleXPath: (titleInput as any)._hayamiXPath || currentMapping?.titleXPath || '',
        episodeXPath: (episodeInput as any)._hayamiXPath || currentMapping?.episodeXPath || '',
        releaseDateXPath: (releaseDateInput as any)?._hayamiXPath || currentMapping?.releaseDateXPath || '',
        episodeListXPath: (episodeListInput as any)?._hayamiXPath || currentMapping?.episodeListXPath || '',
      };

      try {
        const map = (await customSiteMappingsItem.getValue()) || {};
        map[location.origin] = mapping;
        await customSiteMappingsItem.setValue(map);
        currentMapping = mapping;
        setCustomSiteMapping(mapping);
        toast.success('Site mapping saved');
        overlay.remove();
        // Hot-apply: any previous bootstrap attempt may have set lastProcessedKey
        // to this episode (with an empty or stale mapping), which would cause
        // queueHandleWatchPage to skip. Unmount any existing UI and clear the
        // key so the re-run actually mounts the discussion panel.
        try { getUiManager().unmount(); } catch {}
        setLastProcessedKey(null);
        // On unsupported sites the feature may not have been initialized yet
        // (no watch URL, no prior mapping, no site match). Initialize now so
        // that the content-script context, keep-alive, and other infrastructure
        // are available when queueHandleWatchPage mounts the discussion UI.
        if (ensureFeatureInitialized) ensureFeatureInitialized();
        queueHandleWatchPage(ctx);
      } catch (e) {
        log.warn('Failed to save mapping', e);
        toast.error('Failed to save mapping');
      }
    });
  });
}
