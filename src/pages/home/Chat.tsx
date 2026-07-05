import { useEffect, useRef, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useHomeProperty } from "./HomeLayout";

const SUGGESTIONS = [
  "What paint colors are approved?",
  "Do I need approval to build a fence?",
  "What are the rules for trash cans?",
];

export default function Chat() {
  const { selected } = useHomeProperty();
  const args = selected ? { propertyId: selected.propertyId } : "skip";
  const convo = useQuery(api.chat.myConversation, args);
  const ask = useAction(api.chat.ask);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const messages = convo?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const send = async (text: string) => {
    if (!selected || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    try {
      const res = await ask({ propertyId: selected.propertyId, message: text.trim() });
      if (!res.ok) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col" style={{ minHeight: "70vh" }}>
      <h1 className="text-lg font-bold text-slate-900">Ask the AI assistant</h1>
      <p className="text-sm text-slate-500">
        Answers come from your HOA’s published rules. The board has the final say.
      </p>

      <div className="mt-4 flex-1 space-y-3">
        {messages.length === 0 && !sending && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Try asking:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-blue-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m._id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-slate-200 text-slate-800"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-400">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form
        className="sticky bottom-0 mt-3 flex gap-2 bg-slate-50 pb-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about HOA rules…"
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
