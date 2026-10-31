import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLogViewer } from "@/components/audit/AuditLogViewer";
import { diffKeys } from "@/components/audit/JsonDiff";
import { RequirePermission } from "@/components/ui/NoAccess";
import { navigation } from "./navigation";
import { renderWithProviders } from "./utils";

describe("diffKeys", () => {
  it("lists top-level keys that were added, removed or changed", () => {
    expect(diffKeys({ a: 1, b: { c: 2 }, d: 4 }, { a: 1, b: { c: 3 }, e: 5 })).toEqual([
      "b",
      "d",
      "e",
    ]);
    expect(diffKeys(null, { role: "STAFF" })).toEqual(["role"]);
    expect(diffKeys("x", "y")).toEqual(["(value)"]);
  });
});

describe("<AuditLogViewer>", () => {
  beforeEach(() => navigation.reset("/audit-log"));

  it("lists entries newest first", async () => {
    renderWithProviders(<AuditLogViewer />, { role: "SUPER_ADMIN" });
    await screen.findByText("coupon.update");
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("coupon.update")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("user.invite")).toBeInTheDocument();
  });

  it("filters by entity and actor through the URL", async () => {
    renderWithProviders(<AuditLogViewer />, { role: "SUPER_ADMIN" });
    await screen.findByText("coupon.update");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Entity"), "User");
    expect(navigation.getSearch()).toBe("entity=User");
    await waitFor(() => expect(screen.queryByText("coupon.update")).not.toBeInTheDocument());

    await user.selectOptions(await screen.findByLabelText("Actor"), "u_mock_admin");
    expect(navigation.getSearch()).toBe("entity=User&actorId=u_mock_admin");
    expect(await screen.findByText("No entries match these filters.")).toBeInTheDocument();
  });

  it("shows before and after side by side and names what changed", async () => {
    renderWithProviders(<AuditLogViewer />, { role: "SUPER_ADMIN" });
    await screen.findByText("coupon.update");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "View changes for coupon.update" }));
    const dialog = screen.getByRole("dialog", { name: "coupon.update · Coupon cpn_mock_3" });
    expect(within(dialog).getByText("Changed: isActive")).toBeInTheDocument();
    const before = within(dialog).getByRole("region", { name: "Before" });
    const after = within(dialog).getByRole("region", { name: "After" });
    expect(before).toHaveTextContent('"isActive": true');
    expect(after).toHaveTextContent('"isActive": false');
  });

  it("is blocked for ADMIN (no audit:read)", () => {
    renderWithProviders(
      <RequirePermission perm="audit:read" label="Audit log">
        <AuditLogViewer />
      </RequirePermission>,
      { role: "ADMIN" },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No access to Audit log");
  });
});
