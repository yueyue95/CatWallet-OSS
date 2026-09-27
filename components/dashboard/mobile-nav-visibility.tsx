"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type MobileNavVisibilityContextValue = {
  readonly quickActionHidden: boolean;
  readonly setQuickActionHidden: (hidden: boolean) => void;
};

const MobileNavVisibilityContext =
  createContext<MobileNavVisibilityContextValue>({
    quickActionHidden: false,
    setQuickActionHidden: () => {},
  });

export function MobileNavVisibilityProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [quickActionHidden, setQuickActionHidden] = useState(false);

  return (
    <MobileNavVisibilityContext.Provider
      value={{ quickActionHidden, setQuickActionHidden }}
    >
      {children}
    </MobileNavVisibilityContext.Provider>
  );
}

export function useMobileNavVisibility() {
  return useContext(MobileNavVisibilityContext);
}
