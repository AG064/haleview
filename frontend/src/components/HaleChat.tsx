import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import { ApiError } from "../api";
import { clearChat, loadChat, sendChat, type ChatTurn } from "../assistant-api";
import type { SessionRequest } from "../nutrition/api";

const suggestions = ["How are my weight and BMI doing?", "What are my goals?", "What's my meal plan today?", "How much protein have I recorded today?"];

export function HaleChat({ request }: { request: SessionRequest }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [online, setOnline] = useState(false);
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
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const attempt = useRef<{ message: string; id: string } | null>(null);

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
    }).catch(() => {
      if (active) { setError("Your chat could not be loaded. Please try again."); setLoadError(true); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, retry]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || inFlight.current || loading || loadError) return;
    inFlight.current = true;
    setBusy(true);
    setPending(text);
    setError(null);
    setConfirmClear(false);
    if (attempt.current?.message !== text) attempt.current = { message: text, id: crypto.randomUUID() };
    const id = attempt.current.id;
    try {
      const result = await request((token) => sendChat(text, id, token));
      if (!mounted.current) return;
      setTurns((previous) => [...previous.filter((turn) => turn.id !== result.turn.id), result.turn].slice(-40));
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
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await request(clearChat);
      if (mounted.current) { setTurns([]); setConfirmClear(false); attempt.current = null; }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof ApiError ? caught.message : "Chat could not be cleared. Try again.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="panel hale-chat" aria-labelledby="hale-chat-title">
      <header className="hale-chat-heading">
        <div className="hale-chat-heading-title">
          <MessageCircle aria-hidden="true" />
          <div><p className="eyebrow">Hale</p><h2 id="hale-chat-title">Let's talk about your wellbeing</h2></div>
        </div>
        {!loading && <span className="hale-chat-mode">{online ? "Online AI" : "Saved data"}</span>}
      </header>
      <p className="hale-chat-intro">Ask about your health metrics, goals, meals or recorded nutrition. Your latest conversations stay with your account.</p>
      {!loading && !online && <p className="hale-chat-notice">Online AI is off. You can still look up your saved data here.</p>}
      {loading ? <p role="status">Loading your chat...</p> : <>
        <div className="hale-chat-log" ref={log} role="log" aria-label="Conversation with Hale" aria-live="polite" aria-relevant="additions" tabIndex={0}>
          {turns.length === 0 && !pending && <div className="hale-chat-welcome">
            <h3>What would you like to check?</h3>
            <p>Start with a question below, or write your own.</p>
          </div>}
          {turns.map((turn) => <div className="hale-chat-turn" key={turn.id}>
            <article className="hale-chat-message hale-chat-user" aria-label="Your message"><strong>You</strong><p>{turn.message}</p></article>
            <article className="hale-chat-message hale-chat-answer" aria-label="Hale's reply">
              <div className="hale-chat-answer-label"><strong>Hale</strong><span>{turn.reply.source === "deepseek" ? "Online AI" : "Saved data"}</span></div>
              <p>{turn.reply.text}</p>
              {turn.reply.sections.map((section, index) => <div className="hale-chat-facts" key={`${turn.id}-${index}`}>
                <h3>{section.title}</h3>
                <ul>{section.lines.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul>
              </div>)}
              {turn.reply.notice && <p className="hale-chat-notice">{turn.reply.notice}</p>}
            </article>
          </div>)}
          {pending && <div className="hale-chat-turn"><article className="hale-chat-message hale-chat-user"><strong>You</strong><p>{pending}</p></article><p className="hale-chat-pending" role="status">Hale is looking into that...</p></div>}
        </div>
        {!loadError && turns.length === 0 && !pending && <div className="hale-chat-suggestions" aria-label="Suggested questions">
          {suggestions.map((suggestion) => <button type="button" className="secondary-button" key={suggestion} onClick={() => { setMessage(suggestion); input.current?.focus(); }}>{suggestion}</button>)}
        </div>}
      </>}
      {error && <div className="hale-chat-error" role="alert"><p>{error}</p>{loadError && <button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry loading chat</button>}</div>}
      <form className="hale-chat-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="hale-chat-message">Message Hale</label>
        <textarea id="hale-chat-message" ref={input} rows={3} maxLength={2000} value={message} disabled={busy || loading || loadError}
          onChange={(event) => setMessage(event.target.value)} placeholder="Ask about your weight, BMI or today's meals..."
          aria-describedby="hale-chat-help hale-chat-count"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }} />
        <div className="hale-chat-form-actions"><span id="hale-chat-count">{message.length} / 2000</span><button type="submit" className="primary-button button-with-icon" disabled={busy || loading || loadError || !message.trim()} aria-busy={busy}><Send aria-hidden="true" />{pending ? "Sending..." : "Send message"}</button></div>
        <p id="hale-chat-help" className="hale-chat-help">Enter to send. Shift+Enter for a new line. Please keep contact details and passwords out of chat. Hale cannot diagnose or provide medical treatment.</p>
      </form>
      {turns.length > 0 && <div className="hale-chat-history-actions">
        {confirmClear ? <><p>Clear your saved chat history?</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void removeHistory()}>Clear history</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmClear(false)}>Keep history</button></>
          : <button type="button" className="text-button button-with-icon" disabled={busy} onClick={() => setConfirmClear(true)}><Trash2 aria-hidden="true" />Clear chat history</button>}
      </div>}
    </section>
  );
}
