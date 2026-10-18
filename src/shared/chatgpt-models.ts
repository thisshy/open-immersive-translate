/** Current Codex sign-in models, also used when the account catalog is unavailable. */
export const DEFAULT_CHATGPT_MODEL = "gpt-6.1-sol";
export const CHATGPT_FALLBACK_MODELS = [
  DEFAULT_CHATGPT_MODEL,
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;
