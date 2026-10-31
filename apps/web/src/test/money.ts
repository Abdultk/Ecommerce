import { formatMoney, type CurrencyCode } from "@hp/contracts";

/**
 * formatMoney as Testing Library sees it: Intl puts a no-break space between "OMR" and the
 * number, and the DOM matchers normalise all whitespace to plain spaces.
 */
export const shownMoney = (minor: number, code: CurrencyCode = "OMR"): string =>
  formatMoney(minor, code).replace(/\s+/g, " ");
