export function tokenizePhone(input: string | null | undefined): string[] {
  if (!input || input.trim() === "") {
    return [];
  }

  const text = input.trim();

  if (/^[一-龥]+$/.test(text)) {
    return [];
  }

  const cleaned = text.replace(/(?:转|分机|ext)\s*\d+/gi, "");

  const candidates = cleaned.split(/[,，、;；]|[一-龥]+/).filter((s) => s.trim());

  const tokens: string[] = [];

  for (let candidate of candidates) {
    candidate = candidate.trim();
    if (!candidate) continue;

    const segments = candidate.split("-");

    const digitSegments = segments
      .map((s) => s.replace(/[\s()（）]/g, "").replace(/\D/g, ""))
      .filter((s) => s.length > 0);

    if (digitSegments.length === 0) continue;

    const completeSegmentIndex = digitSegments.findIndex((s) => s.length >= 8);

    let result: string;
    if (completeSegmentIndex >= 0) {
      result = digitSegments.slice(0, completeSegmentIndex + 1).join("");
    } else {
      result = digitSegments.join("");
    }

    if (result.length >= 7) {
      tokens.push(result);
    }
  }

  return tokens;
}
