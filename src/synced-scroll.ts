/** Proportional scroll position of `source` mapped onto `target`'s scrollable range. */
export function computeMirroredScrollTop(source: Element, target: Element): number {
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  const ratio = source.scrollTop / Math.max(1, sourceRange); // max(1,…) avoids /0
  return ratio * targetRange;
}

export type ScrollController = { destroy(): void };

type ScheduleFrame = (callback: () => void) => void;

/**
 * Keep two scroll containers proportionally aligned. A re-entrancy guard prevents
 * mirroring a → b from triggering b → a; it resets on the next animation frame so a
 * no-op scrollTop write (which fires no scroll event) cannot leave the guard stuck.
 */
export function linkScroll(
  a: HTMLElement,
  b: HTMLElement,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
): ScrollController {
  let locked = false;

  const mirror = (source: HTMLElement, target: HTMLElement) => (): void => {
    if (locked) return;
    locked = true;
    target.scrollTop = computeMirroredScrollTop(source, target);
    scheduleFrame(() => {
      locked = false;
    });
  };

  const onA = mirror(a, b);
  const onB = mirror(b, a);
  a.addEventListener("scroll", onA);
  b.addEventListener("scroll", onB);

  return {
    destroy(): void {
      a.removeEventListener("scroll", onA);
      b.removeEventListener("scroll", onB);
    },
  };
}
