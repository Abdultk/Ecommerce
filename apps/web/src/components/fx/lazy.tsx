"use client";

import dynamic from "next/dynamic";

// GSAP is ~45 KB gzipped. These wrappers keep it out of a route's first-load JS: the markup is
// still server-rendered, and the animation code arrives in its own chunk right after.
export const LazySplitText = dynamic(() => import("./SplitText"));
export const LazyParallax = dynamic(() => import("./Parallax").then((m) => m.Parallax));
export const LazyAnimatedContent = dynamic(() => import("./AnimatedContent"));
