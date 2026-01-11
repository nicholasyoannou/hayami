// Shared markdown rendering utilities extracted from content.ts

import * as Snudown from '@/lib/snudown';

export function escapeHtml(s: string) {
  return s.replace(/[&<>\"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch] as string));
}

export function markdownToHtml(text: string): string {
  const DEBUG = ((): boolean => {
    try {
      if ((globalThis as any).RI_DEBUG_MARKDOWN === true) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('RI_DEBUG_MARKDOWN') === '1') return true;
    } catch {}
    return false;
  })();

  if (DEBUG) {
    try { console.groupCollapsed('[ri-markdown] render start', { length: (text||'').length }); } catch {}
    try { console.debug('[ri-markdown] original', text); } catch {}
  }
  
  // Normalize + unescape common entities Reddit leaves in body
  let src = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Remove Reddit emote syntax (e.g., [](#dekuhype)) - these don't appear in actual comment body
  src = src.replace(/\[\]\(#[a-zA-Z0-9_-]+\)/g, '');

  // Strip any remaining HTML tags (Reddit sometimes leaves <strong>, <em>, etc. in body_html)
  // BUT preserve spoiler syntax >!...!< by temporarily replacing it
  // The issue: HTML tag stripping regex /<[^>]+>/g matches <! which breaks !< spoiler syntax
  const SPOILER_START = '___RI_SPOILER_START_MARKER___';
  const SPOILER_END = '___RI_SPOILER_END_MARKER___';
  // Replace spoiler markers with temporary placeholders
  src = src.replace(/>!/g, SPOILER_START);
  src = src.replace(/!</g, SPOILER_END);
  // Now strip HTML tags safely
  src = src.replace(/<[^>]+>/g, '');
  // Restore spoiler markers
  src = src.replace(new RegExp(SPOILER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '>!');
  src = src.replace(new RegExp(SPOILER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '!<');

  // Use snudown-js to convert Reddit markdown to HTML
  let html = Snudown.markdown(src);
  
  if (DEBUG) { try { console.debug('[ri-markdown] after snudown-js', html); } catch {} }
  
  // Post-process spoilers: Ensure all spoiler spans have md-spoiler-text class
  // Snudown-js should output spoilers correctly, we just need to ensure they have the right class
  // Only map existing spoiler classes - don't try to detect spoilers by content
  html = html.replace(/<span([^>]*class=["']([^"']*)["'][^>]*)>/gi, (match: string, attrs: string, classes: string) => {
    // Check if this span has any spoiler-related class but not md-spoiler-text
    if (/(?:^|\s)(?:md-)?spoiler/i.test(classes) && !/md-spoiler-text/i.test(classes)) {
      return match.replace(/class=["']([^"']*)["']/, `class="$1 md-spoiler-text"`);
    }
    return match;
  });
  
  // Ensure spacing before spoiler elements: add a space if a spoiler span appears directly after text
  // This handles cases like "[text]>!spoiler!<" where snudown-js doesn't add a space
  html = html.replace(/([^\s>])(<span[^>]*class=["'][^"']*md-spoiler-text[^"']*["'][^>]*>)/gi, (match: string, before: string, spoiler: string) => {
    // Only add space if the character before is not whitespace and not a tag closing bracket
    // This ensures we don't add spaces where they shouldn't be (e.g., inside tags)
    return before + ' ' + spoiler;
  });

  // Post-process links to make relative URLs absolute and add target/rel attributes
  // Process all anchor tags that don't already have target="_blank"
  html = html.replace(/<a\s+([^>]*href=["']([^"']+)["'][^>]*)>/gi, (match: string, attrs: string, url: string) => {
    // Skip if already has target attribute
    if (/target=/i.test(attrs)) return match;
    
    // Make relative URLs absolute
    const href = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://www.reddit.com${url.startsWith('/') ? url : '/' + url}`;
    
    // Add target and rel attributes
    return `<a ${attrs.replace(/href=["'][^"']+["']/, `href="${href}"`)} target="_blank" rel="noopener noreferrer">`;
  });

  // Post-process images to proxy imgur through DuckDuckGo to avoid CORS issues (UK only)
  // Check sessionStorage cache (set by detectUserInUK in imgur.ts)
  // Note: We check the cache synchronously here since markdownToHtml must be synchronous
  const isUK = ((): boolean => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const cached = sessionStorage.getItem('ri-geo-uk');
        return cached === 'true';
      }
      return false;
    } catch {
      return false;
    }
  })();
  
  html = html.replace(/<img\s+([^>]*src=["']([^"']+)["'][^>]*)>/gi, (match: string, attrs: string, url: string) => {
    // Proxy i.imgur.com images through DuckDuckGo only for UK users
    if (isUK && /^https?:\/\/i\.imgur\.com\//i.test(url)) {
      const proxiedUrl = `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
      return `<img ${attrs.replace(/src=["'][^"']+["']/, `src="${proxiedUrl}"`)} loading="lazy" />`;
    }
    // Add loading="lazy" if not present
    if (!/loading=/i.test(attrs)) {
      return `<img ${attrs} loading="lazy" />`;
    }
    return match;
  });
  
  
  // Handle old Reddit spoiler syntax: [label](/s "spoiler text")
  // Expected behavior: show label as normal text (NOT hidden), provide spoiler text only as a tooltip.
  html = html.replace(/\[([^\]]*?)\]\(\/s\s+(?:"|'|&quot;|")([\s\S]*?)(?:"|'|&quot;|")\)/g,
    (_m: string, label: string, body: string) => `<span class="ri-spoiler-ref" title="${escapeHtml(body)}">${escapeHtml(label)}</span>`);

  if (DEBUG) {
    try { console.debug('[ri-markdown] final html', html); } catch {}
    try { console.groupEnd(); } catch {}
  }

  return html;
}
