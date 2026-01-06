/**
 * Comments module barrel export
 */

export { renderFlair } from './flair';
export { renderActions, triggerScoreAnimation, ACTION_ICONS, type ActionBarOptions } from './actions';
export {
  applyRawBulletListFallback,
  applyDomParagraphListFallback,
  autolinkTextNodes,
} from './markdown-fallbacks';
