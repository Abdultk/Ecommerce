import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ok } from "@hp/contracts";
import { DashboardShell } from "@/components/DashboardShell";
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, createIdleTimer } from "@/lib/idle-timer";
import { mockRouter } from "./navigation";
import { API, server } from "./server";
import { MINUTE, ManualClock, renderWithProviders } from "./utils";

function trackLogout() {
  const calls: string[] = [];
  server.use(
    http.post(`${API}/auth/logout`, () => {
      calls.push("logout");
      return HttpResponse.json(ok(null));
    }),
  );
  return calls;
}

function renderShell(clock: ManualClock) {
  renderWithProviders(
    <DashboardShell scheduler={clock}>
      <p>Dashboard content</p>
    </DashboardShell>,
    { role: "STAFF" },
  );
}

describe("createIdleTimer", () => {
  it("warns at 28 minutes and times out at 30", () => {
    expect(IDLE_WARNING_MS).toBe(28 * MINUTE);
    expect(IDLE_TIMEOUT_MS).toBe(30 * MINUTE);
    const clock = new ManualClock();
    const events: string[] = [];
    const timer = createIdleTimer({
      scheduler: clock,
      onWarn: () => events.push("warn"),
      onTimeout: () => events.push("timeout"),
    });
    timer.start();
    clock.advance(28 * MINUTE - 1);
    expect(events).toEqual([]);
    clock.advance(1);
    expect(events).toEqual(["warn"]);
    clock.advance(2 * MINUTE);
    expect(events).toEqual(["warn", "timeout"]);
  });

  it("restarts the countdown on reset and stops cleanly", () => {
    const clock = new ManualClock();
    const events: string[] = [];
    const timer = createIdleTimer({
      scheduler: clock,
      onWarn: () => events.push("warn"),
      onTimeout: () => events.push("timeout"),
    });
    timer.start();
    clock.advance(27 * MINUTE);
    timer.reset();
    clock.advance(27 * MINUTE);
    expect(events).toEqual([]);
    timer.stop();
    clock.advance(60 * MINUTE);
    expect(events).toEqual([]);
  });
});

describe("idle logout in the dashboard", () => {
  it("shows a warning dialog at 28 minutes of inactivity", () => {
    const clock = new ManualClock();
    renderShell(clock);

    act(() => clock.advance(28 * MINUTE - 1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    act(() => clock.advance(1));
    const dialog = screen.getByRole("alertdialog", { name: "Are you still there?" });
    expect(dialog).toHaveTextContent("signed out in 2 minutes");
    expect(screen.getByRole("button", { name: "Stay signed in" })).toHaveFocus();
  });

  it("keeps the session when the user chooses to stay", async () => {
    const clock = new ManualClock();
    renderShell(clock);
    act(() => clock.advance(28 * MINUTE));
    await userEvent.setup().click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    act(() => clock.advance(27 * MINUTE));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalledWith("/login");
  });

  it("treats keyboard and pointer activity as presence", () => {
    const clock = new ManualClock();
    renderShell(clock);
    act(() => clock.advance(20 * MINUTE));
    fireEvent.keyDown(document, { key: "a" });
    act(() => clock.advance(20 * MINUTE));
    fireEvent.pointerDown(document);
    act(() => clock.advance(20 * MINUTE));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("signs out after 30 minutes and calls /auth/logout", async () => {
    const calls = trackLogout();
    const clock = new ManualClock();
    renderShell(clock);

    act(() => clock.advance(28 * MINUTE));
    // Activity while the warning is open must not silently dismiss it.
    fireEvent.pointerDown(document);
    act(() => clock.advance(2 * MINUTE));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
    expect(calls).toEqual(["logout"]);
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
  });

  it("signs out from the dialog's sign-out button", async () => {
    const calls = trackLogout();
    const clock = new ManualClock();
    renderShell(clock);
    act(() => clock.advance(28 * MINUTE));
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out now" }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
    expect(calls).toEqual(["logout"]);
  });
});
