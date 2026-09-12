import {after, before, test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {cleanup, profileInput} from "./environment.mjs";

const {default: app} = await import("../dist/app.js");
const {getLatestEmail} = await import("../dist/auth.js");
let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); await cleanup(); });

async function request(path, body, token, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, {method, headers: {"Content-Type": "application/json", ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, body: await response.json(), retryAfter: response.headers.get("Retry-After")};
}
async function account() {
  const credentials = {email: `test-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}!`};
  const registered = await request("/api/auth/register", credentials);
  assert.equal(registered.status, 201);
  await request(`/api/auth/verify${new URL(getLatestEmail().link).search}`);
  const session = await request("/api/auth/login", credentials);
  assert.equal(session.status, 200);
  return session.body.accessToken;
}

test("public health and catalogue work while private endpoints require sign-in", async () => {
  assert.equal((await request("/health")).body.status, "ok");
  assert.ok((await request("/api/nutrition/recipes?limit=1")).body.total >= 500);
  for (const path of ["/api/profile", "/api/nutrition/plans", "/api/nutrition/intake", "/api/nutrition/favourites"]) {
    assert.equal((await request(path)).status, 401);
  }
});

test("profile reuse, saved preferences and recipe collections remain private", async () => {
  const first = await account();
  const second = await account();
  const privacy = {consentGiven: true, dataForRecommendations: false, publicVisibility: "private", emailNotifications: false};
  const saved = await request("/api/profile", {...profileInput, privacy}, first, "PUT");
  assert.equal(saved.status, 200);
  const defaults = await request("/api/nutrition/defaults", undefined, first);
  assert.deepEqual(defaults.body.preferences.dietaryPreferences, profileInput.dietaryPreferences);
  assert.ok(defaults.body.preferences.allergies.includes("peanuts"));
  const otherProfile = await request("/api/profile", undefined, second);
  assert.equal(otherProfile.body.profile, null);
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await request("/api/nutrition/favourites/recipe-000523", {}, first, "PUT")).status, 200);
  }
  assert.equal((await request("/api/nutrition/favourites", undefined, first)).body.recipes.length, 1);
  assert.equal((await request("/api/nutrition/favourites", undefined, second)).body.recipes.length, 0);
  await request("/api/nutrition/favourites/recipe-000523", undefined, second, "DELETE");
  assert.equal((await request("/api/nutrition/favourites", undefined, first)).body.recipes.length, 1);
  assert.equal((await request("/api/nutrition/favourites/missing", {}, first, "PUT")).status, 404);
  const before = await request("/api/nutrition/progress", undefined, first);
  const {emptyNutrition} = await import("../dist/nutrition/meal-plans.js");
  const intake = await request("/api/nutrition/intake", {date: before.body.progress.trend.at(-1).date, title: "Homemade snack", nutrition: {...emptyNutrition(), caloriesKcal: 150, proteinG: 10}}, first);
  assert.equal(intake.status, 201);
  const progress = await request("/api/nutrition/progress", undefined, first);
  assert.equal(progress.body.progress.today.nutrition.caloriesKcal, 150);
  assert.equal((await request("/api/nutrition/intake", undefined, second)).body.records.length, 0);
  assert.equal((await request(`/api/nutrition/intake/${intake.body.record.id}`, undefined, second, "DELETE")).status, 404);
  const idea = {mode: "describe", query: "A potato dinner", servings: 2, maxMinutes: 30};
  assert.equal((await request("/api/nutrition/creations", idea, first)).status, 503);
});

test("guest computation cannot enable online AI, sharing or email notifications", async () => {
  const {saveGuestProfile} = await import("../dist/guest.js");
  const result = saveGuestProfile({profile: profileInput, privacy: {consentGiven: true, dataForRecommendations: true, publicVisibility: "summary", emailNotifications: true}});
  assert.equal(result.privacy.dataForRecommendations, false);
  assert.equal(result.privacy.publicVisibility, "private");
  assert.equal(result.privacy.emailNotifications, false);
});

test("rate limits include a retry delay without taking down health checks", async () => {
  let response;
  for (let index = 0; index < 61; index += 1) {
    response = await request("/api/nutrition/recipes?limit=1");
    if (response.status === 429) break;
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.retryAfter) > 0);
  assert.match(response.body.error, /try again/i);
  assert.equal((await request("/health")).body.status, "ok");
});
