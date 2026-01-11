// Shared markdown rendering utilities extracted from content.ts

import * as Snudown from 'snudown-js';

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
  src = src.replace(/<[^>]+>/g, '');

  // Use snudown-js to convert Reddit markdown to HTML
  let html = Snudown.markdown(src);
  
  if (DEBUG) { try { console.debug('[ri-markdown] after snudown-js', html); } catch {} }

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
  
  // Post-process spoilers: snudown-js outputs spoilers, we need to ensure they have md-spoiler-text class
  // Reddit spoiler syntax: >!spoiler text!<
  // snudown-js typically outputs spoilers as <span> elements, we need to add the class
  // Strategy: Find all elements that are likely spoilers and ensure they have md-spoiler-text class
  
  // First, handle spoilers that already have a class containing "spoiler"
  html = html.replace(/<span([^>]*class=["']([^"']*spoiler[^"']*)["'][^>]*)>/gi, (match: string, attrs: string, classes: string) => {
    // If it has spoiler class but not md-spoiler-text, add it
    if (!classes.includes('md-spoiler-text')) {
      return match.replace(/class=["']([^"']*)["']/, `class="$1 md-spoiler-text"`);
    }
    return match;
  });
  
  // Second, look for any span elements that might be spoilers based on content
  // This handles cases where snudown-js outputs spoilers without explicit spoiler classes
  // We look for spans that contain the spoiler markers >! and !<
  html = html.replace(/(<span)([^>]*>)([^<]*>![^<]+!<[^<]*)(<\/span>)/gi, (match: string, open: string, attrs: string, content: string, close: string) => {
    // Skip if it already has md-spoiler-text class
    if (/class=["'][^"']*md-spoiler-text[^"']*["']/i.test(attrs)) {
      return match;
    }
    
    // Check if it already has a class attribute
    if (/class=/i.test(attrs)) {
      // Add md-spoiler-text to existing classes
      return open + attrs.replace(/class=["']([^"']*)["']/, `class="$1 md-spoiler-text"`) + content + close;
    } else {
      // Add class attribute
      return open + attrs.replace(/>/, ' class="md-spoiler-text">') + content + close;
    }
  });
  
  // Third, handle any remaining spoiler patterns that snudown-js might use
  // Some markdown parsers output spoilers differently, so we catch common patterns
  html = html.replace(/(<span[^>]*>)([^<]*>![^<]+!<[^<]*)(<\/span>)/gi, (match: string, open: string, content: string, close: string) => {
    // Skip if already has md-spoiler-text
    if (/md-spoiler-text/i.test(open)) {
      return match;
    }
    // Add the class if missing
    if (/class=/i.test(open)) {
      return open.replace(/class=["']([^"']*)["']/, `class="$1 md-spoiler-text"`) + content + close;
    } else {
      return open.replace(/>/, ' class="md-spoiler-text">') + content + close;
    }
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
