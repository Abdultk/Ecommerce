const MAX_FRAMES = 15;

export type SafeErrorFields = { type: string; code?: string; stack?: string };

/** Only the "    at ..." lines: the first stack line repeats the message, which can hold user data. */
const framesOf = (stack: string | undefined): string | undefined => {
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_FRAMES);
  return frames.length > 0 ? frames.join("\n") : undefined;
};

/**
 * What may be logged about an unexpected error: its type, a machine-readable code (e.g.
 * Prisma's P2002) and the stack frames. Never the message, which may echo emails,
 * addresses or SQL values.
 */
export function safeErrorFields(err: unknown): SafeErrorFields {
  if (!(err instanceof Error)) return { type: err === null ? "null" : typeof err };
  const code = (err as { code?: unknown }).code;
  const stack = framesOf(err.stack);
  return {
    type: err.name,
    ...(typeof code === "string" && { code }),
    ...(stack !== undefined && { stack }),
  };
}
