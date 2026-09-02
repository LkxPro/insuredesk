import { z } from "zod";

export const OPEN_API_ERROR_CODES = [
  "invalid_params",
  "invalid_cursor",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "concurrency_limit",
  "query_timeout",
  "internal_error",
] as const;
export const openApiErrorCodeSchema = z.enum(OPEN_API_ERROR_CODES);
export type OpenApiErrorCode = z.infer<typeof openApiErrorCodeSchema>;

export const openApiErrorBodySchema = z.object({
  error: z.object({ code: openApiErrorCodeSchema, message: z.string() }),
});
export type OpenApiErrorBody = z.infer<typeof openApiErrorBodySchema>;

export function openApiErrorBody(code: OpenApiErrorCode, message: string): OpenApiErrorBody {
  return { error: { code, message } };
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUES = new Map([...BASE64URL_ALPHABET].map((char, index) => [char, index]));
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

// 本包 types:[]（纯 ECMAScript，浏览器/Node 双端可用）：没有 Buffer/atob，
// cursor 的 UTF-8 与 base64url 只能手写。
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i += 1;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8Text(bytes: number[]): string {
  let text = "";
  let i = 0;
  while (i < bytes.length) {
    const head = bytes[i] ?? 0;
    let code: number;
    let length: number;
    if (head < 0x80) {
      code = head;
      length = 1;
    } else if ((head & 0xe0) === 0xc0) {
      code = head & 0x1f;
      length = 2;
    } else if ((head & 0xf0) === 0xe0) {
      code = head & 0x0f;
      length = 3;
    } else if ((head & 0xf8) === 0xf0) {
      code = head & 0x07;
      length = 4;
    } else {
      throw new Error("invalid utf-8 lead byte");
    }
    for (let j = 1; j < length; j += 1) {
      const continuation = bytes[i + j];
      if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
        throw new Error("invalid utf-8 continuation byte");
      }
      code = (code << 6) | (continuation & 0x3f);
    }
    text += String.fromCodePoint(code);
    i += length;
  }
  return text;
}

function base64urlEncode(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL_ALPHABET.charAt(b0 >> 2);
    out += BASE64URL_ALPHABET.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4));
    if (b1 !== undefined) {
      out += BASE64URL_ALPHABET.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6));
    }
    if (b2 !== undefined) {
      out += BASE64URL_ALPHABET.charAt(b2 & 0x3f);
    }
  }
  return out;
}

function base64urlDecode(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const c0 = BASE64URL_VALUES.get(text.charAt(i));
    const c1 = BASE64URL_VALUES.get(text.charAt(i + 1));
    const c2 = BASE64URL_VALUES.get(text.charAt(i + 2));
    const c3 = BASE64URL_VALUES.get(text.charAt(i + 3));
    if (c0 === undefined || c1 === undefined) {
      throw new Error("invalid base64url");
    }
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) {
      bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
      if (c3 !== undefined) {
        bytes.push(((c2 & 0x03) << 6) | c3);
      }
    }
  }
  return bytes;
}

export function encodeCursor(value: unknown): string {
  return base64urlEncode(utf8Bytes(JSON.stringify(value)));
}

export function decodeCursor(cursor: string): unknown | null {
  if (!BASE64URL_PATTERN.test(cursor)) {
    return null;
  }
  try {
    return JSON.parse(utf8Text(base64urlDecode(cursor)));
  } catch {
    return null;
  }
}
