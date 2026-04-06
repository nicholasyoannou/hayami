/**
 * Markdown processing and fallback utilities for comment rendering
 */

import { markdownToHtml } from '@/utils/markdown';
import { escapeHtml } from '@/utils/html-utils';
import { con } from '@/utils/logger';
const log = con.m('Markdown');

/**
 * Applies raw bullet list fallback if markdown pipeline fails to emit a list
 */
export function applyRawBulletListFallback(original: string, host: HTMLElement, debugMatch?: boolean): void {
  // Support both '*' and '-' bullets
  if (!/\n(?:\*|-)\s+/.test(original)) return; // no bullet markers
  if (/<(?:ul|ol)>/.test(host.innerHTML)) return; // already has a list
  
  const lines = original.split(/\r?\n/);
  const bulletLines: string[] = [];
  let heading: string | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(?:\*|-)\s+(.*)$/);
    if (m) {
      bulletLines.push(m[1].trim());
    } else if (!heading) {
      heading = trimmed; // first non-bullet line becomes heading
    }
  }
  
  if (bulletLines.length >= 2) {
    const safe = (s: string) => s.replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    }[ch] as string));
    
    // Build list items preserving leading URL as an anchor so hover previews still work
    const listItems = bulletLines.map(line => {
      const mUrl = line.match(/^(https?:\/\/\S+)(\s+.*)?$/);
      if (mUrl) {
        const url = mUrl[1];
        const rest = mUrl[2] || '';
        // Keep display text identical to URL (avoid shortening so user sees exact link)
        return '<li><a href="' + safe(url) + '">' + safe(url) + '</a>' + (rest ? safe(rest) : '') + '</li>';
      }
      return '<li>' + safe(line) + '</li>';
    }).join('');
    
    const listHtml = '<ul>' + listItems + '</ul>';
    const headingHtml = heading ? '<p>' + safe(heading) + '</p>' : '';
    host.innerHTML = headingHtml + listHtml;
    
    if (debugMatch) {
      log.debug('applied raw-body bullet fallback');
    }
  }
}

/**
 * DOM-level fallback: convert consecutive anchor-only paragraphs into a <ul> while preserving anchors
 */
export function applyDomParagraphListFallback(host: HTMLElement, debugMatch?: boolean): void {
  try {
    if (host.querySelector('ul, ol')) return; // already has a list somewhere
    
    const paras = Array.from(host.querySelectorAll(':scope > p')) as HTMLParagraphElement[];
    if (paras.length === 0) return;
    
    // Find a paragraph ending with ':' which likely introduces the list
    let leadIdx = -1;
    for (let i = 0; i < paras.length; i++) {
      const t = (paras[i].textContent || '').trim();
      if (t.endsWith(':')) {
        leadIdx = i;
        break;
      }
    }
    
    if (leadIdx < 0 || leadIdx >= paras.length - 1) return;
    
    const isAnchorPara = (p: HTMLParagraphElement) => {
      // Accept <p> that contains an <a> as the main content (optionally wrapped in <em>)
      if (!p) return false;
      // If paragraph has a block-level element, skip
      const a = p.querySelector('a');
      if (!a) return false;
      // Treat as list item if not a complex paragraph (no headings, no blockquote, etc.)
      return true;
    };
    
    const items: HTMLParagraphElement[] = [];
    for (let j = leadIdx + 1; j < paras.length; j++) {
      const pj = paras[j];
      if (isAnchorPara(pj)) {
        items.push(pj);
      } else {
        break;
      }
    }
    
    // Alternate heuristic: paragraphs whose trimmed text starts with 'http' also count.
    if (items.length < 2) {
      const altItems: HTMLParagraphElement[] = [];
      for (let j = leadIdx + 1; j < paras.length; j++) {
        const txt = (paras[j].textContent || '').trim();
        if (/^https?:\/\//i.test(txt)) {
          altItems.push(paras[j]);
        } else {
          break;
        }
      }
      if (altItems.length >= 2) {
        items.splice(0, items.length, ...altItems);
      }
    }
    
    if (items.length >= 2) {
      const ul = document.createElement('ul');
      ul.style.listStyle = 'disc';
      ul.style.margin = '6px 0 12px 22px';
      
      items.forEach(p => {
        const li = document.createElement('li');
        // Move the contents (preserve anchors and text)
        while (p.firstChild) {
          li.appendChild(p.firstChild);
        }
        ul.appendChild(li);
        // Remove the now-empty paragraph
        p.remove();
      });
      
      // Insert ul after the lead paragraph
      const lead = paras[leadIdx];
      lead.parentElement?.insertBefore(ul, lead.nextSibling);
      
      if (debugMatch) {
        log.debug('applied DOM paragraph->list fallback');
      }
    }
  } catch (e) {
    // Silently fail
  }
}

/**
 * Processes markdown content with fallbacks
 */
export function processMarkdownWithFallbacks(
  rawBody: string,
  textHost: HTMLElement,
  debugMatch?: boolean
): void {
  // Initial render from API text
  textHost.innerHTML = markdownToHtml(rawBody);
  
  // Apply fallbacks
  applyRawBulletListFallback(rawBody, textHost, debugMatch);
  applyDomParagraphListFallback(textHost, debugMatch);
}
