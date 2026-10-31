const UNKNOWN = "unknown";
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4; // /64

/** Expands "2001:db8::1" to its 8 groups, or returns null if it isn't valid IPv6 text. */
function expandIpv6(ip: string): string[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = IPV6_GROUPS - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
}

/**
 * Rate-limit key for a client address. IPv6 clients are grouped by /64, because one
 * subscriber usually controls a whole /64 and could otherwise rotate addresses freely.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return UNKNOWN;
  const mapped = ip.match(IPV4_MAPPED);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(":")) return ip;
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, PREFIX_GROUPS).join(":")}::/64` : ip;
}
