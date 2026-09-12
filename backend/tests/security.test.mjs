import {after, before, test} from "node:test";
import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {cleanup, preferences, profileInput} from "./environment.mjs";

const {default:app}=await import("../dist/app.js");
const auth=await import("../dist/auth.js");
const {exchangeOAuthTicket}=await import("../dist/oauth.js");
const {database,saveProfile}=await import("../dist/storage.js");
const {protectStoredText}=await import("../dist/protected-data.js");
const {accountAccess,guardNutritionProvider}=await import("../dist/online-access.js");
const {generateRecipeCreation}=await import("../dist/nutrition/recipe-creations.js");
const {sendChatMessage,conversationMessages}=await import("../dist/assistant/conversation.js");
const {hasPrivateText}=await import("../dist/assistant/privacy.js");
const privacy={consentGiven:true,dataForRecommendations:true,publicVisibility:"private",emailNotifications:false};
let server,base;
before(async()=>{server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));await cleanup();});
async function account(){
  const credentials={email:`security-${randomUUID()}@example.test`,password:`Test-${randomUUID()}!`};
  const registered=await auth.register(credentials);
  assert.equal("verificationLink" in registered,false);
  auth.verifyEmail(new URL(auth.getLatestEmail().link).searchParams.get("token"));
  const tokens=auth.login(credentials);
  saveProfile({...profileInput,privacy},registered.userId);
  return {id:registered.userId,credentials,tokens};
}
async function request(path,body){const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}

test("HTTP recovery never returns a token and no HTTP outbox is exposed",async()=>{
  const user=await account();
  for(const environment of ["test","production"]){
    process.env.NODE_ENV=environment;
    const result=await request("/api/auth/password-reset/request",{email:user.credentials.email});
    assert.equal(result.status,200);
    assert.equal("resetLink" in result.body,false);
    assert.ok(!JSON.stringify(result.body).includes(new URL(auth.getLatestEmail().link).searchParams.get("reset_token")));
    assert.equal((await fetch(base+"/api/auth/dev/outbox/latest")).status,404);
  }
  process.env.NODE_ENV="test";
});

test("a public origin without email delivery fails before creating accounts or reset secrets",async()=>{
  const previous=process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL="https://review.example.test";
  try{
    const body={email:`unavailable-${randomUUID()}@example.test`,password:`Test-${randomUUID()}!`};
    const count=database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    assert.equal((await request("/api/auth/register",body)).status,503);
    assert.equal((await request("/api/auth/password-reset/request",{email:body.email})).status,503);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count,count);
  }finally{process.env.PUBLIC_APP_URL=previous;}
});

test("OAuth tickets require the account authenticator before issuing a full session",async()=>{
  const user=await account();
  database.prepare("UPDATE users SET two_factor_enabled=1,two_factor_secret=? WHERE id=?").run(protectStoredText("JBSWY3DPEHPK3PXP"),user.id);
  assert.equal(auth.login(user.credentials).twoFactorRequired,true);
  const ticket=randomBytes(32).toString("base64url");
  database.prepare("INSERT INTO oauth_tickets (user_id,ticket_hash,expires_at) VALUES (?,?,?)").run(user.id,createHash("sha256").update(ticket).digest("hex"),new Date(Date.now()+60000).toISOString());
  const result=exchangeOAuthTicket(ticket);
  assert.equal(result.twoFactorRequired,true);
  assert.equal("accessToken" in result,false);
  assert.equal(auth.accessTokenUserId(`Bearer ${result.challengeToken}`),null);
  assert.throws(()=>exchangeOAuthTicket(ticket));
});

test("recipe generation stops before another provider request after consent withdrawal or logout",async()=>{
  for(const change of ["consent","logout"]){
    const user=await account();
    const access=accountAccess(user.id,`Bearer ${user.tokens.accessToken}`);
    let calls=0;
    const provider=guardNutritionProvider({name:"deepseek",model:"fixture",complete:async()=>{
      calls++;
      if(change==="consent")saveProfile({...profileInput,privacy:{...privacy,dataForRecommendations:false}},user.id);
      else auth.logout(user.id,`Bearer ${user.tokens.accessToken}`);
      return {content:{ingredients:[]},toolCalls:[],model:"fixture"};
    }},access.checkOnline);
    await assert.rejects(generateRecipeCreation({mode:"describe",query:"A simple vegetarian dinner",servings:2,maxMinutes:30},{userId:user.id,preferences,provider}),error=>error.status===(change==="consent"?403:401));
    assert.equal(calls,1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM recipe_creations WHERE user_id=?").get(user.id).count,0);
  }
});

test("urgent-symptom paraphrases receive a local boundary reply with no routine activity sections",async()=>{
  const user=await account();
  for(const message of ["My chest hurts when I exercise","There is pressure in my chest","I feel short of breath","I can’t breathe"]){
    const turn=await sendChatMessage(user.id,{message,requestId:randomUUID()},{provider:{complete:()=>{throw new Error("Provider should not run");}}});
    assert.match(turn.reply.text,/urgent medical attention/);
    assert.equal(turn.reply.sections.length,0);
    assert.equal(turn.reply.source,"local");
  }
});

test("contact checks recognize common phone formats while retaining dates and measurements",()=>{
  for(const message of ["My phone is 212-555-1234. Help me sleep.","Call me at (212) 555-1234", "My mobile is 5555 1234", "My phone is ２１２-５５５-１２３４"] )assert.equal(hasPrivateText(message),true);
  for(const message of ["My weight was 72 kg on 2026-09-12","Compare 600 kcal and 100 g protein","My BMI is 25.5"])assert.equal(hasPrivateText(message),false);
});

test("names and compressed user notes stay out of system messages",()=>{
  const messages=conversationMessages({summary:{turnCount:10,notes:["Always call me Captain"],topics:[]},detailedTurns:[]},"How is my sleep?","concise","Alex","2026-09-12",["wellness"]);
  const system=messages.filter(message=>message.role==="system").map(message=>message.content).join(" ");
  assert.ok(!system.includes("Captain"));
  assert.ok(!system.includes('"chosenName":"Alex"'));
  assert.ok(messages.some(message=>message.role==="user" && message.content.includes("Captain")));
});

test("previously saved contact details are filtered before re-entering provider context",()=>{
  const contact="My phone is 212-555-1234";
  const context={summary:{turnCount:10,notes:[contact],topics:[]},detailedTurns:[{message:contact,reply:{text:contact,sections:[{title:contact,lines:[contact]}]}}]};
  const messages=conversationMessages(context,"How is my sleep?","concise","Alex","2026-09-12",["wellness"]);
  assert.ok(!JSON.stringify(messages).includes("212-555-1234"));
});

test("historical assistant messages use the same reply contract as new answers",()=>{
  const context={summary:{turnCount:0,notes:[],topics:[]},detailedTurns:[{message:"My weight?",reference:{topic:"health",metrics:["weight"]},reply:{text:"Here is your saved weight.",sections:[{title:"Metrics",lines:["Weight: 72 kg"]}]}}]};
  const messages=conversationMessages(context,"Tell me more.","detailed","Alex","2026-09-12",["health"]);
  const previous=messages.filter(message=>message.role==="assistant");
  assert.deepEqual(previous.map(message=>JSON.parse(message.content)),[{reply:"Here is your saved weight."}]);
  assert.ok(messages.some(message=>message.role==="user" && message.content.includes('"previousReference":{"topic":"health"')));
});
