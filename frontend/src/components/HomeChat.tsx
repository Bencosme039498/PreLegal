"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HOME_CHAT, chatStorageKey, clearChat, greeting, loadChat, planHandoff, saveChat, type ChatMessage } from "@/lib/chat";
import type { FieldValues } from "@/lib/fill-template";
import { ChatPanel } from "./ChatPanel";
import { useSession } from "./session/useSession";
import { BackendNotice } from "./BackendNotice";
import { useBackendReady } from "./useBackendStatus";

/**
 * Home page chat: the AI finds out which document the user needs (or explains it can't generate
 * one and offers the closest), then opens that document's page with the conversation so far.
 * Renders nothing without a backend (static hosting): the template grid below still works. While a
 * sleeping backend wakes up it says so instead.
 */
export function HomeChat() {
  const { user } = useSession();
  const router = useRouter();
  const storageKey = user ? chatStorageKey(user.email, HOME_CHAT) : null;
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    storageKey ? (loadChat(storageKey, [])?.messages ?? []) : [],
  );
  const { status, ready } = useBackendReady();

  useEffect(() => {
    if (storageKey) saveChat(storageKey, { messages, values: {} });
  }, [storageKey, messages]);

  if (!user || !storageKey || status === "absent" || (!ready && status === "checking")) return null;

  const openDocument = (templateId: string, conversation: ChatMessage[], values: FieldValues) => {
    const handoff = planHandoff(user.email, templateId, conversation, values, true);
    saveChat(handoff.key, handoff.chat);
    clearChat(storageKey); // the conversation now lives on the document's page
    router.push(handoff.href);
  };

  return (
    <section aria-labelledby="home-chat-title">
      <h2 id="home-chat-title" className="mb-3 font-serif text-xl font-semibold text-brand-navy">
        What do you need to draft?
      </h2>
      {!ready ? (
        <BackendNotice status={status} />
      ) : (
      <ChatPanel
        templateId={null}
        greetingText={greeting()}
        messages={messages}
        onMessages={setMessages}
        onReset={() => setMessages([])}
        onNavigate={openDocument}
        noFormHint="You can still pick a document below."
        className="h-[26rem]"
      />
      )}
    </section>
  );
}
