import axe from "axe-core";

/**
 * Runs axe-core (WCAG 2.0–2.2 A/AA rules) against rendered DOM and returns readable
 * violations, so a failing assertion names the rule and the offending nodes.
 * jsdom has no layout, so colour contrast is checked against the design tokens instead
 * (globals.css), and page-level landmark rules are off for component-sized fragments.
 */
// jsdom has no canvas; axe probes one for icon-ligature text and logs a noisy "not
// implemented" error. Returning null (no 2D context) is a case axe already handles.
if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });
}

export async function axeViolations(
  container: Element,
  { page = false }: { page?: boolean } = {},
): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
    },
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: page },
      "landmark-one-main": { enabled: page },
      "page-has-heading-one": { enabled: page },
    },
  });
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}
