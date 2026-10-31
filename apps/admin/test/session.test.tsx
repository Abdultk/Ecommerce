import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AdminProductListItem, ok } from "@hp/contracts";
import { z } from "zod";
import { DashboardShell } from "@/components/DashboardShell";
import { SessionGuard } from "@/components/SessionGuard";
import { useSession } from "@/lib/session";
import { mockSessionFor } from "@test/mocks/accounts";
import { mockRouter } from "./navigation";
import { API, server } from "./server";
import { ManualClock, renderWithProviders } from "./utils";

describe("<SessionGuard>", () => {
  it("redirects to /login when there is no session", async () => {
    renderWithProviders(
      <SessionGuard>
        <p>Secret dashboard</p>
      </SessionGuard>,
      { bootstrap: true },
    );
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
  });

  it("restores a session from the refresh cookie on load", async () => {
    server.use(
      http.post(`${API}/auth/refresh`, () => HttpResponse.json(ok(mockSessionFor("ADMIN")))),
    );
    renderWithProviders(
      <SessionGuard>
        <p>Secret dashboard</p>
      </SessionGuard>,
      { bootstrap: true },
    );
    expect(await screen.findByText("Secret dashboard")).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("renders children straight away for a signed-in user", () => {
    renderWithProviders(
      <SessionGuard>
        <p>Secret dashboard</p>
      </SessionGuard>,
      { role: "STAFF" },
    );
    expect(screen.getByText("Secret dashboard")).toBeInTheDocument();
  });
});

describe("silent refresh", () => {
  function Probe() {
    const { api, user } = useSession();
    const [result, setResult] = useState("");
    return (
      <>
        <p>user: {user?.role ?? "none"}</p>
        <button
          type="button"
          onClick={() =>
            api
              .get("/admin/products", z.array(AdminProductListItem))
              .then((r) => setResult(`rows: ${r.data.length}`))
              .catch((e: Error) => setResult(`error: ${e.message}`))
          }
        >
          Load
        </button>
        <p>{result}</p>
      </>
    );
  }

  it("refreshes an expired access token once and retries the request", async () => {
    const fresh = mockSessionFor("ADMIN");
    let refreshes = 0;
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshes += 1;
        return HttpResponse.json(ok(fresh));
      }),
    );
    renderWithProviders(<Probe />, { session: { ...fresh, accessToken: "expired-token" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText(/^rows: \d+$/)).toBeInTheDocument();
    expect(refreshes).toBe(1);
  });

  it("ends the session and forgets cached data when the refresh token is rejected", async () => {
    const captured: { client?: QueryClient } = {};
    function CacheProbe() {
      captured.client = useQueryClient();
      return null;
    }
    const session = { ...mockSessionFor("STAFF"), accessToken: "expired-token" };
    renderWithProviders(
      <>
        <Probe />
        <CacheProbe />
      </>,
      { session },
    );
    captured.client!.setQueryData(["orders", "list"], [{ email: "customer@example.test" }]);

    await userEvent.setup().click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText(/^error:/)).toBeInTheDocument();
    expect(screen.getByText("user: none")).toBeInTheDocument();
    expect(captured.client!.getQueryData(["orders", "list"])).toBeUndefined();
  });
});

describe("sign out", () => {
  it("calls /auth/logout, clears the session and returns to /login", async () => {
    let loggedOut = false;
    server.use(
      http.post(`${API}/auth/logout`, () => {
        loggedOut = true;
        return HttpResponse.json(ok(null));
      }),
    );
    renderWithProviders(
      <DashboardShell scheduler={new ManualClock()}>
        <p>Dashboard content</p>
      </DashboardShell>,
      { role: "SUPER_ADMIN" },
    );
    expect(screen.getByText("Morgan Hale")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
    expect(loggedOut).toBe(true);
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
  });

  it("still clears the local session when the logout call fails", async () => {
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()));
    renderWithProviders(
      <DashboardShell scheduler={new ManualClock()}>
        <p>Dashboard content</p>
      </DashboardShell>,
      { role: "STAFF" },
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
  });
});
