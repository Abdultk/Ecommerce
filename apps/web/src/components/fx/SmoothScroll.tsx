"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type Lenis from "lenis";
import "lenis/dist/lenis.css";

const REDUCED = "(prefers-reduced-motion: reduce)";

// Lenis and GSAP are ~45 KB gzipped and this component sits in the root layout, so they load
// after first paint (and not at all for reduced motion) instead of counting against every
// route's first-load JS.
const loadMotion = () =>
  Promise.all([import("lenis"), import("gsap"), import("gsap/ScrollTrigger")]).then(
    ([lenisModule, gsapModule, triggerModule]) => {
      gsapModule.gsap.registerPlugin(triggerModule.ScrollTrigger);
      return {
        Lenis: lenisModule.default,
        gsap: gsapModule.gsap,
        ScrollTrigger: triggerModule.ScrollTrigger,
      };
    },
  );
type Motion = Awaited<ReturnType<typeof loadMotion>>;

let loaded: Motion | null = null;

/**
 * Smooth wheel scrolling (Lenis) driven by GSAP's ticker so ScrollTrigger stays in step.
 * Off for people who ask for reduced motion, and touch scrolling stays native. Dialogs and
 * anything marked data-lenis-prevent keep their own scrolling, and the page behind the open
 * cart drawer is frozen (the drawer locks body overflow).
 */
export function SmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    const query = window.matchMedia(REDUCED);
    let cancelled = false;
    let lenis: Lenis | null = null;
    let tick: ((time: number) => void) | null = null;
    let lockWatcher: MutationObserver | null = null;

    const stop = () => {
      if (tick) loaded?.gsap.ticker.remove(tick);
      lockWatcher?.disconnect();
      lenis?.destroy();
      lenis = null;
      tick = null;
      lockWatcher = null;
    };

    const start = async () => {
      if (lenis) return;
      const motion = (loaded ??= await loadMotion());
      // The page may have unmounted, or asked for reduced motion, while the chunks loaded.
      if (cancelled || query.matches || lenis) return;
      const instance = new motion.Lenis({
        autoRaf: false,
        lerp: 0.11,
        smoothWheel: true,
        syncTouch: false,
        anchors: true,
        prevent: (node) => Boolean(node.closest("dialog, [role='dialog'], [data-lenis-prevent]")),
      });
      lenis = instance;
      instance.on("scroll", motion.ScrollTrigger.update);
      tick = (time) => instance.raf(time * 1000);
      motion.gsap.ticker.add(tick);
      motion.gsap.ticker.lagSmoothing(0);
      lockWatcher = new MutationObserver(() => {
        if (document.body.style.overflow === "hidden") instance.stop();
        else instance.start();
      });
      lockWatcher.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    };

    const sync = () => {
      if (query.matches) stop();
      else void start();
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      cancelled = true;
      query.removeEventListener("change", sync);
      stop();
    };
  }, []);

  // New page, new heights: let ScrollTrigger measure again.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => loaded?.ScrollTrigger.refresh());
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
