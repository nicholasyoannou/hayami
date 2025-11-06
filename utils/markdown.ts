/**
 * Markdown rendering utilities for Reddit comments
 * Implements Reddit's markdown flavor with proper line breaks
 */

/**
 * Escape HTML to prevent injection
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert Reddit markdown to HTML
 * Supports: bold, italic, strikethrough, code, links, headings, blockquotes, spoilers, line breaks
 */
export function markdownToHtml(text: string): string {
  // Escape HTML first to prevent injection
  let html = escapeHtml(text || '');
  
  // Spoilers >!text!< (note: '>' becomes &gt; after escaping)
  html = html.replace(/&gt;!([\s\S]*?)!&lt;/g, '<span class="ri-spoiler">$1</span>');
  
  // Bold **text** (greedy within line)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Italic *text* or _text_ (non-greedy, surrounded by spaces or start/end)
  html = html.replace(/(^|\s)\*([^*][\s\S]*?)\*(?=\s|$)/g, '$1<em>$2</em>');
  html = html.replace(/(^|\s)_([^_][\s\S]*?)_(?=\s|$)/g, '$1<em>$2</em>');
  
  // Strikethrough ~~text~~
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  
  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Headings: lines starting with 1-6 # (allow up to 3 leading spaces like CommonMark)
  html = html.replace(/^\s{0,3}(#{1,6})\s+(.+)$/gm, (_m, hashes: string, title: string) => {
    const level = Math.min(6, Math.max(1, hashes.length));
    return `<h${level}>${title.trim()}</h${level}>`;
  });
  
  // Blockquotes: lines starting with > (escaped to &gt;)
  html = html.replace(/^(&gt;|>)\s?(.*)$/gm, (_m, _gt: string, body: string) => `<blockquote>${body}</blockquote>`);
  
  // Reddit line breaks: two spaces + newline OR backslash + newline = <br/>
  // First handle backslash line breaks (\ followed by newline)
  html = html.replace(/\\n/g, '<br/>');
  // Then handle double-space line breaks (two spaces + newline)
  html = html.replace(/  \n/g, '<br/>');
  
  // Paragraphs: double newlines = paragraph break
  html = html.replace(/\n\n+/g, '</p><p>');
  
  // Wrap content in paragraph tags
  html = `<p>${html}</p>`;
  
  // Single newlines that aren't line breaks get converted to spaces (Reddit behavior)
  html = html.replace(/([^>])\n([^<])/g, '$1 $2');
  
  return html;
}
