import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

const BLOCKING = new Set(["serious", "critical"]);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Scans the page with axe-core, attaches the full result to the report, and fails on
 * serious/critical violations (blueprint 8.1). Minor/moderate ones are only reported.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const summary = results.violations.map(
    (v) =>
      `${v.impact ?? "unknown"} ${v.id} (${v.nodes.length}): ${v.help} → ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  testInfo.annotations.push({
    type: "axe",
    description: `${label}: ${summary.length} violation(s)${summary.length ? `\n${summary.join("\n")}` : ""}`,
  });
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  // Soft, so one page's violations don't hide the next page's scan in the same test.
  expect
    .soft(
      blocking.map((v) => summary[results.violations.indexOf(v)]),
      `serious/critical axe violations on ${label}`,
    )
    .toEqual([]);
}
