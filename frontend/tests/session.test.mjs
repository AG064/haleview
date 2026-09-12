import {after, test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";
import {build} from "esbuild";

const directory = mkdtempSync(join(tmpdir(), "haleview-session-test-"));
const output = join(directory, "api.mjs");
await build({entryPoints:[fileURLToPath(new URL("../src/api.ts", import.meta.url))], bundle:true, platform:"node", format:"esm", outfile:output, logLevel:"silent"});
const {ApiError, createAuthenticatedSession} = await import(pathToFileURL(output).href);
after(() => {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("haleview-session-test-")) throw new Error("Unexpected test directory.");
  rmSync(directory, {recursive:true, force:true});
});

function fixture(refreshOperation) {
  const state = {version:1, access:"account-a", refresh:"refresh-a", clears:0, refreshes:0};
  const session = createAuthenticatedSession({
    getSessionVersion:() => state.version,
    getAccessToken:() => state.access,
    getRefreshToken:() => state.refresh,
    refresh:async token => { state.refreshes++; return refreshOperation ? refreshOperation(token) : {accessToken:"renewed-a", refreshToken:"renewed-refresh-a", accessTokenExpiresIn:900}; },
    applyTokens:tokens => { state.access=tokens.accessToken; state.refresh=tokens.refreshToken; },
    clearSession:() => { state.clears++; state.access=null; state.refresh=null; },
  });
  return {state, session, switchAccount:() => { state.version++; state.access="account-b"; state.refresh="refresh-b"; }};
}

test("a pending request cannot be replayed under a different account", async () => {
  const {state, session, switchAccount} = fixture();
  let reject;
  const tokens=[];
  const pending=session.request(token => { tokens.push(token); return new Promise((_resolve, fail) => { reject=fail; }); });
  switchAccount();
  reject(new ApiError(401, "Session ended"));
  await assert.rejects(pending, error => error.status===401);
  assert.deepEqual(tokens,["account-a"]);
  assert.equal(state.refreshes,0);
  assert.equal(state.access,"account-b");
});

test("late success and failed refresh cannot replace or clear a new account", async () => {
  let finish;
  const first=fixture();
  const pending=first.session.request(() => new Promise(resolve => { finish=resolve; }));
  first.switchAccount();
  finish({privateData:"account-a"});
  await assert.rejects(pending,error => error.status===401);
  let rejectRefresh;
  const second=fixture(() => new Promise((_resolve,reject) => { rejectRefresh=reject; }));
  const refreshing=second.session.refresh();
  second.switchAccount();
  rejectRefresh(new ApiError(401,"Old refresh expired"));
  await assert.rejects(refreshing);
  assert.equal(second.state.access,"account-b");
  assert.equal(second.state.clears,0);
});

test("concurrent requests in one session share a refresh and retry normally", async () => {
  const {state,session}=fixture();
  const operation=async token => {if(token==="account-a")throw new ApiError(401,"Expired");return token;};
  assert.deepEqual(await Promise.all([session.request(operation),session.request(operation)]),["renewed-a","renewed-a"]);
  assert.equal(state.refreshes,1);
});
