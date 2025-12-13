export function normalizeGeorgianDefs(defs: string[]): string[] {
  const seen = new Set<string>();

  const normalized: string[] = [];

  for (const raw of defs) {
    const cleaned = raw.replace(/\s+/g, " ").trim();

    if (!cleaned || seen.has(cleaned)) {
      continue;
    }

    seen.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized;
}
