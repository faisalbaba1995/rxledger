/**
 * useResponsiveLayout — Detects phone vs tablet layout.
 *
 * Returns `isPhone` (single-column) when the shortest window
 * dimension is below 600dp, which is the standard Android
 * phone → tablet breakpoint.
 */

import { useWindowDimensions } from 'react-native';

/** Breakpoint: below this width we switch to single-column phone layout */
const PHONE_BREAKPOINT = 600;

export interface ResponsiveLayout {
  /** True when the screen is a phone-sized viewport */
  isPhone: boolean;
  /** Current window width in dp */
  width: number;
  /** Current window height in dp */
  height: number;
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();

  // Use the smaller dimension so landscape phones don't trick us
  const shortest = Math.min(width, height);
  const isPhone = shortest < PHONE_BREAKPOINT;

  return { isPhone, width, height };
}
