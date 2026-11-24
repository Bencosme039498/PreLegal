"use client";

import { useEffect, useState } from "react";
import { isChatAvailable } from "@/lib/chat";

export type ChatAvailability = "checking" | "available" | "unavailable";

/** Whether the AI assistant's backend answers here: "unavailable" on a static-only host (Vercel, next dev). */
export function useChatAvailability(): ChatAvailability {
  const [availability, setAvailability] = useState<ChatAvailability>("checking");
  useEffect(() => {
    let active = true;
    void isChatAvailable().then((available) => {
      if (active) setAvailability(available ? "available" : "unavailable");
    });
    return () => {
      active = false;
    };
  }, []);
  return availability;
}
