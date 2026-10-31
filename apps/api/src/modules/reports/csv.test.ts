import { describe, expect, it } from "vitest";
import { guardCell, toCsv } from "./csv";

describe("guardCell (formula injection)", () => {
  it.each(["=SUM(A1)", "+1", "-2+3", "@cmd", "\tx", "\rx"])("neutralises %j", (value) => {
    expect(guardCell(value)).toBe(`'${value}`);
  });

  it("leaves ordinary text, numbers, booleans and nulls alone", () => {
    expect(guardCell("Cast iron skillet")).toBe("Cast iron skillet");
    expect(guardCell(-150)).toBe(-150);
    expect(guardCell(true)).toBe(true);
    expect(guardCell(null)).toBeNull();
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF-separated rows with RFC 4180 quoting", () => {
    const csv = toCsv(
      ["name", "note", "cents"],
      [
        ["Wok, 14 in", 'say "hi"', 5_900],
        ["Pan", "line1\nline2", null],
      ],
    );
    expect(csv).toBe(
      'name,note,cents\r\n"Wok, 14 in","say ""hi""",5900\r\nPan,"line1\nline2",\r\n',
    );
  });

  it("guards formula cells and starts with a UTF-8 BOM-free header", () => {
    const csv = toCsv(["email"], [['=HYPERLINK("http://x")']]);
    expect(csv).toBe('email\r\n"\'=HYPERLINK(""http://x"")"\r\n');
  });

  it("writes dates as ISO strings and booleans as words", () => {
    const csv = toCsv(["at", "ok"], [[new Date("2026-10-10T00:00:00Z"), false]]);
    expect(csv).toBe("at,ok\r\n2026-10-10T00:00:00.000Z,false\r\n");
  });
});
