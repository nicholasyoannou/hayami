/**
 * URL autolinking utilities for comment text
 */

/**
 * DOM autolink: convert bare URLs in text nodes into anchors so hover previews work inside lists
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
    }
  } as any);
  
  const toReplace: Text[] = [];
  while (walker.nextNode()) {
    toReplace.push(walker.currentNode as Text);
  }
  
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
    
    if (matches.filter(x => x.isUrl).length === 0) continue;
    
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
