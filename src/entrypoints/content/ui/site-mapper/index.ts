// Export types
export type { DisplayPlacement, CustomSiteMapping } from './types';
export { CUSTOM_SITE_MAPPINGS_KEY } from './types';

// Export utility functions
export {
  getCustomSiteMapping,
  setCustomSiteMapping,
  applySidePadding,
  loadCustomMappingForOrigin,
  getCustomMountAnchor,
  getCustomAnimeInfo,
  getElementCssSelector,
  getAbsoluteXPathNoId,
  ensurePermissionForCurrentSite,
  ensureLaunchButton,
} from './site-mapper-utils';

// Export main overlay functions
export {
  setupSiteMapperHotkey,
  openSiteMapperOverlay,
} from './site-mapper-overlay';
