import type { LangCode } from "./types";

export const ASSISTANT_PORT_NAME = "imt:assistant";

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantRequest {
  kind: "translate" | "chat" | "writing" | "dictionary";
  text: string;
  service: string;
  from?: LangCode;
  to?: LangCode;
  instruction?: string;
  history?: AssistantChatMessage[];
}

export interface AssistantClient {
  complete(request: AssistantRequest, signal?: AbortSignal): Promise<string>;
  supportsStreaming?(serviceId: string): Promise<boolean>;
  stream?(
    request: AssistantRequest,
    onPartial: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

interface AssistantResponse {
  text: string;
}

interface AssistantPortResponse {
  type: "assistantPartial";
  requestId: string;
  text?: string;
  done: boolean;
  error?: string;
}

interface RuntimePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: { addListener(listener: () => void): void };
}

interface RuntimeApi {
  readonly lastError?: { message?: string };
  sendMessage(message: unknown): Promise<unknown>;
  connect(options: { name: string }): RuntimePort;
}

function runtimeApi(): RuntimeApi {
  const runtime = (
    globalThis as unknown as { chrome?: { runtime?: RuntimeApi } }
  ).chrome?.runtime;
  if (!runtime) throw new Error("Extension runtime is unavailable.");
  return runtime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseText(value: unknown): string {
  if (isRecord(value) && typeof value.text === "string") return value.text;
  throw new Error("Assistant returned an invalid response.");
}

function randomId(): string {
  return `assistant-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function abortError(): DOMException {
  return new DOMException("Assistant request cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function requestOverPort(
  request: AssistantRequest,
  onPartial: ((text: string) => void) | undefined,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    throwIfAborted(signal);
    const requestId = randomId();
    const port = runtimeApi().connect({ name: ASSISTANT_PORT_NAME });
    let complete = false;
    let latestText = "";

    const finish = (error?: Error): void => {
      if (complete) return;
      complete = true;
      signal?.removeEventListener("abort", onAbort);
      port.onMessage.removeListener(onMessage);
      // Disconnecting releases the background request's AbortController.
      try {
        port.disconnect();
      } catch {
        // A concurrently closed worker port is already disconnected.
      }
      if (error) reject(error);
      else resolve(latestText);
    };
    const onAbort = (): void => finish(abortError());
    const onMessage = (message: unknown): void => {
      if (!isRecord(message) || message.type !== "assistantPartial") return;
      const partial = message as unknown as AssistantPortResponse;
      if (partial.requestId !== requestId) return;
      if (partial.error) {
        finish(new Error(partial.error));
        return;
      }
      if (typeof partial.text === "string") {
        latestText = partial.text;
        onPartial?.(partial.text);
      }
      if (partial.done) finish();
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      // Chrome requires reading lastError even when we initiated disconnect.
      const error = runtimeApi().lastError;
      if (complete) return;
      complete = true;
      signal?.removeEventListener("abort", onAbort);
      port.onMessage.removeListener(onMessage);
      reject(new Error(error?.message ?? "Assistant stream disconnected."));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    port.postMessage({
      type: "assistantRequest",
      requestId,
      request,
      stream: onPartial !== undefined,
    });
  });
}

/** Runtime-backed assistant client. Background wiring is documented for integration. */
export function createAssistantClient(): AssistantClient {
  return {
    async complete(request, signal) {
      // A port gives non-streaming adapters the same cancellation lifecycle.
      if (signal) return requestOverPort(request, undefined, signal);
      const response: unknown = await runtimeApi().sendMessage({
        type: "assistantRequest",
        request,
      });
      return responseText(response as AssistantResponse);
    },
    async supportsStreaming(serviceId) {
      const response: unknown = await runtimeApi().sendMessage({
        type: "getAssistantCapabilities",
        serviceId,
      });
      return (
        isRecord(response) &&
        typeof response.streaming === "boolean" &&
        response.streaming
      );
    },
    stream: requestOverPort,
  };
}

/** Probe capabilities before dispatch; never silently resend a started request. */
export async function runAssistant(
  client: AssistantClient,
  request: AssistantRequest,
  onPartial?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  if (onPartial && client.stream && client.supportsStreaming) {
    let streaming = false;
    try {
      streaming = await client.supportsStreaming(request.service);
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw abortError();
      }
      // Capability discovery did not submit model work, so fallback is safe.
    }
    throwIfAborted(signal);
    if (streaming) return client.stream(request, onPartial, signal);
  }
  throwIfAborted(signal);
  const text = await client.complete(request, signal);
  throwIfAborted(signal);
  onPartial?.(text);
  return text;
}
