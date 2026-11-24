"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HOME_CHAT, chatStorageKey, clearChat, greeting, loadChat, planHandoff, saveChat, type ChatMessage } from "@/lib/chat";
import type { FieldValues } from "@/lib/fill-template";
import { ChatPanel } from "./ChatPanel";
import { useSession } from "./session/useSession";
import { useChatAvailability } from "./useChatAvailability";

/**
 * Home page chat: the AI finds out which document the user needs (or explains it can't generate
 * one and offers the closest), then opens that document's page with the conversation so far.
 * Renders nothing without a backend (static hosting): the template grid below still works.
 */
export function HomeChat() {
  const { user } = useSession();
  const router = useRouter();
  const storageKey = user ? chatStorageKey(user.email, HOME_CHAT) : null;
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    storageKey ? (loadChat(storageKey, [])?.messages ?? []) : [],
  );
  const available = useChatAvailability() === "available";

  useEffect(() => {
    if (storageKey) saveChat(storageKey, { messages, values: {} });
  }, [storageKey, messages]);

  if (!available || !user || !storageKey) return null;

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
    </section>
  );
}
