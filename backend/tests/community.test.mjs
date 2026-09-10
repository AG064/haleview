import {after, test} from "node:test";
import assert from "node:assert/strict";
import {cleanup} from "./environment.mjs";

const {saveNutritionFeedback, communityRecipeSignals} = await import("../dist/nutrition/feedback.js");
const {rankRecipeCandidates} = await import("../dist/nutrition/community-rag.js");
const {buildRecipeRetrievalContext} = await import("../dist/nutrition/rag.js");
after(cleanup);

const rating = (subjectId, comment = "Clear ingredients and useful preparation steps.") => ({subjectType: "recipe", subjectId, rating: "helpful", decision: "saved", stars: 5, comment});

test("community ratings raise retrieval priority and highlight verified RAG examples", () => {
  const before = rankRecipeCandidates({query: "potato"});
  assert.ok(before.length > 3);
  const selected = before[3];
  for (const userId of [801, 802, 803]) {
    const saved = saveNutritionFeedback(userId, rating(selected.recipe.id));
    assert.equal(saved.moderationStatus, "approved");
    assert.equal(saved.stars, 5);
  }
  const after = rankRecipeCandidates({query: "potato"});
  const promoted = after.find(item => item.recipe.id === selected.recipe.id);
  assert.ok(promoted.rankScore > selected.rankScore);
  assert.ok(after.indexOf(promoted) < before.indexOf(selected));
  assert.equal(promoted.community.ratingCount, 3);
  assert.equal(promoted.community.verified, true);
  const context = buildRecipeRetrievalContext("potato", {limit: 10});
  assert.ok(context.retrievedRecipes.some(item => item.recipe.id === selected.recipe.id));
  assert.ok(context.augmentedPrompt.includes("Verified: yes"));
});

test("moderation stores a reason and excludes rejected reviews from community signals", () => {
  const saved = saveNutritionFeedback(810, rating("recipe-000523", "aaaaaaaaaaaa"));
  assert.equal(saved.moderationStatus, "rejected");
  assert.ok(saved.moderationReason);
  assert.ok(!communityRecipeSignals().some(item => item.recipeId === "recipe-000523"));
  assert.throws(() => saveNutritionFeedback(810, rating("recipe-000523", "Contact me at person@example.test")), /contact details/);
});

test("one account cannot multiply its votes and personal rejection changes retrieval", () => {
  for (let index = 0; index < 3; index += 1) saveNutritionFeedback(820, rating("recipe-000524"));
  const signal = communityRecipeSignals().find(item => item.recipeId === "recipe-000524");
  assert.equal(signal.ratingCount, 1);
  assert.equal(signal.verified, false);
  saveNutritionFeedback(820, {...rating("recipe-000524"), rating: "not_helpful", decision: "rejected", stars: 1});
  assert.ok(!rankRecipeCandidates({}, 820).some(item => item.recipe.id === "recipe-000524"));
  assert.ok(rankRecipeCandidates({}).some(item => item.recipe.id === "recipe-000524"));
});
