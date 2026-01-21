/**
 * Color utility functions for Reddit comments
 * Used for flair text color calculation based on background luminance
 */

/**
 * Calculate relative luminance of a color (0-1, where 0 is black, 1 is white)
 * Uses WCAG formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
 * @param hexColor Hex color string (with or without #)
 * @returns Luminance value between 0 and 1
 */
export function getRelativeLuminance(hexColor: string): number {
  try {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const adjust = (c: number) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b);
  } catch {
    return 0.5; // Default to mid-luminance on error
  }
}

/**
 * Determine if light text (white) should be used based on background color luminance
 * @param bgColor Background color hex string
 * @returns True if light text should be used, false for dark text
 */
export function shouldUseLightText(bgColor: string): boolean {
  const luminance = getRelativeLuminance(bgColor);
  return luminance < 0.5; // Use light text if background is dark
}

/**
 * Get appropriate text color (light or dark) for a given background color
 * @param bgColor Background color hex string
 * @returns Hex color for text (#ffffff for light, #1c1c1c for dark)
 */
export function getContrastingTextColor(bgColor: string): string {
  return shouldUseLightText(bgColor) ? '#ffffff' : '#1c1c1c';
}
