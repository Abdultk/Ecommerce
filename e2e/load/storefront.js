// k6 load test: browse → search → PDP → add to cart, against the E2E stack.
// Blueprint 8.1 target: /products search p95 < 300 ms at 50 rps.
//   node scripts/run-k6.mjs          (grafana/k6 in docker, API at host.docker.internal:4100)
//   k6 run -e BASE_URL=http://localhost:4100/api/v1 load/storefront.js   (local k6)
//
// The E2E API trusts one proxy hop, so every iteration sends its own X-Forwarded-For and
// the per-IP limit (100 requests/min) applies per simulated shopper, not to the whole test.
// Never point this at production: there, X-Forwarded-For is set by the real proxy.
import http from "k6/http";
import { check, group } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:4100/api/v1").replace(/\/+$/, "");
const RATE = Number(__ENV.RATE || 50); // journeys started per second
const DURATION = __ENV.DURATION || "1m";

const SLUGS = [
  "cast-iron-skillet-10in",
  "enameled-dutch-oven-5-5qt",
  "tri-ply-saucepan-2qt",
  "chefs-knife-8in",
  "end-grain-cutting-board",
  "silicone-spatula-set-3pc",
  "glass-storage-set-10pc",
];
const QUERIES = ["skillet", "skilet", "knife", "dutch oven", "board", "spatula"];

export const options = {
  scenarios: {
    shoppers: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:search}": ["p(95)<300"],
    "http_req_duration{name:browse}": ["p(95)<300"],
    "http_req_duration{name:pdp}": ["p(95)<300"],
    "http_req_duration{name:add_to_cart}": ["p(95)<500"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomIp = () =>
  `10.${1 + Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;

export default function journey() {
  const headers = { "X-Forwarded-For": randomIp(), "Content-Type": "application/json" };
  const get = (path, name) => http.get(`${BASE_URL}${path}`, { headers, tags: { name } });

  group("browse", () => {
    const res = get("/products?sort=newest&page=1&pageSize=24", "browse");
    check(res, { "browse 200": (r) => r.status === 200 });
  });

  group("search", () => {
    const res = get(`/products?q=${encodeURIComponent(pick(QUERIES))}`, "search");
    check(res, { "search 200": (r) => r.status === 200 });
  });

  let variantId = null;
  group("pdp", () => {
    const res = get(`/products/${pick(SLUGS)}`, "pdp");
    check(res, { "pdp 200": (r) => r.status === 200 });
    const variants = res.status === 200 ? res.json("data.variants") : [];
    const buyable = (variants || []).find((v) => v.stockAvailable > 0);
    variantId = buyable ? buyable.id : null;
  });

  if (!variantId) return;
  group("add_to_cart", () => {
    // Each VU iteration has its own cookie jar entry, i.e. its own guest cart.
    const res = http.post(`${BASE_URL}/cart/items`, JSON.stringify({ variantId, quantity: 1 }), {
      headers,
      tags: { name: "add_to_cart" },
    });
    check(res, { "add to cart 2xx": (r) => r.status >= 200 && r.status < 300 });
  });
}
