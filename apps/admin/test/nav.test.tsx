import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "@/components/Sidebar";
import { NAV_SECTIONS, navFor } from "@/lib/nav";
import { navigation } from "./navigation";
import { renderWithProviders } from "./utils";

const STAFF_NAV = ["Overview", "Products", "Categories", "Orders", "Inventory"];
const ADMIN_NAV = [
  "Overview",
  "Products",
  "Categories",
  "Orders",
  "Customers",
  "Inventory",
  "Coupons",
  "Analytics",
  "Reports",
  "Settings",
];
const SUPER_NAV = [...ADMIN_NAV.slice(0, -1), "Staff", "Audit log", "Settings"];

const labels = (role: Parameters<typeof navFor>[0]) => navFor(role).map((s) => s.label);

describe("navFor", () => {
  it("defines all twelve sections in order", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(SUPER_NAV);
  });

  it("filters sections by role", () => {
    expect(labels("STAFF")).toEqual(STAFF_NAV);
    expect(labels("ADMIN")).toEqual(ADMIN_NAV);
    expect(labels("SUPER_ADMIN")).toEqual(SUPER_NAV);
    expect(labels("CUSTOMER")).toEqual([]);
  });
});

describe("<Sidebar>", () => {
  const linkNames = () =>
    within(screen.getByRole("navigation", { name: "Admin sections" }))
      .getAllByRole("link")
      .map((a) => a.textContent?.trim());

  it.each([
    ["STAFF", STAFF_NAV],
    ["ADMIN", ADMIN_NAV],
    ["SUPER_ADMIN", SUPER_NAV],
  ] as const)("shows only %s sections", (role, expected) => {
    renderWithProviders(<Sidebar />, { role });
    expect(linkNames()).toEqual(expected);
  });

  it("shows Settings to ADMIN but not STAFF", () => {
    renderWithProviders(<Sidebar />, { role: "STAFF" });
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("hides Staff and Audit log from ADMIN", () => {
    renderWithProviders(<Sidebar />, { role: "ADMIN" });
    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
  });

  it("marks the current section with aria-current", () => {
    navigation.reset("/products");
    renderWithProviders(<Sidebar />, { role: "STAFF" });
    expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });
});
