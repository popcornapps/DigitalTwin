import { sendCopilotMessage, ApiError } from '../lib/api';
import { Send, Bot, User, Cpu, Loader2, MessageSquarePlus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useFilter } from '../context/FilterContext';
import { useCopilot } from '../context/CopilotContext';
import { renderChatText } from '../lib/renderChatText';

export default function AiCopilot() {
  const [inputVal, setInputVal] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { selectedPersona } = useFilter();
  // Lifted above the router (see CopilotContext) so switching tabs and
  // coming back doesn't lose the conversation - it only resets when the
  // user clicks "New Chat" below.
  const { messages, setMessages, conversationId, setConversationId, startNewChat, scrollPositionRef } = useCopilot();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // True only for this component instance's very first render - lets the
  // effect below tell "just mounted/remounted" (restore where the user left
  // off) apart from "a message was actually added" (snap to the latest one).
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (isFirstRenderRef.current) {
      // Remounted (e.g. navigated back to this tab) - restore the scroll
      // position from before, rather than resetting to the top or jumping
      // to the bottom.
      container.scrollTop = scrollPositionRef.current;
      isFirstRenderRef.current = false;
      return;
    }
    // A message was actually added (the user's own, or the AI's reply), or
    // the "generating..." indicator just appeared/disappeared - keep the
    // latest content in view, like any chat UI.
    container.scrollTop = container.scrollHeight;
    scrollPositionRef.current = container.scrollTop;
  }, [messages, isSending, scrollPositionRef]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    // Continuously remember where the user has scrolled to - e.g. if they
    // scroll up to reread something and then switch tabs, that position (not
    // the bottom) is what should be restored on return.
    scrollPositionRef.current = e.currentTarget.scrollTop;
  };

  const handleSend = async () => {
    const text = inputVal.trim();
    if (!text || isSending) return;

    setMessages(prev => [...prev, { sender: 'user', text }]);
    setInputVal('');
    setIsSending(true);
    try {
      const response = await sendCopilotMessage(text, conversationId, selectedPersona);
      setConversationId(response.conversation_id);
      setMessages(prev => [...prev, { sender: 'ai', text: response.reply }]);
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : 'Something went wrong reaching the AI Copilot.';
      setMessages(prev => [...prev, { sender: 'ai', text: detail }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-8rem)] flex flex-col pt-2">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
             <Cpu className="text-blue-600" /> AI Manufacturing Copilot
          </h1>
          <p className="text-sm text-gray-500 mt-1.5">Natural Language to Manufacturing Insights across all running batches</p>
        </div>
        <button
           onClick={startNewChat}
           disabled={isSending}
           className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 shrink-0"
        >
           <MessageSquarePlus size={16} /> New Chat
        </button>
      </div>

      <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
         <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((chat, idx) => (
               <div key={idx} className={`flex gap-4 ${chat.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {chat.sender === 'ai' && (
                     <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
                        <Bot size={18} />
                     </div>
                  )}
                  <div className={`px-5 py-3.5 rounded-2xl max-w-[85%] sm:max-w-[75%] whitespace-pre-wrap text-sm leading-relaxed ${
                     chat.sender === 'user' ? 'bg-blue-600 text-white rounded-br-sm shadow-sm' : 'bg-gray-50 text-gray-800 border border-gray-100 rounded-bl-sm shadow-sm'
                  }`}>
                     {chat.sender === 'ai' ? renderChatText(chat.text) : chat.text}
                  </div>
                  {chat.sender === 'user' && (
                     <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 shrink-0">
                        <User size={18} />
                     </div>
                  )}
               </div>
            ))}
            {isSending && (
               <div className="flex gap-4 justify-start">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
                     <Bot size={18} />
                  </div>
                  <div className="px-5 py-3.5 rounded-2xl rounded-bl-sm bg-gray-50 border border-gray-100 shadow-sm text-gray-400">
                     <Loader2 size={16} className="animate-spin" />
                  </div>
               </div>
            )}
         </div>
         <div className="p-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-gray-300 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
               <input
                  type="text"
                  className="flex-1 bg-transparent px-3 py-1.5 outline-none text-gray-800 text-sm placeholder-gray-400"
                  placeholder="Ask a manufacturing question... (e.g. Any batches in critical state right now?)"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
               />
               <button
                  className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-md transition-colors"
                  onClick={handleSend}
                  disabled={isSending || !inputVal.trim()}
               >
                  <Send size={18} />
               </button>
            </div>
         </div>
      </div>
    </div>
  );
}
