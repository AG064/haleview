import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import { ApiError } from "../api";
import { clearChat, loadChat, loadEarlierChat, sendChat, type ChatTurn } from "../assistant-api";
import type { SessionRequest } from "../nutrition/api";
import { HaleChatChart } from "./HaleChatChart";

const suggestions = ["How are my weight and BMI doing?", "Show me my weight trend this month", "How do I prepare tonight's dinner?", "How much protein have I recorded this week?"];

export function HaleChatTurn({ turn, onSuggestion }: { turn: ChatTurn; onSuggestion: (prompt: string) => void }) {
  return <div className="hale-chat-turn">
    <article className="hale-chat-message hale-chat-user" aria-label="Your message">
      <strong className="sr-only">You</strong>
      <p>{turn.message}</p>
    </article>
    <article className="hale-chat-message hale-chat-answer" aria-label="Hale's reply">
      <span className="hale-chat-avatar" aria-hidden="true"><MessageCircle /></span>
      <div className="hale-chat-answer-body">
        <div className="hale-chat-answer-label"><strong>Hale</strong><span>{turn.reply.source === "deepseek" ? "Online AI" : turn.reply.sections.length ? "Saved data and guidance" : "Hale guidance"}{turn.mode === "detailed" ? " · Detailed" : ""}</span></div>
        <p>{turn.reply.text}</p>
        {turn.reply.sections.map((section, index) => <div className="hale-chat-facts" key={`${turn.id}-${index}`}>
          <h3>{section.title}</h3>
          {section.ordered ? <ol>{section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ol> : <ul>{section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul>}
          {section.chart && <HaleChatChart chart={section.chart} />}
        </div>)}
        {turn.reply.suggestions?.length ? <div className="hale-chat-chart-suggestions" aria-label="Suggested charts"><span>Related view</span>{turn.reply.suggestions.map((suggestion) => <button type="button" className="secondary-button" key={suggestion.prompt} onClick={() => onSuggestion(suggestion.prompt)}>{suggestion.label}</button>)}</div> : null}
        {turn.reply.notice && <p className="hale-chat-notice">{turn.reply.notice}</p>}
      </div>
    </article>
  </div>;
}

export function HaleChat({ request }: { request: SessionRequest }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [online, setOnline] = useState(false);
  const [mode, setMode] = useState<"concise" | "detailed">("concise");
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const previousScroll = useRef<{ height: number; top: number } | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const attempt = useRef<{ message: string; id: string; mode: "concise" | "detailed" } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setLoadError(false);
    request(loadChat).then((result) => {
      if (!active) return;
      setTurns(result.turns);
      setOnline(result.online);
      setHasEarlier(result.hasEarlier === true);
      setMode(result.turns.at(-1)?.mode ?? "concise");
    }).catch(() => {
      if (active) { setError("Your chat could not be loaded. Please try again."); setLoadError(true); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, retry]);

  useEffect(() => {
    if (log.current) {
      log.current.scrollTop = previousScroll.current ? previousScroll.current.top + log.current.scrollHeight - previousScroll.current.height : log.current.scrollHeight;
      previousScroll.current = null;
    }
  }, [turns, pending]);

  async function earlierMessages() {
    if (loadingEarlier || !turns.length || busy) return;
    setLoadingEarlier(true);
    setError(null);
    try {
      const result = await request((token) => loadEarlierChat(turns[0].id, token));
      if (!mounted.current) return;
      if (log.current) previousScroll.current = { height: log.current.scrollHeight, top: log.current.scrollTop };
      setTurns((previous) => [...result.turns, ...previous.filter((turn) => !result.turns.some((older) => older.id === turn.id))]);
      setHasEarlier(result.hasEarlier);
    } catch { if (mounted.current) setError("Earlier messages could not be loaded. Please try again."); }
    finally { if (mounted.current) setLoadingEarlier(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || inFlight.current || loading || loadError) return;
    inFlight.current = true;
    setBusy(true);
    setPending(text);
    setError(null);
    setConfirmClear(false);
    if (attempt.current?.message !== text || attempt.current.mode !== mode) attempt.current = { message: text, id: crypto.randomUUID(), mode };
    const id = attempt.current.id;
    try {
      const result = await request((token) => sendChat(text, id, token, mode));
      if (!mounted.current) return;
      setTurns((previous) => [...previous.filter((turn) => turn.id !== result.turn.id), result.turn]);
      setMessage("");
      attempt.current = null;
    } catch (caught) {
      if (mounted.current) setError(caught instanceof ApiError ? caught.message : "Could not connect to chat. Your message is still here so you can try again.");
    } finally {
      inFlight.current = false;
      if (mounted.current) { setBusy(false); setPending(null); input.current?.focus(); }
    }
  }

  async function removeHistory() {
    if (inFlight.current || loadingEarlier) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await request(clearChat);
      if (mounted.current) { setTurns([]); setHasEarlier(false); setConfirmClear(false); attempt.current = null; }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof ApiError ? caught.message : "Chat could not be cleared. Try again.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="panel hale-chat" aria-labelledby="hale-chat-title">
      <div className="hale-chat-chrome">
        <header className="hale-chat-heading">
          <div className="hale-chat-heading-title">
            <span className="hale-chat-heading-icon"><MessageCircle aria-hidden="true" /></span>
            <div><p className="eyebrow">Hale</p><h2 id="hale-chat-title">Let's talk about your wellbeing</h2></div>
          </div>
          <div className="hale-chat-heading-actions">
            {!loading && <span className="hale-chat-mode">{online ? "Online AI" : "Saved data"}</span>}
            {turns.length > 0 && !confirmClear && <button type="button" className="hale-chat-clear button-with-icon" disabled={busy || loadingEarlier} onClick={() => setConfirmClear(true)}><Trash2 aria-hidden="true" />Clear</button>}
          </div>
        </header>
        <p className="hale-chat-intro">Ask about your health, progress, meals, recipes or wellbeing. You can also ask for a chart. Hale remembers the recent conversation and uses your saved data.</p>
        {!loading && !online && <p className="hale-chat-notice">Online AI is off. You can still look up your saved data here.</p>}
        {confirmClear && <div className="hale-chat-history-actions"><p>Clear your saved chat history?</p><button type="button" className="secondary-button" disabled={busy || loadingEarlier} onClick={() => void removeHistory()}>Clear history</button><button type="button" className="text-button" disabled={busy || loadingEarlier} onClick={() => setConfirmClear(false)}>Keep history</button></div>}
      </div>
      <div className="hale-chat-thread">
        {loading ? <p className="hale-chat-loading" role="status">Loading your chat...</p> : <>
          {hasEarlier && <div className="hale-chat-earlier"><button className="secondary-button" type="button" disabled={loadingEarlier || busy} onClick={() => void earlierMessages()}>{loadingEarlier ? "Loading earlier messages..." : "Load earlier messages"}</button></div>}
          <div className="hale-chat-log" ref={log} role="log" aria-label="Conversation with Hale" aria-live="polite" aria-relevant="additions" tabIndex={0}>
            <div className="hale-chat-column">
              {turns.length === 0 && !pending && <div className="hale-chat-welcome">
                <span className="hale-chat-welcome-icon" aria-hidden="true"><MessageCircle /></span>
                <h3>What would you like to check?</h3>
                <p>Start with a question below, or write your own.</p>
                {!loadError && <div className="hale-chat-suggestions" aria-label="Suggested questions">
                  {suggestions.map((suggestion) => <button type="button" className="secondary-button" key={suggestion} onClick={() => { setMessage(suggestion); input.current?.focus(); }}>{suggestion}</button>)}
                </div>}
              </div>}
              {turns.map((turn) => <HaleChatTurn key={turn.id} turn={turn} onSuggestion={(prompt) => { setMessage(prompt); input.current?.focus(); }} />)}
              {pending && <div className="hale-chat-turn">
                <article className="hale-chat-message hale-chat-user" aria-label="Your message"><strong className="sr-only">You</strong><p>{pending}</p></article>
                <div className="hale-chat-message hale-chat-answer hale-chat-pending" role="status"><span className="hale-chat-avatar" aria-hidden="true"><MessageCircle /></span><div className="hale-chat-answer-body"><strong>Hale</strong><p>Looking into that...</p></div></div>
              </div>}
            </div>
          </div>
        </>}
      </div>
      <div className="hale-chat-composer-dock">
        {error && <div className="hale-chat-error" role="alert"><p>{error}</p>{loadError && <button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry loading chat</button>}</div>}
        <form className="hale-chat-form" onSubmit={(event) => void submit(event)}>
          <div className="hale-chat-composer-heading"><label className="sr-only" htmlFor="hale-chat-message">Message Hale</label><label className="hale-chat-detail-label" htmlFor="hale-chat-detail">Reply detail<select id="hale-chat-detail" value={mode} disabled={busy || loading} onChange={(event) => setMode(event.target.value as "concise" | "detailed")}><option value="concise">Concise</option><option value="detailed">Detailed</option></select></label></div>
          <div className="hale-chat-composer-box">
            <textarea id="hale-chat-message" ref={input} rows={2} maxLength={2000} value={message} disabled={busy || loading || loadError}
              onChange={(event) => setMessage(event.target.value)} placeholder="Message Hale"
              aria-describedby="hale-chat-help hale-chat-count"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
              }} />
            <button type="submit" className="hale-chat-send" disabled={busy || loading || loadError || !message.trim()} aria-busy={busy} aria-label={pending ? "Sending message" : "Send message"}><Send aria-hidden="true" /></button>
          </div>
          <div className="hale-chat-form-meta"><p id="hale-chat-help" className="hale-chat-help">Enter to send. Shift+Enter for a new line. Keep contact details and passwords out of chat. Hale cannot diagnose or provide medical treatment.</p><span id="hale-chat-count">{message.length} / 2000</span></div>
        </form>
      </div>
    </section>
  );
}
