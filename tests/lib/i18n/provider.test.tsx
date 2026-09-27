import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider, useI18n } from "@/lib/i18n";

function LocaleProbe() {
  const { locale } = useI18n();
  return <output aria-label="active locale">{locale}</output>;
}

describe("LanguageProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves a stored English preference during Strict Mode effects", async () => {
    localStorage.setItem("catwallet-locale", "en");

    render(
      <StrictMode>
        <LanguageProvider>
          <LocaleProbe />
        </LanguageProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("active locale")).toHaveTextContent("en");
    });
    expect(localStorage.getItem("catwallet-locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("loads a stored Portuguese preference", async () => {
    localStorage.setItem("catwallet-locale", "pt-BR");

    render(
      <LanguageProvider>
        <LocaleProbe />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("active locale")).toHaveTextContent("pt-BR");
    });
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("keeps Simplified Chinese as the default without a stored preference", async () => {
    render(
      <LanguageProvider>
        <LocaleProbe />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("active locale")).toHaveTextContent("zh-CN");
    });
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
