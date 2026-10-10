// Optional decoration must never make an otherwise valid market disappear.
// Images load in the browser, not through an unrestricted server-side proxy.
export function sourceImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      /[\[\]:]/.test(host) ||
      /^[\d.]+$/.test(host) ||
      /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
