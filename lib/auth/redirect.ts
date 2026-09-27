export function getSafeRedirectPath(
  next: string | null,
  origin?: string,
): string {
  if (!next) {
    return "/dashboard";
  }

  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    next.includes("\n") ||
    next.includes("\r")
  ) {
    return "/dashboard";
  }

  if (origin) {
    try {
      const resolved = new URL(next, origin);
      if (resolved.origin !== origin) {
        return "/dashboard";
      }

      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      return "/dashboard";
    }
  }

  return next;
}

export function getPasswordResetRedirectUrl(origin: string): string {
  const redirectUrl = new URL("/auth/callback", origin);
  redirectUrl.searchParams.set("next", "/auth/update-password");
  return redirectUrl.toString();
}
