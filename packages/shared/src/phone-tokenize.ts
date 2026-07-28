/**
 * 电话号码归一化/分词：提取纯数字 token 用于跨记录匹配。
 *
 * - 去空格/括号等分隔符，按横线/逗号/汉字切分
 * - 识别分机号：如果某段≥8位（完整号码），其后的段视为分机号
 * - token ≥7 位数字才返回（过滤垃圾短数字）
 * - 纯文字（"无"、"同上"）与空值返回空数组
 */
export function tokenizePhone(input: string | null | undefined): string[] {
  if (!input || input.trim() === "") {
    return [];
  }

  const text = input.trim();

  // 纯文字标记（"无"、"同上"等）
  if (/^[一-龥]+$/.test(text)) {
    return [];
  }

  // 移除明确标记的分机号（"转"、"ext"、"分机"等后面的内容）
  const cleaned = text.replace(/(?:转|分机|ext)\s*\d+/gi, "");

  // 按强分隔符（逗号、顿号、分号、汉字）切分为多个号码候选
  const candidates = cleaned.split(/[,，、;；]|[一-龥]+/).filter((s) => s.trim());

  const tokens: string[] = [];

  for (let candidate of candidates) {
    candidate = candidate.trim();
    if (!candidate) continue;

    // 按横线分段（先分段，再在各段内移除空格括号）
    const segments = candidate.split("-");

    // 提取各段的纯数字（移除空格、括号等）
    const digitSegments = segments
      .map((s) => s.replace(/[\s()（）]/g, "").replace(/\D/g, ""))
      .filter((s) => s.length > 0);

    if (digitSegments.length === 0) continue;

    // 查找第一个≥8位的段（完整号码）
    const completeSegmentIndex = digitSegments.findIndex((s) => s.length >= 8);

    let result: string;
    if (completeSegmentIndex >= 0) {
      // 找到≥8位的段：合并到该段（含）为止，后面的丢弃（视为分机号）
      result = digitSegments.slice(0, completeSegmentIndex + 1).join("");
    } else {
      // 没有≥8位的段：合并所有段
      result = digitSegments.join("");
    }

    if (result.length >= 7) {
      tokens.push(result);
    }
  }

  return tokens;
}
