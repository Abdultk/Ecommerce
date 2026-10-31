import { describe, expect, it } from "vitest";
import { sanitizeProductHtml } from "./sanitize";

describe("sanitizeProductHtml", () => {
  it("keeps basic formatting", () => {
    const html = "<h3>Care</h3><p>Hand wash <strong>only</strong>.</p><ul><li>Dry well</li></ul>";
    expect(sanitizeProductHtml(html)).toBe(html);
  });

  it.each([
    ["<p>Hi</p><script>alert(1)</script>", "<p>Hi</p>"],
    ['<img src="x" onerror="alert(1)">', ""],
    ['<p onclick="steal()">Text</p>', "<p>Text</p>"],
    ['<iframe src="https://evil.example"></iframe>', ""],
    ["<style>body{display:none}</style><p>x</p>", "<p>x</p>"],
  ])("removes dangerous markup from %s", (input, expected) => {
    expect(sanitizeProductHtml(input)).toBe(expected);
  });

  it("drops javascript: links but keeps safe ones with rel and target", () => {
    expect(sanitizeProductHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeProductHtml('<a href="https://example.com/care">guide</a>')).toBe(
      '<a href="https://example.com/care" rel="noopener noreferrer nofollow" target="_blank">guide</a>',
    );
  });
});
