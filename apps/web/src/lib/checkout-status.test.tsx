import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { fail, ok, type OrderStatus } from "@hp/contracts";
import { API_URL, server, setupMockApi } from "@/test/server";
import { authStore } from "./auth-store";
import { outcomeOf, pollDelay, useCheckoutStatus } from "./checkout-status";

setupMockApi();

const FAST = { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 };
const SOURCE = { number: "HP-2026-001001", token: "t".repeat(32) };

/** Answers each poll with the next status and records the bodies sent. */
function answer(statuses: OrderStatus[]) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API_URL}/checkout/status`, async ({ request }) => {
      bodies.push(await request.json());
      const status = statuses[Math.min(bodies.length - 1, statuses.length - 1)];
      return HttpResponse.json(ok({ status }));
    }),
  );
  return bodies;
}

describe("checkout status polling", () => {
  beforeEach(() => authStore.clear());

  it("backs off exponentially up to a ceiling", () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => pollDelay(n, 1000, 8000))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  it("sorts statuses into paid, failed and still pending", () => {
    expect(outcomeOf("PAID")).toBe("paid");
    expect(outcomeOf("SHIPPED")).toBe("paid");
    expect(outcomeOf("CANCELLED")).toBe("failed");
    expect(outcomeOf("REFUNDED")).toBe("failed");
    expect(outcomeOf("PENDING_PAYMENT")).toBe("pending");
  });

  it("polls until the order is paid, sending the guest token in the body", async () => {
    const bodies = answer(["PENDING_PAYMENT", "PAID"]);
    const { result } = renderHook(() => useCheckoutStatus(SOURCE, FAST));
    expect(result.current.state).toEqual({ kind: "checking" });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "paid" }));
    expect(bodies).toEqual([
      { number: SOURCE.number, token: SOURCE.token },
      { number: SOURCE.number, token: SOURCE.token },
    ]);
  });

  it("omits the token for a signed-in owner", async () => {
    const bodies = answer(["PAID"]);
    const { result } = renderHook(() =>
      useCheckoutStatus({ number: SOURCE.number, token: null }, FAST),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("paid"));
    expect(bodies).toEqual([{ number: SOURCE.number }]);
  });

  it("stops at once when the payment failed", async () => {
    const bodies = answer(["CANCELLED"]);
    const { result } = renderHook(() => useCheckoutStatus(SOURCE, FAST));
    await waitFor(() => expect(result.current.state).toEqual({ kind: "failed" }));
    expect(bodies).toHaveLength(1);
  });

  it("gives up after the cap as pending, and can check again", async () => {
    const bodies = answer(["PENDING_PAYMENT", "PENDING_PAYMENT", "PENDING_PAYMENT", "PAID"]);
    const { result } = renderHook(() => useCheckoutStatus(SOURCE, FAST));
    await waitFor(() => expect(result.current.state).toEqual({ kind: "pending" }));
    expect(bodies).toHaveLength(3);

    act(() => result.current.recheck());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "paid" }));
  });

  it("keeps trying through network errors but stops on a 4xx", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_URL}/checkout/status`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.error()
          : HttpResponse.json(fail("NOT_FOUND", "We couldn't find that order."), {
              status: 404,
            });
      }),
    );
    const { result } = renderHook(() => useCheckoutStatus(SOURCE, FAST));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        kind: "error",
        message: "We couldn't find that order.",
      }),
    );
    expect(calls).toBe(2);
  });

  it("does nothing without a source", () => {
    const { result } = renderHook(() => useCheckoutStatus(null, FAST));
    expect(result.current.state).toEqual({ kind: "checking" });
  });
});
