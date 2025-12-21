// Shared markdown rendering utilities extracted from content.ts

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

  // Escape raw HTML first so user content cannot break out
  let html = escapeHtml(src);
  if (DEBUG) { try { console.debug('[ri-markdown] after normalize+escape', html); } catch {} }

  // Spoilers
  // Old reddit label + spoiler hover syntax: [label](/s "spoiler text")
  // Expected behavior: show label as normal text (NOT hidden), provide spoiler text only as a tooltip.
  // We render a lightweight span without hiding text so we don't create fake spoiler blocks.
  html = html.replace(/\[([^\]]*?)\]\(\/s\s+(?:"|'|&quot;|“)([\s\S]*?)(?:"|'|&quot;|”)\)/g,
    (_m, label: string, body: string) => `<span class=\"ri-spoiler-ref\" title=\"${body}\">${label}<\/span>`);
  // New reddit syntax: >!spoiler!< — clickable to reveal
  html = html.replace(/&gt;!([\s\S]*?)!&lt;/g, '<span class="ri-spoiler">$1<\/span>');

  // Horizontal rules: ---, --, or *** on a line by itself (with optional leading spaces)
  // Process BEFORE list parsing to avoid treating -- as a list item
  // Mark them with a special placeholder that we'll process after paragraph splitting
  html = html.replace(/^\s{0,3}(?:---|--|\*\*\*)\s*$/gm, '\n\n<HR_PLACEHOLDER>\n\n');

  // Inline formatting (moved below list parsing to avoid treating list markers '*' as italics)
  // We'll run these after building lists so bullets aren't consumed by the italic regex.

  // Basic list support (unordered + ordered):
  // - unordered: lines starting with *, -, or • (with optional space after marker)
  // - ordered: lines starting with 1. / 1) etc.
  // Process BEFORE paragraph wrapping so we can emit proper <ul>/<ol><li> blocks.
  const listLines = html.split('\n');
  const processedLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let sawBulletLike = false;
  for (const line of listLines) {
    // Allow up to 3 leading spaces before a bullet/number marker.
    // Capture either a bullet symbol or a number+dot/paren, and allow optional spaces after.
    const m = line.match(/^\s{0,3}(?:([*\-•])|(\d+)[\.)])\s*(.*)$/);
    if (m) {
      sawBulletLike = true;
      const isOrdered = !!m[2];
      const currentType: 'ul' | 'ol' = isOrdered ? 'ol' : 'ul';
      const content = (isOrdered ? m[3] : m[3] || m[1]) as string; // m[3] holds text for both branches
      // Open list (with a blank line before) or switch type if needed
      if (!inList || listType !== currentType) {
        if (inList) {
          processedLines.push('<\/'+listType+'>');
          // ensure separation after closing a list
          processedLines.push('');
        }
        // ensure separation before opening a list so paragraph splitter can isolate it
        if (processedLines.length && processedLines[processedLines.length-1] !== '') {
          processedLines.push('');
        }
        processedLines.push('<'+currentType+'>');
        inList = true;
        listType = currentType;
      }
      processedLines.push('<li>' + (content || '').trim() + '<\/li>');
    } else {
      // Loose list handling: if currently inside a list and the line is blank, keep the list open
      if (inList && /^\s*$/.test(line)) {
        // skip empty line without closing the list
        continue;
      }
      if (inList) {
        processedLines.push('<\/'+listType+'>');
        // add a blank line after list to separate from following paragraph
        processedLines.push('');
        inList = false;
        listType = null;
      }
      processedLines.push(line);
    }
  }
  if (inList) {
    processedLines.push('<\/'+listType+'>');
    processedLines.push('');
  }
  html = processedLines.join('\n');

  // Now apply inline formatting on the post-list HTML. Use patterns that do not cross newlines
  // so we don't accidentally consume across list items or paragraphs.
  html = html.replace(/`([^`]+)`/g, '<code>$1<\/code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1<\/strong>');
  // Safer italics: don't span newlines; and avoid matching at line-start (which could be a list marker)
  html = html.replace(/(^|[^\S\r\n>])\*([^*\n][^*\n]*?)\*(?=\s|$)/g, '$1<em>$2<\/em>');
  html = html.replace(/(^|[^\S\r\n>])_([^_\n][^_\n]*?)_(?=\s|$)/g, '$1<em>$2<\/em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1<\/del>');
  // Markdown links: [text](url) - supports both absolute (http/https) and relative URLs
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, url) => {
    // If it's a relative URL, make it absolute by prepending reddit.com
    const href = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://www.reddit.com${url.startsWith('/') ? url : '/' + url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}<\/a>`;
  });

  // Optional debug: log when input appears to have bullets but no <ul> got produced
  try {
    const DEBUG = (globalThis as any).RI_DEBUG_MARKDOWN === true;
    if (DEBUG && sawBulletLike && !/\<ul\>/.test(html)) {
      console.debug('[ri-markdown] bullet lines not parsed into <ul>', { text, lines: listLines });
    }
  } catch {}

  // Autolink bare URLs (that are not already part of markdown link syntax)
  // Avoid matching inside existing href attributes by requiring preceding char not '=' or '"'
  html = html.replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<\.])(?=$|\s)/g, (_m, pre: string, url: string) => {
    // Skip if already inside an anchor tag
    if (/href=/.test(_m)) return _m;
    return pre + `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}<\/a>`;
  });

  // Headings: permit optional space after #'s and ignore empty titles; trim trailing spaces
  // Matches lines like '#Title', '##  Title  ' etc. within first 3 leading spaces
  html = html.replace(/^\s{0,3}(#{1,6})\s*(\S.*)?$/gm, (_m, hashes: string, title: string) => {
    if (!title) return _m; // leave line unchanged if no actual title text
    const level = Math.min(6, Math.max(1, hashes.length));
    return `<h${level}>${title.trim()}<\/h${level}>`;
  });

  // Blockquotes (Reddit accepts '>' with optional leading spaces)
  html = html.replace(/^\s{0,3}(?:&gt;|>)\s?(.*)$/gm, (_m, body: string) => `<blockquote>${body}<\/blockquote>`);

  // Small text / Superscript: Reddit uses ^text for superscript/small text
  // Handle ^(text with spaces) for multi-word superscript first (more specific)
  html = html.replace(/\^\(([^)]+)\)/g, '<small>$1<\/small>');
  // Then handle ^text at word boundaries (single word or no spaces)
  html = html.replace(/\^([^\s^<>\n\)]+)/g, '<small>$1<\/small>');
  
  // Paragraph + line-break handling:
  // Reddit splits on single newlines to create separate paragraphs.
  // A line ending with two spaces => hard break (<br/>) within the same paragraph.
  // Process line by line, handling hard breaks (two trailing spaces) specially
  const lines = html.split(/\n/g);
  const paragraphs: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines (they create paragraph breaks)
    if (!trimmed) {
      continue;
    }
    
    // Check if previous non-empty line ended with two spaces (hard break indicator)
    // If so, merge with previous paragraph using <br/>
    if (i > 0) {
      let prevIdx = i - 1;
      while (prevIdx >= 0 && !lines[prevIdx].trim()) prevIdx--;
      if (prevIdx >= 0 && lines[prevIdx].endsWith('  ')) {
        // Previous line had hard break - merge with previous paragraph
        const lastPara = paragraphs[paragraphs.length - 1];
        if (lastPara && lastPara.startsWith('<p>') && lastPara.endsWith('</p>')) {
          // Remove </p> from end, add <br/> and current line, then add </p> back
          paragraphs[paragraphs.length - 1] = lastPara.slice(0, -4) + '<br/>' + trimmed + '</p>';
          continue;
        }
      }
    }
    
    // Handle horizontal rule placeholders
    if (trimmed === '<HR_PLACEHOLDER>') {
      paragraphs.push('<hr\/>');
      continue;
    }
    
    // Avoid wrapping block-level elements in <p>
    if (/^(<ul>|<ol>|<hr\/>)/.test(trimmed)) {
      paragraphs.push(trimmed);
      continue;
    }
    
    // If this paragraph contains a list block not at the start, split it so <ul>/<ol> stand alone
    if (/(<ul>|<ol>)/.test(trimmed) && !/^(<ul>|<ol>)/.test(trimmed)) {
      // Split on the first list block and wrap the non-list part only
      const match = trimmed.match(/\s*(.*?)(<(?:ul|ol)>[\s\S]*)/);
      if (match) {
        const before = match[1].trim();
        const listAndAfter = match[2];
        const beforeWrapped = before ? `<p>${before}<\/p>` : '';
        paragraphs.push(beforeWrapped + listAndAfter);
        continue;
      }
    }
    
    // Regular line becomes a paragraph
    paragraphs.push(`<p>${trimmed}<\/p>`);
  }
  
  html = paragraphs.join('');

  // Fallback list conversion: If we never emitted a <ul>/<ol> but we have multiple paragraphs
  // beginning with '* ' (loose list that our primary parser missed), convert them.
  // This handles cases where earlier inline formatting consumed markers or processing order changed.
  if (!/<ul>|<ol>/.test(html)) {
    const looseBlockRegex = /((?:<p>\s*\*[^<]*<\/p>\s*){2,})/g; // at least two bullet-style paragraphs
    html = html.replace(looseBlockRegex, (block) => {
      const itemRegex = /<p>\s*\*\s*([^<]*)<\/p>/g;
      const items: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = itemRegex.exec(block))) {
        items.push(m[1].trim());
      }
      if (items.length < 2) return block; // safety
      return '<ul>' + items.map(it => '<li>' + it + '<\/li>').join('') + '<\/ul>';
    });
    // Ordered list fallback: paragraphs starting with "1." "2." etc that were missed
    if (!/<ol>/.test(html)) {
      const looseOrderedRegex = /((?:<p>\s*\d+\.\s*[^<]*<\/p>\s*){2,})/g; // at least two ordered-style paragraphs
      html = html.replace(looseOrderedRegex, (block) => {
        const itemRegex = /<p>\s*(\d+)\.\s*([^<]*)<\/p>/g;
        const items: string[] = [];
        let m2: RegExpExecArray | null;
        while ((m2 = itemRegex.exec(block))) {
          // Keep only text portion; numbering handled by CSS counter
          items.push(m2[2].trim());
        }
        if (items.length < 2) return block;
        return '<ol>' + items.map(it => '<li>' + it + '<\/li>').join('') + '<\/ol>';
      });
    }
    // Secondary heuristic: anchor-only paragraphs (optionally wrapped in <em>) following a lead-in ending with ':'
    if (!/<ul>|<ol>/.test(html)) {
      // Match paragraphs that are just a link (optionally wrapped in <em>) plus optional trailing plain text.
      // No global flag to keep .test() stable.
      const anchorParaRegex = /<p>(?:<em>)?\s*<a [^>]+>[^<]+<\/a>(?:[^<]*)?(?:<\/em>)?<\/p>/;
      // Split paragraphs for scanning
      const parts = html.split(/(<p>[\s\S]*?<\/p>)/g).filter(Boolean);
      let rebuilt: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const prev = parts[i - 1] || '';
        // Detect run start: previous paragraph ends with ':' and current + following paragraphs are anchor-only
        if (/:<\/p>\s*$/.test(prev) && anchorParaRegex.test(parts[i])) {
          let j = i;
            const collected: string[] = [];
            while (j < parts.length && anchorParaRegex.test(parts[j])) {
              // Extract anchor text (inside <a>) plus any trailing parentheses text
              const aMatch = parts[j].match(/<a [^>]+>([^<]+)<\/a>([^<]*)/);
              if (aMatch) {
                collected.push((aMatch[1] + aMatch[2]).trim());
              } else {
                // Fallback: strip tags
                collected.push(parts[j].replace(/<[^>]+>/g, '').trim());
              }
              j++;
            }
            if (collected.length >= 2) {
              rebuilt.push('<ul>' + collected.map(t => '<li>' + t + '<\/li>').join('') + '<\/ul>');
              i = j - 1; // advance
              continue;
            }
        }
        rebuilt.push(parts[i]);
      }
      html = rebuilt.join('');
    }
  }

  if (DEBUG) {
    try { console.debug('[ri-markdown] final html', html); } catch {}
    try { console.groupEnd(); } catch {}
  }

  return html;
}












