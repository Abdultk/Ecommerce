import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "@hp/contracts";
import { Can } from "@/components/Can";
import { renderWithProviders } from "./utils";

const ADMIN_ROLES = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const PROBES: Permission[] = [
  "product:read",
  "product:delete",
  "coupon:write",
  "audit:read",
  "user:write",
];

function renderCan(perm: Permission, role?: Exclude<Role, "CUSTOMER">) {
  renderWithProviders(
    <Can perm={perm} fallback={<p>hidden</p>}>
      <p>allowed</p>
    </Can>,
    { role },
  );
}

describe("<Can>", () => {
  describe.each(ADMIN_ROLES)("for %s", (role) => {
    it.each(PROBES)("renders %s children only when can() allows it", (perm) => {
      renderCan(perm, role);
      const expected = can(role, perm) ? "allowed" : "hidden";
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  it("matches the role matrix at the boundaries", () => {
    renderCan("product:delete", "STAFF");
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("lets SUPER_ADMIN see audit-only controls", () => {
    renderCan("audit:read", "SUPER_ADMIN");
    expect(screen.getByText("allowed")).toBeInTheDocument();
  });

  it("renders the fallback when nobody is signed in", () => {
    renderCan("product:read");
    expect(screen.getByText("hidden")).toBeInTheDocument();
    expect(screen.queryByText("allowed")).not.toBeInTheDocument();
  });

  it("renders nothing by default when denied", () => {
    renderWithProviders(
      <Can perm="audit:read">
        <p>allowed</p>
      </Can>,
      { role: "ADMIN" },
    );
    expect(screen.queryByText("allowed")).not.toBeInTheDocument();
  });
});
