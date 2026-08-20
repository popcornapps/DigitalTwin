import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

// Lives above the router (see App.tsx) so switching tabs/pages - which
// unmounts and remounts the AiCopilot page component - doesn't lose the chat.
// Same "lift state above the route" pattern FilterContext already uses for
// plant/persona selection. Also mirrored into sessionStorage so a full page
// refresh (which wipes all in-memory React/Context state, unlike a route
// switch) doesn't lose it either - sessionStorage specifically, not
// localStorage, so it clears itself once the browser tab/session ends
// rather than persisting indefinitely. The conversation only ever resets
// when the user explicitly clicks "New Chat" (startNewChat).

export interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
}

export const WELCOME_MESSAGE: ChatMessage = {
  sender: 'ai',
  text: 'Ask me about running batches — status, KPI predictions, process parameters, alerts, recommendations, or comparisons with historical batches. You can ask about one batch, multiple batches, or all running batches.',
};

const MESSAGES_STORAGE_KEY = 'copilot.messages';
const CONVERSATION_ID_STORAGE_KEY = 'copilot.conversationId';

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(MESSAGES_STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME_MESSAGE];
  } catch {
    return [WELCOME_MESSAGE];
  }
}

function loadStoredConversationId(): string | null {
  try {
    return sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface CopilotContextType {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  conversationId: string | null;
  setConversationId: (val: string | null) => void;
  startNewChat: () => void;
  // Where the chat was scrolled to - a plain ref (not state) since this is
  // never rendered, only read/written on mount and on scroll. Lives here,
  // not in the AiCopilot page component, for the same reason messages does:
  // this provider never unmounts on route navigation, so the value survives
  // switching tabs and coming back, unlike component-local state.
  scrollPositionRef: React.MutableRefObject<number>;
}

const CopilotContext = createContext<CopilotContextType | undefined>(undefined);

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [conversationId, setConversationId] = useState<string | null>(loadStoredConversationId);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // sessionStorage unavailable (private browsing, quota, etc.) - the chat
      // still works for the current page lifetime via in-memory state above,
      // it just won't survive a refresh. Not worth surfacing to the user.
    }
  }, [messages]);

  useEffect(() => {
    try {
      if (conversationId) {
        sessionStorage.setItem(CONVERSATION_ID_STORAGE_KEY, conversationId);
      } else {
        sessionStorage.removeItem(CONVERSATION_ID_STORAGE_KEY);
      }
    } catch {
      // See above.
    }
  }, [conversationId]);

  // conversationId reset to null here, not a freshly generated id - the
  // backend (app.copilot.conversation_store) mints a new one on the next
  // /api/copilot/chat call that's sent with no conversation_id, exactly the
  // same first-message path as this app already uses today.
  const startNewChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setConversationId(null);
    scrollPositionRef.current = 0;
  };

  return (
    <CopilotContext.Provider
      value={{ messages, setMessages, conversationId, setConversationId, startNewChat, scrollPositionRef }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  const context = useContext(CopilotContext);
  if (!context) {
    throw new Error('useCopilot must be used within a CopilotProvider');
  }
  return context;
}
