import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NutritionFunctionCall, NutritionFunctionDefinition } from "./function-calling.js";
import { NutritionGenerationError } from "./errors.js";
import type { NutritionPromptRequest } from "./prompts.js";

export interface NutritionProviderCompletion {
  content: Record<string, unknown>;
  toolCalls: NutritionFunctionCall[];
  model: string;
}

export interface NutritionProvider {
  name: "deepseek";
  model: string;
  complete(
    prompt: NutritionPromptRequest,
    functions?: readonly NutritionFunctionDefinition[],
  ): Promise<NutritionProviderCompletion>;
}

export interface DeepSeekNutritionProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface DeepSeekNutritionEnvironmentOptions {
  env?: Readonly<Record<string, string | undefined>>;
  readKeyFile?: (path: string) => string;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseContent(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 20000) {
    throw new Error("The provider response did not include JSON content.");
  }
  const clean = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const parsed = JSON.parse(clean) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("The provider response must be one JSON object.");
  }
  return parsed;
}

function parseToolCalls(value: unknown): NutritionFunctionCall[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error("The provider returned invalid function calls.");
  }
  return value.map((raw) => {
    if (!isRecord(raw) || !isRecord(raw.function)) {
      throw new Error("The provider returned an invalid function call.");
    }
    const name = raw.function.name;
    const argumentsText = raw.function.arguments;
    if (typeof name !== "string" || typeof argumentsText !== "string" || argumentsText.length > 10000) {
      throw new Error("The provider returned an invalid function call.");
    }
    const parsedArguments = JSON.parse(argumentsText) as unknown;
    if (!isRecord(parsedArguments)) {
      throw new Error("Function arguments must be one JSON object.");
    }
    return { name, arguments: parsedArguments };
  });
}

function providerStatusError(status: number): NutritionGenerationError {
  if (status === 429) {
    return new NutritionGenerationError(
      "rate_limited",
      "Online meal generation is busy. Haleview will use a saved or local result.",
      429,
      true,
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new NutritionGenerationError(
      "provider_rejected",
      "Online meal generation is not configured correctly. Haleview will use a local result.",
      503,
      false,
      status,
    );
  }
  return new NutritionGenerationError(
    status >= 500 ? "network_error" : "provider_rejected",
    "Online meal generation is not available. Haleview will use a saved or local result.",
    status >= 500 ? 503 : 502,
    status >= 500,
    status,
  );
}

function malformedResponseError(): NutritionGenerationError {
  return new NutritionGenerationError(
    "malformed_response",
    "Online meal generation returned an invalid response. Haleview will use a saved or local result.",
    502,
    true,
  );
}

export function createDeepSeekNutritionProvider(options: DeepSeekNutritionProviderOptions): NutritionProvider {
  const apiKey = options.apiKey.trim();
  const baseUrl = options.baseUrl.trim().replace(/\/$/u, "");
  const model = options.model.trim();
  if (!apiKey || !baseUrl || !model) {
    throw new Error("DeepSeek provider settings are incomplete.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10 || options.timeoutMs > 120000) {
    throw new Error("DeepSeek timeout must be from 10 to 120000 milliseconds.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "deepseek",
    model,
    async complete(prompt, functions = []) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      let responseReceived = false;
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            thinking: { type: "disabled" },
            temperature: prompt.settings.temperature,
            top_p: prompt.settings.topP,
            max_tokens: prompt.settings.maxTokens,
            response_format: { type: "json_object" },
            messages: prompt.messages,
            ...(functions.length > 0 ? {
              tools: functions.map((definition) => ({
                type: "function",
                function: definition,
              })),
              tool_choice: "auto",
            } : {}),
          }),
          signal: controller.signal,
        });
        responseReceived = true;
        if (!response.ok) {
          throw providerStatusError(response.status);
        }
        const body = await response.json() as unknown;
        if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
          throw new Error("The provider response has no choice.");
        }
        if (body.choices[0].finish_reason === "length") {
          throw new Error("The provider response was truncated.");
        }
        const message = body.choices[0].message;
        if (!isRecord(message)) {
          throw new Error("The provider response has no message.");
        }
        const toolCalls = parseToolCalls(message.tool_calls);
        const toolOnly = toolCalls.length > 0 && (message.content === null || message.content === undefined
          || (typeof message.content === "string" && message.content.length <= 20000 && message.content.trim() === ""));
        return {
          content: toolOnly ? {} : parseContent(message.content),
          toolCalls,
          model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : model,
        };
      } catch (error) {
        if (error instanceof NutritionGenerationError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new NutritionGenerationError(
            "timed_out",
            "Online meal generation took too long. Haleview will use a saved or local result.",
            504,
            true,
          );
        }
        if (!responseReceived && error instanceof TypeError) {
          throw new NutritionGenerationError(
            "network_error",
            "Online meal generation could not connect. Haleview will use a saved or local result.",
            503,
            true,
          );
        }
        throw malformedResponseError();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createDeepSeekNutritionProviderFromEnv(
  options: DeepSeekNutritionEnvironmentOptions = {},
): NutritionProvider | null {
  const env = options.env ?? process.env;
  const keyFile = env.DEEPSEEK_API_KEY_FILE?.trim();
  let apiKey = env.DEEPSEEK_API_KEY?.trim() ?? "";
  if (keyFile) {
    try {
      const readKeyFile = options.readKeyFile ?? ((path: string) => readFileSync(path, "utf8"));
      apiKey = readKeyFile(resolve(keyFile)).trim();
    } catch {
      return null;
    }
  }
  const model = env.DEEPSEEK_MODEL?.trim() ?? "";
  if (!apiKey || !model) {
    return null;
  }
  const timeoutValue = Number(env.DEEPSEEK_TIMEOUT_MS ?? 55000);
  const timeoutMs = Number.isInteger(timeoutValue) && timeoutValue >= 1000 && timeoutValue <= 120000
    ? timeoutValue
    : 55000;
  return createDeepSeekNutritionProvider({
    apiKey,
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    model,
    timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
