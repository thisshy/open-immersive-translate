import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import {
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  configSchema,
  migrateConfig,
  serviceConfigSchema,
} from "../../src/shared/config";

describe("configuration migration", () => {
  it("fills sidebar reading settings without changing an existing service", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      service: "google",
      sidePanel: {
        enabled: true,
        service: "google",
        targetLanguage: "en",
        historyLimit: 23,
      },
    });

    expect(migrated.service).toBe("google");
    expect(migrated.sidePanel).toEqual({
      enabled: true,
      service: "google",
      targetLanguage: "en",
      historyLimit: 23,
      fontSize: 16,
      fontFamily: "system",
      theme: "system",
      sourceSpeechRate: 0.8,
      translationSpeechRate: 1,
    });
    expect(DEFAULT_CONFIG.sidePanel).toMatchObject({
      fontSize: 16,
      fontFamily: "system",
      theme: "system",
      sourceSpeechRate: 0.8,
      translationSpeechRate: 1,
    });
  });

  it("preserves independent speech speeds and rejects out-of-range settings", () => {
    const sidePanel = {
      ...DEFAULT_CONFIG.sidePanel,
      sourceSpeechRate: 0.6,
      translationSpeechRate: 1.25,
    };
    expect(migrateConfig({ ...DEFAULT_CONFIG, sidePanel }).sidePanel).toEqual(
      sidePanel,
    );
    for (const rate of [0.5, 2]) {
      expect(
        configSchema.safeParse({
          ...DEFAULT_CONFIG,
          sidePanel: {
            ...sidePanel,
            sourceSpeechRate: rate,
            translationSpeechRate: rate,
          },
        }).success,
      ).toBe(true);
    }
    for (const rate of [0.4, 2.1, Infinity, NaN]) {
      for (const key of ["sourceSpeechRate", "translationSpeechRate"]) {
        expect(
          configSchema.safeParse({
            ...DEFAULT_CONFIG,
            sidePanel: { ...sidePanel, [key]: rate },
          }).success,
        ).toBe(false);
      }
    }
  });

  it("preserves sidebar appearance choices and validates the readable size range", () => {
    for (const fontSize of [14, 24]) {
      const sidePanel = {
        ...DEFAULT_CONFIG.sidePanel,
        fontSize,
        fontFamily: "song" as const,
        theme: "dark" as const,
      };
      expect(migrateConfig({ ...DEFAULT_CONFIG, sidePanel }).sidePanel).toEqual(
        sidePanel,
      );
    }
    for (const fontSize of [13, 25, 16.5]) {
      expect(
        configSchema.safeParse({
          ...DEFAULT_CONFIG,
          sidePanel: { ...DEFAULT_CONFIG.sidePanel, fontSize },
        }).success,
      ).toBe(false);
    }
  });

  it("defaults to ChatGPT OAuth and migrates existing service choices once", () => {
    expect(DEFAULT_CONFIG.service).toBe("chatgpt");
    expect(DEFAULT_CONFIG.sidePanel.service).toBe("chatgpt");
    const previous = {
      ...DEFAULT_CONFIG,
      version: 3,
      service: "google",
      sidePanel: {
        ...DEFAULT_CONFIG.sidePanel,
        service: "openai-compatible",
        targetLanguage: "en" as const,
        historyLimit: 23,
      },
      services: {
        ...DEFAULT_CONFIG.services,
        chatgpt: {
          kind: "chatgpt" as const,
          enabled: true,
          model: "gpt-5.6-sol",
        },
      },
    };
    const migrated = migrateConfig(previous);
    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.service).toBe("chatgpt");
    expect(migrated.sidePanel).toMatchObject({
      service: "chatgpt",
      targetLanguage: "en",
      historyLimit: 23,
    });
    expect(migrated.services.chatgpt).toMatchObject(previous.services.chatgpt);
    expect(migrateConfig({ ...migrated, service: "google" }).service).toBe(
      "google",
    );
  });

  it("applies and validates ChatGPT reasoning defaults", () => {
    expect(serviceConfigSchema.parse({ kind: "chatgpt" })).toMatchObject({
      reasoningEffort: "low",
      reasoningEffortAssistant: "medium",
    });
    expect(() =>
      serviceConfigSchema.parse({
        kind: "chatgpt",
        reasoningEffort: "minimal",
      }),
    ).toThrow();
  });

  it("upgrades legacy phase-one UI fields without losing service settings", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 1,
      services: {
        google: { kind: "google", enabled: true },
        custom: {
          kind: "custom-http",
          enabled: true,
          baseUrl: "https://example.com/translate",
        },
      },
      shortcuts: {
        "toggle-translate": "Alt+Q",
        "toggle-whole-page": "Alt+E",
      },
      subtitle: {
        youtube: false,
        style: {
          mode: "translation",
          fontSize: 28,
          color: "#112233",
          background: "#010203",
          position: "top",
        },
      },
      pdf: { autoOpenOnline: true, translationMode: "translation" },
      globalCss: ".imt-target { color: red; }",
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.services.custom).toMatchObject({
      kind: "custom-http",
      enabled: true,
    });
    expect(migrated.services.gemini).toEqual({
      kind: "gemini",
      enabled: false,
    });
    expect(migrated.services.chatgpt).toEqual({
      kind: "chatgpt",
      enabled: false,
      reasoningEffort: "low",
      reasoningEffortAssistant: "medium",
    });
    expect(migrated.shortcuts.toggleTranslatePage).toBe("Alt+Q");
    expect(migrated.subtitle).toMatchObject({
      youtube: false,
      mode: "translation-only",
      fontSize: 28,
      sourceColor: "#112233",
      translationColor: "#112233",
      backgroundColor: "#010203",
      position: "top",
    });
    expect(migrated.pdf).toMatchObject({
      interceptLinks: true,
      mode: "translation",
    });
    expect(migrated.globalCustomCss).toContain("color: red");
  });

  it("fills ChatGPT reasoning defaults when migrating an existing config", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 2,
      services: {
        ...DEFAULT_CONFIG.services,
        chatgpt: { kind: "chatgpt", enabled: true, model: "gpt-5.5" },
      },
    });

    expect(migrated.services.chatgpt).toMatchObject({
      enabled: true,
      model: "gpt-5.5",
      reasoningEffort: "low",
      reasoningEffortAssistant: "medium",
    });
  });
});
