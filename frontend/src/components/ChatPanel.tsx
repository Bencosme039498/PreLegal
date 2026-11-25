"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_CHARS, chatFailure, sendChat, type ChatFailure, type ChatMessage } from "@/lib/chat";
import { useBackendStatus } from "./useBackendStatus";
import type { FieldValues } from "@/lib/fill-template";
import { inputClass } from "./input-styles";

interface ChatPanelProps {
  /** The document being drafted, or null while the AI finds out which one the user needs. */
  templateId: string | null;
  /** The assistant's opening message (shown, never sent). */
  greetingText: string;
  messages: ChatMessage[];
  onMessages: (messages: ChatMessage[]) => void;
  /** The document's current values (none on the home page, before a document is chosen). */
  values?: FieldValues;
  /** Receives the field values after each AI turn (merged over the current ones by the caller). */
  onValues?: (values: FieldValues) => void;
  onReset: () => void;
  /**
   * The AI chose a document, or switched to another: open it with this conversation (ending with
   * the AI's reply) and the values it holds for that document.
   */
  onNavigate: (templateId: string, conversation: ChatMessage[], values: FieldValues) => void;
  /** Offered when the chat can't continue (e.g. the AI isn't configured). */
  onUseForm?: () => void;
  /** Shown instead of "Use the form instead" when there is no form to use (the home page). */
  noFormHint?: string;
  /** Height classes for the panel. */
  className?: string;
}

const bubble = "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap";
const NO_VALUES: FieldValues = {};

/** Freeform chat with the AI assistant, which fills in the document's fields as the user answers. */
export function ChatPanel(props: ChatPanelProps) {
  const { templateId, greetingText, messages, onMessages, values = NO_VALUES, onValues, onReset } = props;
  const { onNavigate, onUseForm, noFormHint, className = "h-[32rem] lg:h-[calc(100vh-7rem)]" } = props;
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  // A turn after a long idle first wakes the server (lib/backend.ts): say so while it does.
  const waking = useBackendStatus() === "waking";
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const request = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length, pending, failure]);

  /** Abandons the in-flight request, if any: its response or error is then ignored. */
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setPending(false);
  };

  // Cancel an in-flight request when leaving the page.
  useEffect(() => () => request.current?.abort(), []);

  const ask = async (conversation: ChatMessage[]) => {
    cancel();
    const controller = (request.current = new AbortController());
    setPending(true);
    setFailure(null);
    try {
      const turn = await sendChat(templateId, conversation, values, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const answered: ChatMessage[] = [...conversation, { role: "assistant", content: turn.reply }];
      if (turn.template_id && turn.template_id !== templateId) {
        // The conversation continues on the new document's page. This panel stays "Thinking…"
        // (request.current is released without resetting pending) until the page changes.
        request.current = null;
        onNavigate(turn.template_id, answered, turn.values);
        return;
      }
      onValues?.(turn.values);
      onMessages(answered);
    } catch (error) {
      if (controller.signal.aborted) return; // Start over or unmount: not an error.
      setFailure(chatFailure(error));
    } finally {
      if (request.current === controller) {
        cancel();
        inputRef.current?.focus();
      }
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || pending) return;
    const conversation: ChatMessage[] = [...messages, { role: "user", content: text }];
    setInput("");
    onMessages(conversation);
    void ask(conversation);
  };

  const startOver = () => {
    cancel();
    setFailure(null);
    setInput("");
    onReset();
    inputRef.current?.focus();
  };

  // The user's message is last when a turn failed, or when the page was reloaded mid-request:
  // Retry resends the same conversation.
  const unanswered = !pending && messages.at(-1)?.role === "user";
  const canRetry = unanswered && (failure?.retryable ?? true);
  const transcript: ChatMessage[] = [{ role: "assistant", content: greetingText }, ...messages];

  return (
    <section
      aria-label="Chat with the drafting assistant"
      className={`flex flex-col rounded-lg border border-stone-200 bg-white shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">Drafting assistant</h2>
        <button
          type="button"
          onClick={startOver}
          disabled={messages.length === 0 && !pending}
          className="text-sm font-medium text-brand-blue hover:text-brand-blue/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start over
        </button>
      </div>

      <div ref={logRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {transcript.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <p
              className={`${bubble} ${m.role === "user" ? "bg-brand-blue text-white" : "bg-stone-100 text-stone-800"}`}
            >
              <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
              {m.content}
            </p>
          </div>
        ))}
        {pending && (
          <p role="status" className={`${bubble} bg-stone-100 text-stone-500`}>
            {waking ? "Starting the server, which can take up to a minute… then thinking." : "Thinking…"}
          </p>
        )}
        {failure && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p>{failure.message}</p>
            <div className="mt-2 flex gap-3">
              {canRetry && (
                <button type="button" onClick={() => void ask(messages)} className="font-medium underline">
                  Retry
                </button>
              )}
              {!failure.retryable && onUseForm && (
                <button type="button" onClick={onUseForm} className="font-medium underline">
                  Use the form instead
                </button>
              )}
              {!failure.retryable && !onUseForm && noFormHint && <span>{noFormHint}</span>}
            </div>
          </div>
        )}
        {!failure && canRetry && (
          <p className="text-sm text-stone-500">
            Your last message wasn&apos;t answered.{" "}
            <button type="button" onClick={() => void ask(messages)} className="font-medium text-brand-blue underline">
              Retry
            </button>
          </p>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-stone-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={2}
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type your answer…"
          className={`${inputClass} mt-0 resize-none`}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-md bg-brand-purple px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-purple/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
