"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type CartDrawerState = { isOpen: boolean; open: () => void; close: () => void };

const CartDrawerContext = createContext<CartDrawerState | null>(null);

export function CartDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo(
    () => ({ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }),
    [isOpen],
  );
  return <CartDrawerContext.Provider value={value}>{children}</CartDrawerContext.Provider>;
}

export function useCartDrawer(): CartDrawerState {
  const context = useContext(CartDrawerContext);
  if (!context) throw new Error("useCartDrawer must be used inside <CartDrawerProvider>.");
  return context;
}
