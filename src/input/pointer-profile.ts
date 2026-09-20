/**
 * Input and layout adapt to two *independent* signals, deliberately kept
 * apart:
 *
 *   pointer profile  — how precisely the user can aim (mouse vs finger)
 *   viewport width   — how much room the 300px rail leaves the globe
 *
 * Conflating them into one "is mobile" flag gets both wrong: a narrow
 * desktop window has the layout problem without the aiming problem, and a
 * touch laptop has the reverse.
 */

export type PointerProfile = 'fine' | 'coarse';

export interface MediaQueryMatcher {
  (query: string): { matches: boolean };
}

export function detectPointerProfile(
  matchMedia: MediaQueryMatcher | undefined,
): PointerProfile {
  // Absent during server-side rendering and in older browsers; a mouse is
  // the safer assumption because it only shrinks targets, never breaks them.
  if (!matchMedia) return 'fine';
  return matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine';
}

/**
 * Cursor tolerance for picking, in CSS pixels.
 *
 * 8 is the measured desktop value. 22 gives a 44px target, the usual
 * accessibility floor — at 8, tapping a satellite on a phone almost always
 * misses.
 */
export function pickRadiusCss(profile: PointerProfile): number {
  return profile === 'coarse' ? 22 : 8;
}

/**
 * How far the pointer may travel and still count as a click.
 *
 * Fingers wobble far more than mice. At the desktop slop of 4, ordinary
 * taps register as drags and silently do nothing.
 */
export function clickSlopCss(profile: PointerProfile): number {
  return profile === 'coarse' ? 10 : 4;
}

/**
 * Below this the rail becomes a drawer. The rail is a fixed 300px, which is
 * a third of the screen here and only grows worse as the window narrows.
 */
export const NARROW_BREAKPOINT_PX = 900;

export function isNarrow(viewportWidth: number): boolean {
  return viewportWidth < NARROW_BREAKPOINT_PX;
}
