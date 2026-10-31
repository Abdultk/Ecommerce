import { describe, expect, it } from "vitest";
import { clientKey } from "./client-key";

describe("clientKey", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("groups an IPv6 client by its /64 so address rotation shares one bucket", () => {
    const a = clientKey("2001:db8:1:2:aaaa:bbbb:cccc:1");
    const b = clientKey("2001:db8:1:2::9");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
  });

  it("expands compressed IPv6 before grouping", () => {
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
  });

  it("falls back to a shared bucket when the address is unknown", () => {
    expect(clientKey(undefined)).toBe("unknown");
    expect(clientKey("")).toBe("unknown");
  });
});
