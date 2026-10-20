const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeHost(input: string): string {
  const raw = input.trim();
  const u = new URL(HAS_SCHEME.test(raw) ? raw : `https://${raw}`); // throws on garbage
  const host = u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!host.includes(".")) throw new Error(`Invalid host: ${input}`);
  return host;
}

export function normalizeSeedUrl(input: string): string {
  const raw = input.trim();
  const u = new URL(HAS_SCHEME.test(raw) ? raw : `https://${raw}`);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${u.protocol}`);
  }
  u.hash = "";
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

export function hostMatchesScope(host: string, scope: string[]): boolean {
  const h = normalizeHost(host);
  return scope.some((s) => h === s || h.endsWith(`.${s}`));
}
