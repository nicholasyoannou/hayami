import { storage } from '#imports';

export type DisplayMode = 'popup' | 'inline';

/**
 * Display mode preference management using WXT storage
 * Provides reactive storage with automatic type safety
 */
export const displayModeStorage = storage.defineItem<DisplayMode>(
  'local:display_mode',
  {
    fallback: 'popup',
  }
);

export function useDisplayMode() {
  const getDisplayMode = () => displayModeStorage.getValue();
  
  const setDisplayMode = (mode: DisplayMode) => displayModeStorage.setValue(mode);

  const onStorageChange = (callback: (newMode: DisplayMode) => void) => {
    return displayModeStorage.watch((newMode) => {
      callback(newMode);
    });
  };

  return {
    getDisplayMode,
    setDisplayMode,
    onStorageChange,
  };
}
