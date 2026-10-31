"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserScheduler, createIdleTimer, type IdleTimer, type Scheduler } from "./idle-timer";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

type Options = {
  enabled: boolean;
  onTimeout: () => void;
  scheduler?: Scheduler;
};

/**
 * Tracks user activity and calls onTimeout after 30 idle minutes, raising
 * `isWarning` at 28. Once the warning is up only an explicit stayActive()
 * dismisses it, so a stray mouse nudge can't hide the notice.
 */
export function useIdleTimeout({ enabled, onTimeout, scheduler = browserScheduler }: Options) {
  const [isWarning, setIsWarning] = useState(false);
  const warningRef = useRef(false);
  const timerRef = useRef<IdleTimer | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!enabled) return;
    const timer = createIdleTimer({
      scheduler,
      onWarn: () => {
        warningRef.current = true;
        setIsWarning(true);
      },
      onTimeout: () => {
        warningRef.current = false;
        setIsWarning(false);
        onTimeoutRef.current();
      },
    });
    const onActivity = () => {
      if (!warningRef.current) timer.reset();
    };
    timerRef.current = timer;
    timer.start();
    ACTIVITY_EVENTS.forEach((e) =>
      document.addEventListener(e, onActivity, { capture: true, passive: true }),
    );
    return () => {
      timer.stop();
      timerRef.current = null;
      ACTIVITY_EVENTS.forEach((e) =>
        document.removeEventListener(e, onActivity, { capture: true }),
      );
    };
  }, [enabled, scheduler]);

  const stayActive = useCallback(() => {
    warningRef.current = false;
    setIsWarning(false);
    timerRef.current?.reset();
  }, []);

  return { isWarning: enabled && isWarning, stayActive };
}
