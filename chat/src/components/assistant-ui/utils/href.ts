const RELATIVE = /^(?:[/?#]|\.{1,2}\/)/;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export function safeHref(url: string | undefined): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (trimmed === "") return undefined;
  const parsed = parse(trimmed);
  if (parsed) {
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined;
  }
  return RELATIVE.test(trimmed) ? trimmed : undefined;
}

export function hostOf(url: string | undefined): string | undefined {
  const href = safeHref(url);
  const hostname = href === undefined ? "" : (parse(href)?.hostname ?? "");
  return hostname.replace(/^www\./, "") || undefined;
}
