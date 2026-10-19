export interface ImageTranslationResult {
  source: string;
  translation: string;
}

interface JsonString {
  value: string;
  end: number;
  closed: boolean;
  invalid?: boolean;
}

const INVALID_RESULT = "图片识别结果不完整或格式错误，请重试翻译图片。";

function withoutFence(text: string, complete: boolean): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  if (complete) {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return fenced?.[1] ?? trimmed;
  }
  return trimmed.replace(/^```(?:json)?[ \t]*(?:\r?\n)?/i, "").trimStart();
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (/\s/.test(text[index] ?? "") && index < text.length) index += 1;
  return index;
}

/** Do not expose a half-written UTF-16 escape or surrogate to speech output. */
function safeUnicode(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += text[index] + text[index + 1];
        index += 1;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      result += text[index];
    }
  }
  return result;
}

function readString(text: string, start: number): JsonString {
  let value = "";
  let index = start + 1;
  const result = (closed = false, invalid = false): JsonString => ({
    value: safeUnicode(value),
    end: index,
    closed,
    invalid,
  });
  while (index < text.length) {
    const character = text[index++];
    if (character === '"') return result(true);
    if (character === "\\") {
      if (index >= text.length) return result();
      const escape = text[index++];
      if (escape === "u") {
        const hex = text.slice(index, index + 4);
        if (hex.length < 4) return result();
        if (!/^[0-9a-f]{4}$/i.test(hex)) return result(false, true);
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      } else {
        const escapes: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (!(escape in escapes)) return result(false, true);
        value += escapes[escape];
      }
    } else {
      if (character.charCodeAt(0) < 0x20) return result(false, true);
      value += character;
    }
  }
  return result();
}

/** Skip an unknown value without treating nested keys as result fields. */
function skipValue(text: string, start: number): number | undefined {
  let index = start;
  const brackets: string[] = [];
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const string = readString(text, index);
      if (!string.closed || string.invalid) return undefined;
      index = string.end;
      continue;
    }
    if (character === "{" || character === "[") {
      brackets.push(character === "{" ? "}" : "]");
    } else if (character === "}" || character === "]") {
      if (!brackets.length) return character === "}" ? index : undefined;
      if (brackets.pop() !== character) return undefined;
      if (!brackets.length) return index + 1;
    } else if (character === "," && !brackets.length) {
      return index;
    }
    index += 1;
  }
  return undefined;
}

/** Parse cumulative model output, exposing only recognized source/translation text. */
export function parseImageTranslation(
  text: string,
  complete = false,
): ImageTranslationResult {
  const json = withoutFence(text, complete);
  if (complete) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error(INVALID_RESULT);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(INVALID_RESULT);
    }
    const fields = parsed as Record<string, unknown>;
    if (typeof fields.source !== "string") {
      throw new Error("图片识别结果缺少有效原文，无法朗读，请重试翻译图片。");
    }
    if (typeof fields.translation !== "string") {
      throw new Error("图片识别结果缺少有效译文，请重试翻译图片。");
    }
    return { source: fields.source, translation: fields.translation };
  }

  const output: ImageTranslationResult = { source: "", translation: "" };
  if (!json.startsWith("{")) return output;
  let index = 1;
  while (index < json.length) {
    index = skipWhitespace(json, index);
    if (json[index] !== '"') break;
    const key = readString(json, index);
    if (!key.closed || key.invalid) break;
    index = skipWhitespace(json, key.end);
    if (json[index++] !== ":") break;
    index = skipWhitespace(json, index);
    if (json[index] === '"') {
      const value = readString(json, index);
      if (value.invalid) break;
      if (key.value === "source" || key.value === "translation") {
        output[key.value] = value.value;
      }
      if (!value.closed) break;
      index = value.end;
    } else {
      const end = skipValue(json, index);
      if (end === undefined) break;
      index = end;
    }
    index = skipWhitespace(json, index);
    if (json[index++] !== ",") break;
  }
  return output;
}
