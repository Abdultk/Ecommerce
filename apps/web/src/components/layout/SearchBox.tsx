"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { ProductSummary, formatMoney } from "@hp/contracts";
import { ProductImage } from "@/components/catalog/ProductImage";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { SearchIcon } from "@/components/ui/Icons";
import { browserApi } from "@/lib/api";
import { DEFAULT_QUERY, toApiQueryString } from "@/lib/query";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 220;
const MAX_SUGGESTIONS = 5;

type Suggestions = { for: string; items: ProductSummary[] };

/**
 * A plain GET form (works without JavaScript and lands on /shop?q=…) that also suggests
 * matching products as you type, using the catalog's own search. Arrow keys move through
 * the suggestions, Enter opens one, Escape closes the list.
 */
export function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { currency } = useStoreConfig();
  const t = useTranslations("Search");
  const listId = useId();
  const root = useRef<HTMLFormElement>(null);
  const sequence = useRef(0);
  const [term, setTerm] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestions>({ for: "", items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const query = term.trim();
  // Only show an answer that belongs to what is typed now (never a stale or half-loaded one).
  const ready = suggestions.for === query;
  const items = ready ? suggestions.items : [];
  const showList = open && query.length >= MIN_CHARS && ready;

  useEffect(() => {
    if (query.length < MIN_CHARS) return;
    const mine = ++sequence.current;
    const timer = window.setTimeout(async () => {
      let found: ProductSummary[] = [];
      try {
        const { data } = await browserApi.get(
          `/products?${toApiQueryString({ ...DEFAULT_QUERY, q: query, pageSize: MAX_SUGGESTIONS })}`,
          z.array(ProductSummary),
        );
        found = data.slice(0, MAX_SUGGESTIONS);
      } catch {
        // Suggestions are an enhancement: the form still searches without them.
      }
      if (mine === sequence.current) setSuggestions({ for: query, items: found });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = items.length;
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (event.key === "Enter" && showList && active >= 0 && items[active]) {
      event.preventDefault();
      router.push(`/p/${items[active].slug}`);
      setOpen(false);
    }
  }

  return (
    <form
      ref={root}
      action="/shop"
      method="get"
      role="search"
      className="relative w-full"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor="site-search" className="sr-only">
        {t("label")}
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={showList && items.length > 0 ? listId : undefined}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        maxLength={100}
        placeholder={t("placeholder")}
        className="field !rounded-md !ps-11 !pe-4"
      />
      <SearchIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-smoke" />
      <button type="submit" className="sr-only">
        {t("submit")}
      </button>

      {showList ? (
        <div className="absolute inset-x-0 top-full z-50 mt-2 origin-top animate-rise overflow-hidden rounded-[var(--radius-pan)] bg-crust p-2 shadow-[var(--shadow-lift)]">
          {items.length > 0 ? (
            <>
              <ul id={listId} role="listbox" aria-label={t("suggestions")}>
                {items.map((product, index) => (
                  <li
                    key={product.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                  >
                    <Link
                      href={`/p/${product.slug}`}
                      tabIndex={-1}
                      className={`flex items-center gap-3 rounded-md p-2 transition-colors ${
                        index === active ? "bg-parchment" : "hover:bg-parchment"
                      }`}
                    >
                      <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-sage-wash">
                        <ProductImage
                          src={product.thumbnailUrl}
                          alt=""
                          label={product.name}
                          sizes="48px"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{product.name}</span>
                        {product.brand ? (
                          <span className="block truncate text-sm text-smoke">{product.brand}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-sm font-semibold">
                        {formatMoney(product.fromPriceCents, currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="px-2 pb-1 pt-2 text-sm">
                <Link
                  href={`/shop?q=${encodeURIComponent(query)}`}
                  className="link-underline font-semibold"
                >
                  {t("seeAll", { query })}
                </Link>
              </p>
            </>
          ) : (
            <p role="status" className="p-3 text-sm text-smoke">
              {t("noMatches", { query })}
            </p>
          )}
        </div>
      ) : null}
    </form>
  );
}
