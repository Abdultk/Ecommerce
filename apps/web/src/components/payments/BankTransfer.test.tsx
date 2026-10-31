import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BankTransferDetails } from "@hp/contracts";
import { MOCK_BANK } from "@/test/msw/store";
import { renderWithProviders as render } from "@/test/render";
import { axeViolations } from "@/test/axe";
import { shownMoney } from "@/test/money";
import { BankTransferPanel } from "./BankTransferPanel";
import { CopyButton } from "./CopyButton";

const transfer: BankTransferDetails = {
  reference: "HP-2026-001001",
  amountCents: 23_725,
  dueAt: "2026-10-13T09:00:00.000Z",
  bank: MOCK_BANK,
};

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("BankTransferPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists what to pay, where to, the reference and the deadline in Muscat time", async () => {
    const { container } = render(
      <BankTransferPanel transfer={transfer} currency="OMR" title="Awaiting bank transfer" />,
    );
    const panel = screen.getByRole("region", { name: "Awaiting bank transfer" });
    const row = (term: string) => within(panel).getByText(term).closest("div");

    expect(row("Amount")).toHaveTextContent(shownMoney(23_725));
    expect(row("Reference")).toHaveTextContent("HP-2026-001001");
    expect(row("Bank")).toHaveTextContent("Bank Muscat");
    expect(row("Account name")).toHaveTextContent("Hearth and Pan LLC");
    expect(row("Account number")).toHaveTextContent("0123 4567 8901 2345");
    expect(row("IBAN")).toHaveTextContent("OM51 0180 0012 3456 7890 123");
    expect(row("SWIFT / BIC")).toHaveTextContent("BMUSOMRX");
    expect(row("Pay by")).toHaveTextContent(/Oct 13.*1:00.*GMT\+4/);
    expect(panel).toHaveTextContent("Use the order number as the transfer reference.");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("leaves out SWIFT and instructions when the bank has none", () => {
    const bank = { ...MOCK_BANK, swift: undefined, instructions: undefined };
    render(<BankTransferPanel transfer={{ ...transfer, bank }} currency="OMR" title="Pay" />);
    expect(screen.queryByText("SWIFT / BIC")).not.toBeInTheDocument();
  });

  it("copies the exact values, compact IBAN and plain amount, and says so", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    render(<BankTransferPanel transfer={transfer} currency="OMR" title="Pay" />);
    stubClipboard(writeText);

    await user.click(screen.getByRole("button", { name: "Copy IBAN" }));
    expect(writeText).toHaveBeenLastCalledWith("OM510180001234567890123");
    expect(await screen.findByText("IBAN copied")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy amount" }));
    expect(writeText).toHaveBeenLastCalledWith("23.725");
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(writeText).toHaveBeenLastCalledWith("HP-2026-001001");
    await user.click(screen.getByRole("button", { name: "Copy account number" }));
    expect(writeText).toHaveBeenLastCalledWith("0123 4567 8901 2345");
  });
});

describe("CopyButton", () => {
  it("explains when the browser refuses to copy", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="x" label="reference" />);
    stubClipboard(() => Promise.reject(new Error("denied")));
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't copy/i);
  });

  it("explains when there is no clipboard at all", async () => {
    const user = userEvent.setup();
    render(<CopyButton value="x" label="reference" />);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't copy/i);
  });
});
