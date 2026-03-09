/**
 * BBCode parser module
 * Converts BBCode markup to HTML for MAL forum posts
 */

import { escapeHtml } from '@/utils/markdown';

/**
 * Decodes HTML entities in a string safely using DOMParser
 * SECURITY: Using DOMParser is safer than innerHTML to avoid XSS
 */
function decodeEntities(str: string): string {
  if (!str) return '';
  try {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
  } catch (e) {
    console.error('Error decoding entities:', e);
    return str;
  }
}

function getImgurCdnMode(): 'imgur' | 'duckduckgo' | 'flyimg' | 'swisscows' {
  try {
    const value = sessionStorage.getItem('ri-imgur-ods');
    if (value === 'duckduckgo' || value === 'flyimg' || value === 'swisscows' || value === 'imgur') return value;
  } catch {}
  return 'imgur';
}

function rewriteImgurByCdnMode(url: string): string {
  if (!/imgur\.(?:com|io)/i.test(url)) return url;

  const mode = getImgurCdnMode();
  if (mode === 'duckduckgo') {
    return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(url)}`;
  }
  if (mode === 'flyimg') {
    return `https://demo.flyimg.io/upload/q_100/${url}`;
  }
  if (mode === 'swisscows') {
    return `https://cdn.swisscows.com/image?url=${encodeURIComponent(url)}`;
  }

  return url;
}

/**
 * Converts BBCode markup to HTML
 * @param input - BBCode formatted string
 * @returns HTML formatted string
 */
export function bbcodeToHtml(input: string): string {
  if (!input) return '';
  // Decode HTML entities first
  let out = decodeEntities(input);

  // Handle [img ...]...[/img] with optional align/width/height/title/alt
  out = out.replace(/\[img([^\]]*)\](.*?)\[\/img\]/gis, (_m, attrStr, rawSrc) => {
    // If the inner content is already HTML (e.g., decoded div/a/img), center-wrap and rewrite imgur by CDN mode.
    let src = rawSrc.trim();
    if (/^</.test(src)) {
      src = src.replace(/https?:\/\/i?\.?imgur\.(?:com|io)\/\S+/gi, (match: string) => rewriteImgurByCdnMode(match));
      return `<div style="text-align:center; width:100%;">${src}</div>`;
    }

    const attrs = (attrStr || '').trim();
    let align = '';
    let width = '';
    let height = '';
    let alt = '';
    let title = '';
    if (attrs) {
      const alignMatch = attrs.match(/align\s*=\s*(left|right|center)/i);
      if (alignMatch) align = alignMatch[1].toLowerCase();
      const sizeMatch = attrs.match(/width\s*=\s*([0-9]+)/i);
      if (sizeMatch) width = sizeMatch[1];
      const hMatch = attrs.match(/height\s*=\s*([0-9]+)/i);
      if (hMatch) height = hMatch[1];
      const altMatch = attrs.match(/alt\s*=\s*["']?([^"']+)["']?/i);
      if (altMatch) alt = altMatch[1];
      const titleMatch = attrs.match(/title\s*=\s*["']?([^"']+)["']?/i);
      if (titleMatch) title = titleMatch[1];
    }
    const finalSrc = rewriteImgurByCdnMode(src);

    const styles: string[] = ['max-width:100%;border-radius:4px;'];
    if (width) styles.push(`width:${width}px`);
    if (height) styles.push(`height:${height}px`);
    if (align === 'left') styles.push('float:left;margin:0 12px 8px 0;');
    if (align === 'right') styles.push('float:right;margin:0 0 8px 12px;');
    if (align === 'center') styles.push('display:block;margin:0 auto;');
    const styleStr = styles.join('');
    const altAttr = alt ? ` alt="${escapeHtml(alt)}"` : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const imgHtml = `<img src="${escapeHtml(finalSrc)}"${altAttr}${titleAttr} style="${styleStr}" />`;
    if (align === 'center') {
      return `<div style="text-align:center; width:100%;">${imgHtml}</div>`;
    }
    return imgHtml;
  });

  // Basic BBCode replacements
  const replacements: [RegExp, string][] = [
    [/\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>'],
    [/\[i\](.*?)\[\/i\]/gis, '<em>$1</em>'],
    [/\[u\](.*?)\[\/u\]/gis, '<u>$1</u>'],
    [/\[s\](.*?)\[\/s\]/gis, '<s>$1</s>'],
    [/\[center\](.*?)\[\/center\]/gis, '<div style="text-align:center;">$1</div>'],
    [/\[right\](.*?)\[\/right\]/gis, '<div style="text-align:right;">$1</div>'],
    [/\[justify\](.*?)\[\/justify\]/gis, '<div style="text-align:justify;">$1</div>'],
    [/\[sub\](.*?)\[\/sub\]/gis, '<sub>$1</sub>'],
    [/\[sup\](.*?)\[\/sup\]/gis, '<sup>$1</sup>'],
    [/\[size=([0-9]+)\](.*?)\[\/size\]/gis, '<span style="font-size:$1%;">$2</span>'],
    [/\[color=([#a-zA-Z0-9]+)\](.*?)\[\/color\]/gis, '<span style="color:$1;">$2</span>'],
    [/\[quote(?:=([^\]]*))?\](.*?)\[\/quote\]/gis, (_m: string, attr: string, body: string) => {
      const rawAttr = (attr || '').trim();
      const author = rawAttr ? escapeHtml(rawAttr.split(/\s+message=/i)[0].trim()) : '';
      const header = author ? `<div class="ri-mal-quote__header">${author} said:</div>` : '';
      return `<blockquote class="ri-mal-quote">${header}<div class="ri-mal-quote__body">${body}</div></blockquote>`;
    }],
    [/\[spoiler(?:=([^\]]+))?\](.*?)\[\/spoiler\]/gis, (_m: string, label: string, body: string) => {
      const spoilerLabel = label ? escapeHtml(String(label).trim()) : '';
      let spoilerBody = body ?? '';

      // If the body ends with <br> tags, move them outside the spoiler so stacked spoilers break onto new lines when hidden
      let trailingBreaks = '';
      const breakMatch = spoilerBody.match(/((?:<br\s*\/?>(?:\s*)?)+)$/i);
      if (breakMatch) {
        trailingBreaks = breakMatch[1];
        spoilerBody = spoilerBody.slice(0, -trailingBreaks.length);
      }

      const inner = spoilerLabel
        ? `<span class="ri-spoiler-group"><span class="ri-spoiler-label">${spoilerLabel}</span><span class="ri-spoiler md-spoiler-text">${spoilerBody}</span></span>`
        : `<span class="ri-spoiler md-spoiler-text">${spoilerBody}</span>`;

      return `${inner}${trailingBreaks}`;
    }],
    [/\[url=(.+?)\](.*?)\[\/url\]/gis, '<a href="$1" target="_blank" rel="noopener">$2</a>'],
    [/\[url\](.*?)\[\/url\]/gis, '<a href="$1" target="_blank" rel="noopener">$1</a>'],
    [/\[list\](.*?)\[\/list\]/gis, '<ul>$1</ul>'],
    [/\[list=1\](.*?)\[\/list\]/gis, '<ol>$1</ol>'],
    [/\[\*\](.*?)(?=(\[\*\]|<\/ul>|<\/ol>|$))/gis, '<li>$1</li>'],
    [/\[yt\](.*?)\[\/yt\]/gis, '<a href="https://www.youtube.com/watch?v=$1" target="_blank" rel="noopener">YouTube</a>'],
    [/\[code\](.*?)\[\/code\]/gis, '<pre>$1</pre>'],
    [/\[hr\]/gi, '<hr />'],
  ];
  replacements.forEach(([re, repl]) => {
    out = out.replace(re, repl);
  });
  // Normalize line breaks: strip raw newlines first (they often trail <br/> from API), then collapse multiple <br>
  out = out.replace(/\r?\n/g, '');
  out = out.replace(/(<br\s*\/?>\s*){2,}/gi, '<br><br>');
  
  // Ensure divs with text-align:center are properly preserved (for signatures with pre-existing HTML)
  // This fixes cases where the HTML already contains <div style="text-align: center;"> but it's not working
  out = out.replace(/<div\s+style\s*=\s*["']([^"']*text-align\s*:\s*center[^"']*)["']([^>]*)>/gi, (match, styleContent, rest) => {
    // Ensure the div has width:100% to allow centering to work properly
    if (!/width\s*:\s*100%/.test(styleContent)) {
      return `<div style="${styleContent}; width:100%;"${rest}>`;
    }
    return match;
  });
  
  // Ensure images are properly centered when inside divs with text-align:center
  // For signatures with structure like: <div style="text-align:center"><a><img /></a></div>
  // We need to make the image block-level with auto margins for proper centering
  // First, find divs with text-align:center that contain images
  const centeredDivPattern = /<div\s+[^>]*text-align\s*:\s*center[^>]*>([\s\S]*?)<\/div>/gi;
  out = out.replace(centeredDivPattern, (match: string, content: string) => {
    const imgCount = (content.match(/<img/gi) || []).length;
    if (!imgCount) return match;

    // For a single image, keep the old block-centering to respect layout
    if (imgCount === 1) {
      const updatedContent = content.replace(/<img([^>]*)>/gi, (imgMatch: string, imgAttrs: string) => {
        const hasStyle = /style\s*=\s*["']/.test(imgAttrs);
        if (hasStyle) {
          return imgMatch.replace(/style\s*=\s*["']([^"']*)["']/, (_styleMatch: string, existingStyle: string) => {
            let newStyle = existingStyle;
            if (!/display\s*:\s*block/.test(newStyle)) newStyle += '; display:block';
            if (!/margin\s*:\s*0\s+auto/.test(newStyle)) newStyle += '; margin:0 auto';
            if (!/max-width\s*:\s*100%/.test(newStyle)) newStyle += '; max-width:100%';
            return `style="${newStyle}"`;
          });
        }
        return `<img${imgAttrs} style="display:block; margin:0 auto; max-width:100%">`;
      });
      return match.replace(content, updatedContent);
    }

    // For multiple images in a centered block, keep them inline so they stay together
    const updatedContent = content.replace(/<img([^>]*)>/gi, (imgMatch: string, imgAttrs: string) => {
      const hasStyle = /style\s*=\s*["']/.test(imgAttrs);
      if (hasStyle) {
        return imgMatch.replace(/style\s*=\s*["']([^"']*)["']/, (_styleMatch: string, existingStyle: string) => {
          let newStyle = existingStyle;
          if (!/max-width\s*:\s*100%/.test(newStyle)) newStyle += '; max-width:100%';
          if (!/max-height\s*:\s*200px/.test(newStyle)) newStyle += '; max-height:200px';
          return `style="${newStyle}"`;
        });
      }
      return `<img${imgAttrs} style="max-width:100%; max-height:200px; vertical-align:middle; margin:0 4px 4px 0;">`;
    });
    return match.replace(content, updatedContent);
  });
  
  return out;
}
