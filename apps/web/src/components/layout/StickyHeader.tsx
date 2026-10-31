"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Sticky header that tightens once the page scrolls. A 1px sentinel at the top of the page is
 * watched with an IntersectionObserver (no scroll listener), and the result is exposed as
 * data-scrolled so the children can restyle themselves with group-data variants.
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-16 w-px"
      />
      <header
        data-scrolled={scrolled}
        className="group/header sticky top-0 z-30 [@media(max-height:480px)]:static bg-flour/95 backdrop-blur transition-shadow duration-300 data-[scrolled=true]:shadow-[0_8px_24px_-18px_rgb(36_38_34/0.5)]"
      >
        {children}
      </header>
    </>
  );
}
