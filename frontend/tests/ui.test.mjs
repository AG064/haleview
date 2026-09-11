import {after, test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {build} from "esbuild";

const directory = mkdtempSync(join(tmpdir(), "haleview-ui-test-"));
const output = join(directory, "components.cjs");
await build({
  stdin: {contents: `
    export {createElement} from "react";
    export {renderToStaticMarkup} from "react-dom/server";
    export {AppShell} from "./components/AppShell";
    export {PageDataState} from "./components/PageDataState";
    export {ProfileSetupScreen} from "./screens/ProfileSetupScreen";
    export {DashboardOverview, HaleScreen} from "./screens/DashboardScreens";
    export {CombineRecipeIcon} from "./components/CombineRecipeIcon";
    export {HaleChatChart} from "./components/HaleChatChart";
    export {HaleChatTurn} from "./components/HaleChat";
    export {initialForm, initialPrivacy} from "./app-data";
    export {displayDate, displayDateOnly, localDateTimeValue} from "./format";
  `, resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), loader: "tsx"},
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
const require = createRequire(import.meta.url);
const ui = require(output);
const render = (component, props) => ui.renderToStaticMarkup(ui.createElement(component, props));
after(() => {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("haleview-ui-test-")) throw new Error("Unexpected test directory.");
  rmSync(directory, {recursive: true, force: true});
});

test("signed-in dashboard does not show empty-day advice while requests are pending", () => {
  const html = render(ui.DashboardOverview, {signedIn: true, profile: {...ui.initialForm, analytics: {wellnessScore: 60, goalProgress: 50}}, history: {activities: []}, request: async () => {}, recommendations: null});
  assert.ok(html.includes("Loading your day."));
  assert.ok(!html.includes("Record a meal"));
  assert.ok(!html.includes("No meal plan for today"));
});

test("loading and error states have different accessible content", () => {
  const loading = render(ui.PageDataState, {title: "Recipes", view: "recipes", loading: true});
  assert.ok(loading.includes('role="status"') && loading.includes('aria-busy="true"'));
  assert.ok(loading.includes('aria-hidden="true"') && loading.includes("skeleton-recipes"));
  assert.ok(!loading.includes("Retry"));
  const failed = render(ui.PageDataState, {title: "Recipes", loading: false, error: "Service unavailable"});
  assert.ok(failed.includes('role="alert"') && failed.includes("Retry"));
  assert.ok(!failed.includes("skeleton-recipes"));
});

test("Hale has one labelled navigation entry and only the correct page is active", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {documentElement: {dataset: {theme: "light"}}};
  try {
    const html = render(ui.AppShell, {route: "hale", hasProfile: true, guestMode: false, signedIn: true});
    assert.equal((html.match(/<span>Hale<\/span>/g) ?? []).length, 1);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.ok(html.includes("hale-nav"));
  } finally { globalThis.document = previousDocument; }
});

test("Hale separates chat and guidance into accessible views with chat selected first", () => {
  const html = render(ui.HaleScreen, {
    guidance: {
      generatedAt: "2026-09-11T10:00:00Z",
      profileUpdatedAt: "2026-09-11T09:00:00Z",
      source: "local",
      goal: "wellbeing",
      items: [],
      summaries: {weekly: "No weekly summary yet.", monthly: "No monthly summary yet."},
    },
    allowOnlineAi: false,
    recommendationRefreshing: false,
    onRefresh: () => {},
    request: async () => {},
  });
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('aria-label="Hale views"'));
  const chatTab = html.match(/<button[^>]*id="hale-chat-tab"[^>]*>/)?.[0];
  const guidanceTab = html.match(/<button[^>]*id="hale-guidance-tab"[^>]*>/)?.[0];
  assert.ok(chatTab?.includes('aria-selected="true"') && chatTab.includes('tabindex="0"'));
  assert.ok(guidanceTab?.includes('aria-selected="false"') && guidanceTab.includes('tabindex="-1"'));
  assert.match(html, /aria-labelledby="hale-chat-tab"[^>]*id="hale-chat-panel"[^>]*role="tabpanel"/);
  assert.match(html, /aria-labelledby="hale-guidance-tab"[^>]*hidden=""[^>]*id="hale-guidance-panel"[^>]*role="tabpanel"/);
});

test("guest AI permission is explained, disabled and cannot appear checked", () => {
  const html = render(ui.ProfileSetupScreen, {form: ui.initialForm, privacy: {...ui.initialPrivacy, dataForRecommendations: true}, profile: null, profileStep: 3, furthestProfileStep: 3, guestMode: true, signedIn: false, onlineAiAvailable: true, saving: false});
  assert.ok(html.includes("Online AI requires an account"));
  assert.ok(html.includes("Guest mode: Online AI is off."));
  const checkbox = html.match(/<input[^>]*aria-describedby="guest-ai-explanation"[^>]*>/)?.[0];
  assert.ok(checkbox?.includes('disabled=""'));
  assert.ok(!checkbox.includes('checked=""'));
});

test("rendered API messages remain text rather than executable markup", () => {
  const html = render(ui.PageDataState, {title: "Recipes", loading: false, error: '<img src=x onerror="alert(1)">'});
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

test("dates use ISO strings and preserve the requested timezone", () => {
  assert.equal(ui.displayDate("2026-01-10T10:00:00+02:00"), "2026-01-10T08:00:00.000Z");
  assert.equal(ui.displayDateOnly("2026-01-10T08:00:00Z"), "2026-01-10");
  assert.equal(ui.localDateTimeValue(new Date("2026-01-10T08:00:00Z"), "Europe/Tallinn"), "2026-01-10T10:00");
});

test("Combine uses a scalable decorative SVG rather than a text character", () => {
  const html = render(ui.CombineRecipeIcon);
  assert.ok(html.includes('viewBox="0 0 24 24"'));
  assert.ok(html.includes('aria-hidden="true"'));
  assert.equal((html.match(/<circle /g) ?? []).length, 2);
});

test("Hale renders line, bar and pie chart values as accessible text", () => {
  for(const type of ["line","bar","pie"]){
    const html=render(ui.HaleChatChart,{chart:{type,title:`${type} example`,unit:"g",description:"Saved values",items:[{label:"Recorded",value:31,detail:"31 g"},{label:"Target",value:100,detail:"100 g"}]}});
    assert.ok(html.includes(`${type} example`));
    assert.ok(html.includes("Saved values"));
    assert.ok(html.includes("Recorded"));
    assert.ok(html.includes("31 g"));
    assert.ok(html.includes('role="img"'));
  }
});

test("Hale chat renders a compact user message and a labelled assistant reply", () => {
  const html = render(ui.HaleChatTurn, {
    turn: {
      id: "turn-1",
      message: "How is my progress?",
      createdAt: "2026-09-11T10:00:00Z",
      mode: "detailed",
      reply: {
        text: "Your saved progress is available.",
        sections: [{title: "Saved values", lines: ["Weight: 72 kg"]}],
        source: "local",
        notice: null,
      },
    },
    onSuggestion: () => {},
  });
  assert.match(html, /class="hale-chat-message hale-chat-user" aria-label="Your message"/);
  assert.match(html, /class="hale-chat-message hale-chat-answer" aria-label="Hale&#x27;s reply"/);
  assert.ok(html.includes("hale-chat-avatar"));
  assert.ok(html.includes("Saved data and guidance · Detailed"));
  assert.ok(html.includes("Weight: 72 kg"));
});
