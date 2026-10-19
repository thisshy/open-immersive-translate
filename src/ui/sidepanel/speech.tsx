import { useEffect, useRef, useState } from "preact/hooks";
import { detectLang, normalizeLang } from "../../shared/lang";
import { Button } from "../shared/components";
import { t } from "../shared/i18n";

interface SpeechButtonProps {
  text: string;
  language: string;
  label: string;
  disabled?: boolean;
  rate?: number;
  rateLabel?: string;
  onRateChange?: (rate: number) => void;
}

const SPEECH_RATES = [0.5, 0.6, 0.75, 0.8, 0.9, 1, 1.25, 1.5, 2];

interface ActiveSpeech {
  owner: symbol;
  utterance: SpeechSynthesisUtterance;
  engine: SpeechSynthesis;
}

let activeSpeech: ActiveSpeech | undefined;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function stopSpeech(owner?: symbol): void {
  if (!activeSpeech || (owner && activeSpeech.owner !== owner)) return;
  const previous = activeSpeech;
  activeSpeech = undefined;
  previous.utterance.onend = null;
  previous.utterance.onerror = null;
  previous.engine.cancel();
  notifyListeners();
}

function speechEngine(): SpeechSynthesis | undefined {
  return typeof speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
    ? speechSynthesis
    : undefined;
}

function languageForSpeech(text: string, language: string): string {
  let normalized = normalizeLang(language);
  if (normalized === "auto") normalized = detectLang(text);
  if (normalized === "auto") {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
      normalized = "ja";
    } else if (/\p{Script=Hangul}/u.test(text)) {
      normalized = "ko";
    } else if (/\p{Script=Han}/u.test(text)) {
      normalized = "zh-CN";
    } else {
      normalized = "en";
    }
  }
  const locales: Record<string, string> = {
    en: "en-US",
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    ja: "ja-JP",
    ko: "ko-KR",
    fr: "fr-FR",
    de: "de-DE",
    es: "es-ES",
    ru: "ru-RU",
    pt: "pt-PT",
    it: "it-IT",
    ar: "ar-SA",
    vi: "vi-VN",
    th: "th-TH",
  };
  return locales[normalized] ?? "en-US";
}

function voiceForLanguage(
  voices: SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice | undefined {
  const locale = language.toLowerCase();
  const base = locale.split("-")[0];
  // Local system voices keep the text on this device and need no API quota.
  const localVoices = voices.filter((voice) => voice.localService);
  return (
    localVoices.find((voice) => voice.lang.toLowerCase() === locale) ??
    localVoices.find((voice) => voice.lang.toLowerCase().split("-")[0] === base)
  );
}

function speechError(error: string): string {
  if (error === "not-allowed") return "浏览器未允许朗读，请再点击一次。";
  if (error === "language-unavailable" || error === "voice-unavailable") {
    return "系统没有可用的对应语言语音，请检查系统语音设置。";
  }
  if (error === "text-too-long") return "这段文字过长，请分段朗读。";
  return "朗读失败，请检查系统声音后重试。";
}

/** Shared ownership keeps source and translation playback mutually exclusive. */
export function SpeechButton({
  text,
  language,
  label,
  disabled = false,
  rate = 1,
  rateLabel,
  onRateChange,
}: SpeechButtonProps) {
  const owner = useRef(Symbol("side-panel-speech")).current;
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const engine = speechEngine();
  const [voices, setVoices] = useState(() => engine?.getVoices() ?? []);
  const speechLanguage = languageForSpeech(text, language);
  const voice = voiceForLanguage(voices, speechLanguage);
  const unavailable = !engine
    ? "当前浏览器不支持朗读。"
    : !voices.length
      ? "系统语音正在加载；若一直不可用，请检查系统语音设置。"
      : !voice
        ? "系统未安装此语言的本地语音，请在系统语音设置中添加。"
        : undefined;

  useEffect(() => {
    const update = () => setActive(activeSpeech?.owner === owner);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
      stopSpeech(owner);
    };
  }, [owner]);

  useEffect(() => {
    if (!engine) return;
    const update = () => setVoices(engine.getVoices());
    engine.addEventListener("voiceschanged", update);
    update();
    return () => engine.removeEventListener("voiceschanged", update);
  }, [engine]);

  useEffect(() => {
    setError("");
    return () => stopSpeech(owner);
  }, [owner, text, language]);

  function startSpeech(nextRate: number): void {
    if (!engine || !voice || !text.trim() || disabled) return;

    stopSpeech();
    setError("");
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = speechLanguage;
    utterance.voice = voice;
    utterance.rate = nextRate;
    const speech = { owner, utterance, engine };
    activeSpeech = speech;
    utterance.onend = () => {
      if (activeSpeech !== speech) return;
      activeSpeech = undefined;
      notifyListeners();
    };
    utterance.onerror = (event) => {
      if (activeSpeech !== speech) return;
      activeSpeech = undefined;
      notifyListeners();
      if (event.error !== "canceled" && event.error !== "interrupted") {
        setError(speechError(event.error));
      }
    };
    notifyListeners();
    try {
      engine.speak(utterance);
    } catch {
      if (activeSpeech === speech) {
        activeSpeech = undefined;
        notifyListeners();
        setError("朗读失败，请检查系统声音后重试。");
      }
    }
  }

  function toggleSpeech(): void {
    if (activeSpeech?.owner === owner) stopSpeech(owner);
    else startSpeech(rate);
  }

  return (
    <span class="side-speech-control">
      <span class="side-speech-actions">
        <Button
          variant="quiet"
          class="side-speech-button"
          aria-label={active ? `停止${label}` : label}
          aria-pressed={active}
          disabled={!active && (disabled || !text.trim() || !!unavailable)}
          title={unavailable ?? label}
          onClick={toggleSpeech}
        >
          {active ? "停止朗读" : "朗读"}
        </Button>
        {onRateChange && (
          <select
            class="side-speech-rate"
            aria-label={rateLabel ?? `${label} ${t("side.speechRate")}`}
            title={t("side.speechRateHint")}
            value={String(rate)}
            disabled={disabled}
            onChange={(event) => {
              const nextRate = Number(event.currentTarget.value);
              onRateChange(nextRate);
              // Re-create the utterance: voices need not apply rate changes mid-playback.
              if (activeSpeech?.owner === owner) startSpeech(nextRate);
            }}
          >
            {[...new Set([...SPEECH_RATES, rate])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
          </select>
        )}
      </span>
      {error && (
        <small role="alert" class="side-speech-error">
          {error}
        </small>
      )}
    </span>
  );
}
