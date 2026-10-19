import { describe, expect, it } from "vitest";

import { parseImageTranslation } from "../../src/shared/image-translation";

describe("image translation response", () => {
  it("reads both fields, including empty results and reversed order", () => {
    expect(
      parseImageTranslation('{"translation":"你好","source":"Hello"}', true),
    ).toEqual({ source: "Hello", translation: "你好" });
    expect(
      parseImageTranslation('{"source":"","translation":""}', true),
    ).toEqual({
      source: "",
      translation: "",
    });
  });

  it("accepts a fenced JSON response", () => {
    const text = '```json\n{"source":"Hello","translation":"你好"}\n```';
    expect(parseImageTranslation(text, true)).toEqual({
      source: "Hello",
      translation: "你好",
    });
    expect(parseImageTranslation(text)).toEqual({
      source: "Hello",
      translation: "你好",
    });
  });

  it("safely decodes every streaming prefix with newlines, quotes, and Unicode", () => {
    const source = 'Line 1\n"hello" and 😀';
    const translation = "第一行\n你好 😀";
    const json =
      '{"source":"Line 1\\n\\"hello\\" and \\uD83D\\uDE00","translation":"\\u7b2c\\u4e00\\u884c\\n你好 \\uD83D\\uDE00"}';
    for (let length = 0; length <= json.length; length += 1) {
      const partial = parseImageTranslation(json.slice(0, length));
      expect(source.startsWith(partial.source)).toBe(true);
      expect(translation.startsWith(partial.translation)).toBe(true);
      expect(partial.source).not.toMatch(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u,
      );
      expect(partial.translation).not.toContain("\\u");
    }
    expect(parseImageTranslation(json, true)).toEqual({ source, translation });
  });

  it("reads unclosed strings without exposing JSON syntax", () => {
    expect(parseImageTranslation('{"source":"Hello')).toEqual({
      source: "Hello",
      translation: "",
    });
    expect(
      parseImageTranslation('{"translation":"你好","source":"Hello'),
    ).toEqual({
      source: "Hello",
      translation: "你好",
    });
    expect(parseImageTranslation('{"source":"Hello\\u4')).toEqual({
      source: "Hello",
      translation: "",
    });
    expect(parseImageTranslation('{"source":"Hello\\')).toEqual({
      source: "Hello",
      translation: "",
    });
  });

  it("does not mistake JSON keys inside original text or nested objects for output fields", () => {
    const source = 'The text says "translation":"wrong".';
    const json = JSON.stringify({
      metadata: [{ translation: "nested", source: "nested" }],
      source,
      translation: "真正的译文",
    });
    expect(parseImageTranslation(json)).toEqual({
      source,
      translation: "真正的译文",
    });
    expect(
      parseImageTranslation(
        '{"source":{"translation":"wrong"},"translation":"正确"}',
      ),
    ).toEqual({ source: "", translation: "正确" });
  });

  it.each([
    "只有译文",
    '{"source":"Hello","translation":"你好',
    '```json\n{"source":"Hello","translation":"你好"}',
    "[]",
    "null",
  ])("rejects incomplete or malformed final responses: %s", (text) => {
    expect(() => parseImageTranslation(text, true)).toThrow("不完整或格式错误");
  });

  it.each(['{"translation":"你好"}', '{"source":null,"translation":"你好"}'])(
    "rejects missing or non-text source: %s",
    (text) => {
      expect(() => parseImageTranslation(text, true)).toThrow("缺少有效原文");
    },
  );

  it.each(['{"source":"Hello"}', '{"source":"Hello","translation":123}'])(
    "rejects missing or non-text translation: %s",
    (text) => {
      expect(() => parseImageTranslation(text, true)).toThrow("缺少有效译文");
    },
  );
});
