import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { RouteFocus } = await import("./RouteFocus");

function Page() {
  return (
    <>
      <a href="/shop">Shop link</a>
      <main id="main" tabIndex={-1}>
        <h1>Page</h1>
      </main>
      <RouteFocus />
    </>
  );
}

describe("RouteFocus", () => {
  it("leaves focus alone on the first render", () => {
    nav.pathname = "/";
    render(<Page />);
    expect(document.body).toHaveFocus();
  });

  it("moves focus to <main> after a client-side route change", () => {
    nav.pathname = "/";
    const { rerender } = render(<Page />);
    screen.getByRole("link", { name: "Shop link" }).focus();

    nav.pathname = "/shop";
    rerender(<Page />);

    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("does nothing when the pathname is unchanged (e.g. filter params)", () => {
    nav.pathname = "/shop";
    const { rerender } = render(<Page />);
    const link = screen.getByRole("link", { name: "Shop link" });
    link.focus();
    rerender(<Page />);
    expect(link).toHaveFocus();
  });
});
