'use client';
import { useEffect, useState, type RefObject } from 'react';

/**
 * True while the referenced element is on screen. Used to gate the auto-playing
 * demo animations: an offscreen demo schedules no timers and triggers no
 * re-renders, so it adds nothing to main-thread work / Total Blocking Time
 * during the initial Lighthouse load trace (below-the-fold demos stay idle
 * until the user scrolls to them).
 */
export function useInView<T extends Element>(ref: RefObject<T | null>): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  return inView;
}

/** True when the user has asked the OS to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
