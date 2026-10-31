import { useState } from "react";
import { screen } from "@testing-library/react";
import { renderWithProviders as render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleCatalog } from "@hp/test-utils";
import type { ProductVariant } from "@hp/contracts";
import { VariantPicker } from "./VariantPicker";

const boardVariants = sampleCatalog()[4]!.variants; // Medium, Large
const dutchOvenVariants = sampleCatalog()[1]!.variants; // Cobalt, Sage (sold out)
const threeVariants: ProductVariant[] = [
  ...boardVariants,
  { ...boardVariants[0]!, id: "v_xl", sku: "NF-CB-XL", name: "Extra large" },
];

function Harness({
  variants,
  onChange = vi.fn(),
}: {
  variants: ProductVariant[];
  onChange?: (id: string) => void;
}) {
  const [selected, setSelected] = useState(variants[0]!.id);
  return (
    <VariantPicker
      label="Size"
      variants={variants}
      selectedId={selected}
      onChange={(id) => {
        setSelected(id);
        onChange(id);
      }}
    />
  );
}

describe("VariantPicker", () => {
  it("renders a labelled radio group with the selected variant checked", () => {
    render(<Harness variants={boardVariants} />);
    expect(screen.getByRole("radiogroup", { name: "Size" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Large/ })).toHaveAttribute("aria-checked", "false");
  });

  it("selects a variant on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness variants={boardVariants} onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /Large/ }));

    expect(onChange).toHaveBeenCalledWith(boardVariants[1]!.id);
    expect(screen.getByRole("radio", { name: /Large/ })).toHaveAttribute("aria-checked", "true");
  });

  it("uses a roving tab stop: only the selected radio is tabbable", () => {
    render(<Harness variants={boardVariants} />);
    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /Large/ })).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection and focus with arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<Harness variants={threeVariants} />);

    await user.tab();
    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /^Large/ })).toHaveFocus();
    expect(screen.getByRole("radio", { name: /^Large/ })).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: /Extra large/ })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: /Extra large/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("announces sold-out variants but still lets shoppers view them", async () => {
    const user = userEvent.setup();
    render(<Harness variants={dutchOvenVariants} />);

    const sage = screen.getByRole("radio", { name: /Sage.*sold out/i });
    await user.click(sage);
    expect(sage).toHaveAttribute("aria-checked", "true");
  });
});
