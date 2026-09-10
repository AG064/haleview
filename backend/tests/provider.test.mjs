import {after, test} from "node:test";
import assert from "node:assert/strict";
import {cleanup, preferences} from "./environment.mjs";

const {buildNutritionPrompt, nutritionPromptDefinitions} = await import("../dist/nutrition/prompts.js");
const {createDeepSeekNutritionProvider} = await import("../dist/nutrition/provider.js");
const {generateMealDraft} = await import("../dist/nutrition/generation.js");
const {NutritionGenerationError} = await import("../dist/nutrition/errors.js");
const {GenerationCache} = await import("../dist/nutrition/cache.js");
after(cleanup);

test("each planning prompt receives the preceding result, examples and task settings", () => {
  assert.equal(nutritionPromptDefinitions.length, 5);
  let previous;
  for (const definition of nutritionPromptDefinitions) {
    const prompt = buildNutritionPrompt(definition.name, {preferences}, previous);
    const payload = JSON.parse(prompt.messages.at(-1).content);
    assert.deepEqual(payload.previousOutput, previous?.output);
    assert.ok(prompt.messages.some(message => message.role === "assistant"));
    assert.ok(prompt.settings.temperature >= 0 && prompt.settings.temperature <= 1);
    assert.equal(prompt.settings.topP, 1);
    previous = {step: definition.name, output: {checked: definition.name}};
  }
  assert.throws(() => buildNutritionPrompt("recipe_generation", {}));
});

const prompt = buildNutritionPrompt("profile_assessment", {calorieTargetKcal: 2000});
const provider = (fetchImpl, timeoutMs = 1000) => createDeepSeekNutritionProvider({apiKey: "fixture-key", baseUrl: "https://provider.example", model: "fixture-model", timeoutMs, fetchImpl});

test("provider sends model parameters and accepts validated JSON", async () => {
  let body;
  const result = await provider(async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({choices: [{finish_reason: "stop", message: {content: '{"strategy":"Use the saved targets."}'}}]}));
  }).complete(prompt);
  assert.equal(body.model, "fixture-model");
  assert.equal(body.temperature, prompt.settings.temperature);
  assert.equal(body.top_p, prompt.settings.topP);
  assert.equal(result.content.strategy, "Use the saved targets.");
});

for (const [name, fetchImpl, code] of [
  ["rate limit", async () => new Response("", {status: 429}), "rate_limited"],
  ["network failure", async () => { throw new TypeError("Connection unavailable"); }, "network_error"],
  ["malformed response", async () => new Response("not JSON"), "malformed_response"],
]) {
  test(`provider reports a stable error for ${name}`, async () => {
    await assert.rejects(provider(fetchImpl).complete(prompt), error => error.code === code && error.recoverable === true);
  });
}

test("provider timeout aborts the pending request", async () => {
  const stalled = provider((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
  }), 10);
  await assert.rejects(stalled.complete(prompt), error => error.code === "timed_out");
});

test("an unavailable provider falls back to locally validated selections", async () => {
  const failing = {name: "fixture", complete: async () => { throw new NutritionGenerationError("network_error", "Offline", 503, true); }};
  const result = await generateMealDraft({preferences, health: {bmi: 24, activityLevel: "moderate", fitnessGoal: "general_fitness"}}, {provider: failing});
  assert.equal(result.source, "local");
  assert.equal(result.fallbackReason, "network_error");
  assert.ok(result.selections.length > 0);
});

test("cached values are isolated from mutations and expire", () => {
  let now = 0;
  const cache = new GenerationCache({maxEntries: 2, ttlMs: 100, now: () => now});
  cache.set("meal", {value: 1});
  const value = cache.get("meal");
  value.value = 99;
  assert.equal(cache.get("meal").value, 1);
  now = 100;
  assert.equal(cache.get("meal"), null);
});
