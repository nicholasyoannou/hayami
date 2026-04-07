/**
 * Reddit Comment Faces (Emotes) Support
 *
 * Old Reddit subreddits define "comment faces" via CSS sprites in their custom
 * stylesheets. In markdown, they look like `[](#hikariactually)` which renders
 * as `<a href="#hikariactually"></a>`. The subreddit CSS turns that empty anchor
 * into a sprite-based image using `[href="#name"]` selectors.
 *
 * This module fetches a subreddit's stylesheet, parses out the comment face
 * definitions (sprite URL, position, width, height), and provides a function
 * to apply them as inline styles on rendered comment HTML.
 */

import { extensionFetchTransport } from './redditTransport';
import { con } from '@/utils/logger';

const log = con.m('CommentFaces');

/** Parsed comment face definition */
interface CommentFace {
  name: string;
  spriteUrl: string;
  backgroundPosition: string;
  width: number;
  height: number;
}

/** Public type alias */
export type CommentFaceMap = Map<string, CommentFace>;

/** Cache: subreddit → Map of face name → CommentFace */
const faceCache = new Map<string, Map<string, CommentFace>>();
/** Cache: subreddit → promise (dedup concurrent fetches) */
const fetchPromises = new Map<string, Promise<Map<string, CommentFace>>>();

/**
 * Fetch and parse comment faces for a subreddit.
 * Results are cached in memory for the session.
 */
export async function getCommentFaces(subreddit: string): Promise<Map<string, CommentFace>> {
  const sub = subreddit.trim().replace(/^r\//i, '').toLowerCase();
  if (!sub) return new Map();

  const cached = faceCache.get(sub);
  if (cached) return cached;

  // Dedup concurrent requests
  const existing = fetchPromises.get(sub);
  if (existing) return existing;

  const promise = fetchAndParseStylesheet(sub);
  fetchPromises.set(sub, promise);

  try {
    const result = await promise;
    faceCache.set(sub, result);
    return result;
  } finally {
    fetchPromises.delete(sub);
  }
}

async function fetchAndParseStylesheet(subreddit: string): Promise<Map<string, CommentFace>> {
  const faces = new Map<string, CommentFace>();

  try {
    // Try fetching the stylesheet - public endpoint, no auth needed
    const url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/about/stylesheet.json`;
    const resp = await extensionFetchTransport(url, { credentials: 'omit' } as any);
    if (!resp.ok) {
      log.debug('Stylesheet fetch failed', { subreddit, status: resp.status });
      return faces;
    }

    const data = await resp.json();
    let css = data?.data?.stylesheet || '';
    if (!css) return faces;

    // Reddit's stylesheet API returns %%imagename%% placeholders in the CSS.
    // The actual URLs are provided in the `images` array. Resolve them.
    const images = (data?.data?.images || []) as Array<{ name: string; url: string; link: string }>;
    if (images.length > 0) {
      for (const img of images) {
        if (img.name && (img.url || img.link)) {
          const imageUrl = img.url || img.link;
          // Replace %%name%% with the actual URL
          css = css.replace(
            new RegExp(`%%${img.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}%%`, 'g'),
            imageUrl,
          );
        }
      }
    }

    return parseCommentFacesFromCSS(css);
  } catch (e) {
    log.debug('Failed to fetch/parse stylesheet', { subreddit, error: e });
    return faces;
  }
}

/**
 * Parse comment face definitions from a subreddit CSS string.
 *
 * We look for selectors like `.md [href="#name"]` or `.md [href="#name"i]`
 * and extract their background-image, background-position, width, height.
 *
 * Many subreddits use grouped selectors where one rule sets the base sprite
 * and dimensions for multiple faces, and individual rules set the position.
 */
function parseCommentFacesFromCSS(css: string): Map<string, CommentFace> {
  const faces = new Map<string, CommentFace>();

  // First pass: collect all rules that contain href="#..." selectors
  // We need to handle grouped selectors, e.g.:
  //   .md [href="#worshipme"i], .md [href="#hikariactually"i] { width: 144px; ... }

  // Remove CSS comments
  const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Extract rule blocks
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;

  // Track base properties (sprite URL, width, height) per face name
  const faceProps = new Map<string, {
    spriteUrl?: string;
    backgroundPosition?: string;
    width?: number;
    height?: number;
  }>();

  // Exclusion patterns: these href="#..." values are NOT comment faces
  const exclusionPattern = /^#(?:s|!|res:|gear|\/|\?|wiki_)/i;

  while ((match = ruleRegex.exec(cleanCss)) !== null) {
    const selectorBlock = match[1];
    const declarations = match[2];

    // Check if any selector in this rule targets [href="#..."]
    const hrefSelectors = [...selectorBlock.matchAll(/\[href=["']#([a-zA-Z0-9_-]+)["'](?:i)?\]/gi)];
    if (hrefSelectors.length === 0) continue;

    // Extract face names from selectors
    const faceNames = hrefSelectors
      .map(m => m[1].toLowerCase())
      .filter(name => !exclusionPattern.test('#' + name));

    if (faceNames.length === 0) continue;

    // Parse declarations
    const bgImage = extractCssValue(declarations, 'background-image')
      || extractBackgroundUrl(declarations);
    const bgPos = extractCssValue(declarations, 'background-position')
      || extractBackgroundPosition(declarations);
    const width = extractCssPx(declarations, 'width');
    const height = extractCssPx(declarations, 'height');

    // Also check shorthand 'background' property for URL
    const bgShorthand = extractBackgroundShorthandUrl(declarations);

    for (const name of faceNames) {
      const existing = faceProps.get(name) || {};

      if (bgImage) existing.spriteUrl = bgImage;
      else if (bgShorthand) existing.spriteUrl = bgShorthand;
      if (bgPos) existing.backgroundPosition = bgPos;
      if (width) existing.width = width;
      if (height) existing.height = height;

      // Also extract position from shorthand background
      const shorthandPos = extractBackgroundShorthandPosition(declarations);
      if (shorthandPos && !existing.backgroundPosition) {
        existing.backgroundPosition = shorthandPos;
      }

      faceProps.set(name, existing);
    }
  }

  // Build final face map - only include faces with at least a sprite URL and dimensions
  for (const [name, props] of faceProps) {
    if (props.spriteUrl && props.width && props.height) {
      faces.set(name, {
        name,
        spriteUrl: props.spriteUrl,
        backgroundPosition: props.backgroundPosition || '0px 0px',
        width: props.width,
        height: props.height,
      });
    }
  }

  log.debug(`Parsed ${faces.size} comment faces`);
  return faces;
}

// ── CSS value extraction helpers ──

function extractCssValue(declarations: string, property: string): string | null {
  const regex = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i');
  const m = declarations.match(regex);
  return m ? m[1].trim() : null;
}

function extractCssPx(declarations: string, property: string): number | null {
  const value = extractCssValue(declarations, property);
  if (!value) return null;
  const m = value.match(/^(\d+(?:\.\d+)?)\s*px/);
  return m ? parseFloat(m[1]) : null;
}

function extractBackgroundUrl(declarations: string): string | null {
  const m = declarations.match(/background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/i);
  return m ? normalizeUrl(m[1]) : null;
}

function extractBackgroundShorthandUrl(declarations: string): string | null {
  const m = declarations.match(/(?:^|;)\s*background\s*:\s*[^;]*url\(\s*["']?([^"')]+)["']?\s*\)/i);
  return m ? normalizeUrl(m[1]) : null;
}

function extractBackgroundPosition(declarations: string): string | null {
  const value = extractCssValue(declarations, 'background-position');
  if (!value) return null;
  return value.replace(/!important/gi, '').trim();
}

function extractBackgroundShorthandPosition(declarations: string): string | null {
  // Try to extract position from shorthand: background: url(...) <position>
  const m = declarations.match(/(?:^|;)\s*background\s*:\s*[^;]*url\([^)]+\)\s+(-?\d+[a-z%]*(?:\s+-?\d+[a-z%]*)?)/i);
  return m ? m[1].trim() : null;
}

function normalizeUrl(url: string): string {
  // Ensure protocol
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

/**
 * Process rendered comment HTML to replace empty anchor comment faces
 * with visible inline elements.
 *
 * Looks for `<a href="#name"></a>` patterns and replaces them with
 * styled `<span>` elements that display the sprite.
 */
export function applyCommentFaces(html: string, faces: Map<string, CommentFace>): string {
  if (faces.size === 0) return html;

  // Match empty anchors with fragment-only hrefs: <a href="#name"></a>
  // Also match anchors that only contain whitespace
  return html.replace(
    /<a\s+[^>]*href=["']#([a-zA-Z0-9_-]+)["'][^>]*>(\s*)<\/a>/gi,
    (fullMatch, name: string, _inner: string) => {
      const face = faces.get(name.toLowerCase());
      if (!face) return fullMatch; // Not a known face, leave as-is

      // Clamp dimensions to reasonable maximums for inline display
      const maxH = 120;
      const scale = face.height > maxH ? maxH / face.height : 1;
      const w = Math.round(face.width * scale);
      const h = Math.round(face.height * scale);

      const bgSize = scale !== 1
        ? `background-size: auto ${h}px;`
        : '';

      return `<span class="ri-comment-face" style="display:inline-block;width:${w}px;height:${h}px;background:url('${face.spriteUrl}') ${face.backgroundPosition} no-repeat;${bgSize}overflow:hidden;vertical-align:middle;" title=":${name}:" aria-label="${name} emote"></span>`;
    },
  );
}
