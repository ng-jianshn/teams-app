import React from "react";
import * as teamsJs from "@microsoft/teams-js";

import "./App.css";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function App() {
  const [content, setContent] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages([
        ...next,
        { role: "assistant", content: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    (async () => {
      teamsJs.app.initialize().then(() => {
        teamsJs.app.getContext().then((context: teamsJs.app.Context) => {
          if (context?.app?.host?.name) {
            setContent(`Your app is running in ${context.app.host.name}`);
          }
        });
      });
    })();
  }, []);

  return (
    <div className="App">
      <h1>👋 Welcome Rymnet</h1>

      {content && (
        <div className="result">
          <pre>
            <code>{content}</code>
          </pre>
        </div>
      )}

      <div className="chat">
        <div className="chat-messages">
          {messages.length === 0 && <div className="chat-empty">Ask me anything.</div>}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.content}
            </div>
          ))}
          {loading && <div className="chat-msg assistant">...</div>}
          <div ref={endRef} />
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
