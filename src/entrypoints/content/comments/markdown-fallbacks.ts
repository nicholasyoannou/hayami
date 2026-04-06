/**
 * Markdown fallback utilities for handling edge cases
 * when the main markdown parser doesn't produce expected output
 */

import { con } from '@/utils/logger';
const log = con.m('Markdown');

/**
 * Fallback: if raw body contains bullet markers but markdown pipeline
 * fails to emit a list, rebuild as list.
 */
export function applyRawBulletListFallback(
  original: string,
  host: HTMLElement,
  debug = false
): void {
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
    const safe = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (ch) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[ch] as string
      );

    // Build list items preserving leading URL as an anchor so hover previews still work
    const listItems = bulletLines
      .map((line) => {
        const mUrl = line.match(/^(https?:\/\/\S+)(\s+.*)?$/);
        if (mUrl) {
          const url = mUrl[1];
          const rest = mUrl[2] || '';
          // Keep display text identical to URL (avoid shortening so user sees exact link)
          return (
            '<li><a href="' +
            safe(url) +
            '">' +
            safe(url) +
            '</a>' +
            (rest ? safe(rest) : '') +
            '</li>'
          );
        }
        return '<li>' + safe(line) + '</li>';
      })
      .join('');

    const listHtml = '<ul>' + listItems + '</ul>';
    const headingHtml = heading ? '<p>' + safe(heading) + '</p>' : '';
    host.innerHTML = headingHtml + listHtml;

    if (debug) log.debug('applied raw-body bullet fallback');
  }
}

/**
 * DOM-level fallback: convert consecutive anchor-only paragraphs into a <ul>
 * while preserving anchors
 */
export function applyDomParagraphListFallback(
  host: HTMLElement,
  debug = false
): void {
  try {
    if (host.querySelector('ul, ol')) return; // already has a list somewhere

    const paras = Array.from(
      host.querySelectorAll(':scope > p')
    ) as HTMLParagraphElement[];
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
      // Accept <p> that contains an <a> as the main content
      if (!p) return false;
      const a = p.querySelector('a');
      if (!a) return false;
      return true;
    };

    const items: HTMLParagraphElement[] = [];
    for (let j = leadIdx + 1; j < paras.length; j++) {
      const pj = paras[j];
      if (isAnchorPara(pj)) items.push(pj);
      else break;
    }

    // Alternate heuristic: paragraphs whose trimmed text starts with 'http' also count.
    if (items.length < 2) {
      const altItems: HTMLParagraphElement[] = [];
      for (let j = leadIdx + 1; j < paras.length; j++) {
        const txt = (paras[j].textContent || '').trim();
        if (/^https?:\/\//i.test(txt)) altItems.push(paras[j]);
        else break;
      }
      if (altItems.length >= 2) items.splice(0, items.length, ...altItems);
    }

    if (items.length >= 2) {
      const ul = document.createElement('ul');
      ul.style.listStyle = 'disc';
      ul.style.margin = '6px 0 12px 22px';

      items.forEach((p) => {
        const li = document.createElement('li');
        // Move the contents (preserve anchors and text)
        while (p.firstChild) li.appendChild(p.firstChild);
        ul.appendChild(li);
        // Remove the now-empty paragraph
        p.remove();
      });

      // Insert ul after the lead paragraph
      const lead = paras[leadIdx];
      lead.parentElement?.insertBefore(ul, lead.nextSibling);

      if (debug) log.debug('applied DOM paragraph->list fallback');
    }
  } catch {
    // ignore errors
  }
}

/**
 * DOM autolink: convert bare URLs in text nodes into anchors
 * so hover previews work inside lists
 */
export function autolinkTextNodes(host: HTMLElement): void {
  // More permissive URL regex that allows trailing punctuation commonly found in URLs
  const urlRe = /(https?:\/\/[^\s<]+)/g;

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text) {
      const txt = node.nodeValue || '';
      if (!urlRe.test(txt)) return NodeFilter.FILTER_SKIP;
      // skip if inside an existing anchor
      const p = node.parentElement || null;
      if (p && p.closest('a')) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  } as any);

  const toReplace: Text[] = [];
  while (walker.nextNode()) toReplace.push(walker.currentNode as Text);

  for (const textNode of toReplace) {
    const txt = textNode.nodeValue || '';
    // Split but keep URLs
    const matches: Array<{ text: string; isUrl: boolean }> = [];
    let lastIdx = 0;
    urlRe.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = urlRe.exec(txt))) {
      if (m.index > lastIdx) {
        matches.push({ text: txt.substring(lastIdx, m.index), isUrl: false });
      }
      matches.push({ text: m[0], isUrl: true });
      lastIdx = m.index + m[0].length;
    }

    if (lastIdx < txt.length) {
      matches.push({ text: txt.substring(lastIdx), isUrl: false });
    }

    if (matches.filter((x) => x.isUrl).length === 0) continue;

    const frag = document.createDocumentFragment();
    for (const match of matches) {
      if (match.isUrl) {
        const a = document.createElement('a');
        a.href = match.text;
        a.textContent = match.text;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(match.text));
      }
    }

    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
