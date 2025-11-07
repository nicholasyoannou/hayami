// Shared markdown rendering utilities extracted from content.ts

export function escapeHtml(s: string) {
  return s.replace(/[&<>\"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch] as string));
}

export function markdownToHtml(text: string): string {
  let cleaned = (text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  let html = escapeHtml(cleaned);
  html = html.replace(/\[([^\]]*)\]\(\/s\s+"([^"]+)"\)/g, '<span class="ri-spoiler" title="$2">$1<\/span>');
  html = html.replace(/&gt;!([\s\S]*?)!&lt;/g, '<span class="ri-spoiler">$1<\/span>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1<\/strong>');
  html = html.replace(/(^|\s)\*([^*][\s\S]*?)\*(?=\s|$)/g, '$1<em>$2<\/em>');
  html = html.replace(/(^|\s)_([^_][\s\S]*?)_(?=\s|$)/g, '$1<em>$2<\/em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1<\/del>');
  html = html.replace(/`([^`]+)`/g, '<code>$1<\/code>');
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');
  html = html.replace(/^\s{0,3}(#{1,6})\s+(.+)$/gm, (_m, hashes: string, title: string) => {
    const level = Math.min(6, Math.max(1, hashes.length));
    return `<h${level}>${title.trim()}<\/h${level}>`;
  });
  html = html.replace(/^(&gt;|>)\s?(.*)$/gm, (_m, _gt: string, body: string) => `<blockquote>${body}<\/blockquote>`);
  html = html.replace(/\\n/g, '<br\/>');
  html = html.replace(/  \n/g, '<br\/>');
  html = html.replace(/\n\n+/g, '<\/p><p>');
  html = `<p>${html}<\/p>`;
  html = html.replace(/([^>])\n([^<])/g, '$1 $2');
  return html;
}
