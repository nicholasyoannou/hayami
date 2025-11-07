// Shared markdown rendering utilities extracted from content.ts

export function escapeHtml(s: string) {
  return s.replace(/[&<>\"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch] as string));
}

export function markdownToHtml(text: string): string {
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

  // Escape raw HTML first so user content cannot break out
  let html = escapeHtml(src);

  // Spoilers (old reddit syntax [text](/s "title") and >!spoiler!< style)
  html = html.replace(/\[([^\]]*)\]\(\/s\s+"([^"]+)"\)/g, '<span class="ri-spoiler" title="$2">$1<\/span>');
  html = html.replace(/&gt;!([\s\S]*?)!&lt;/g, '<span class="ri-spoiler">$1<\/span>');

  // Inline formatting (code first to avoid conflicts, then bold, italics, strike, links)
  html = html.replace(/`([^`]+)`/g, '<code>$1<\/code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1<\/strong>');
  // Allow *italic* and _italic_ without requiring trailing space; avoid matching * inside words
  html = html.replace(/(^|[\s>])\*([^*][\s\S]*?)\*(?=\s|$)/g, '$1<em>$2<\/em>');
  html = html.replace(/(^|[\s>])_([^_][\s\S]*?)_(?=\s|$)/g, '$1<em>$2<\/em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1<\/del>');
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');

  // Headings: permit optional space after #'s and ignore empty titles; trim trailing spaces
  // Matches lines like '#Title', '##  Title  ' etc. within first 3 leading spaces
  html = html.replace(/^\s{0,3}(#{1,6})\s*(\S.*)?$/gm, (_m, hashes: string, title: string) => {
    if (!title) return _m; // leave line unchanged if no actual title text
    const level = Math.min(6, Math.max(1, hashes.length));
    return `<h${level}>${escapeHtml(title.trim())}<\/h${level}>`;
  });

  // Blockquotes (Reddit accepts '>' with optional leading spaces)
  html = html.replace(/^\s{0,3}(?:&gt;|>)\s?(.*)$/gm, (_m, body: string) => `<blockquote>${body}<\/blockquote>`);

  // Paragraph + line-break handling:
  // 1. Split into paragraphs on 2+ consecutive newlines.
  // 2. Inside a paragraph: a line ending with two spaces => hard break (<br/>); single newline collapses to a space.
  const paragraphs = html.split(/\n{2,}/g).map(p => {
    // Hard breaks (two trailing spaces before newline) -> convert first so we don't lose markers
    let part = p.replace(/ {2}\n/g, '<br\/>');
    // Any remaining single newlines become spaces (avoid merging inside HTML tags)
    part = part.replace(/([^>])\n([^<])/g, '$1 $2');
    return `<p>${part.trim()}<\/p>`;
  });
  html = paragraphs.join('');

  return html;
}
