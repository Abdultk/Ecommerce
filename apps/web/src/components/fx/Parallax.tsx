"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type Props = {
  children: ReactNode;
  /** How far the picture drifts, in percent of its height, either side of centre. */
  shift?: number;
};

/**
 * A photograph that drifts a little against the scroll. Place it inside a relatively
 * positioned, overflow-hidden frame; it is scaled up just enough that the frame never shows
 * an edge. Does nothing for people who ask for reduced motion.
 */
export function Parallax({ children, shift = 6 }: Props) {
  const layer = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = layer.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          el,
          { yPercent: -shift },
          {
            yPercent: shift,
            ease: "none",
            scrollTrigger: {
              trigger: el.parentElement ?? el,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          },
        );
      });
      return () => mm.revert();
    },
    { scope: layer, dependencies: [shift] },
  );

  return (
    <div ref={layer} className="absolute inset-0 scale-[1.14] will-change-transform">
      {children}
    </div>
  );
}
