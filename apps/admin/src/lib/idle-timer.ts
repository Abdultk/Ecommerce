/** Injectable timer functions so tests can drive time deterministically. */
export type Scheduler = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

export const IDLE_TIMEOUT_MS = 30 * 60_000;
export const IDLE_WARNING_MS = 28 * 60_000;

export const browserScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

export type IdleTimerOptions = {
  scheduler?: Scheduler;
  timeoutMs?: number;
  warningMs?: number;
  onWarn: () => void;
  onTimeout: () => void;
};

export type IdleTimer = {
  /** Start (or restart) the countdown from zero. */
  start(): void;
  /** Same as start: call on user activity. */
  reset(): void;
  stop(): void;
};

export function createIdleTimer({
  scheduler = browserScheduler,
  timeoutMs = IDLE_TIMEOUT_MS,
  warningMs = IDLE_WARNING_MS,
  onWarn,
  onTimeout,
}: IdleTimerOptions): IdleTimer {
  let handles: unknown[] = [];

  const stop = () => {
    handles.forEach((h) => scheduler.clearTimeout(h));
    handles = [];
  };

  const start = () => {
    stop();
    handles = [scheduler.setTimeout(onWarn, warningMs), scheduler.setTimeout(onTimeout, timeoutMs)];
  };

  return { start, reset: start, stop };
}
