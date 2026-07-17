import { getMockAiChat } from '../lib/mockData';
import { Send, Bot, User, Cpu } from 'lucide-react';
import { useState } from 'react';
import { useFilter } from '../context/FilterContext';

export default function AiCopilot() {
  const [inputVal, setInputVal] = useState('');
  const { selectedBatch, selectedPersona } = useFilter();

  const mockAiChat = getMockAiChat(selectedBatch, selectedPersona);

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-8rem)] flex flex-col pt-2">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
           <Cpu className="text-blue-600" /> AI Manufacturing Copilot
        </h1>
        <p className="text-sm text-gray-500 mt-1">Natural Language to Manufacturing Insights</p>
      </div>

      <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
         <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="text-center text-xs font-medium text-gray-400 mb-6">Chat history relative to Batch {selectedBatch}</div>
            {mockAiChat.map((chat, idx) => (
               <div key={idx} className={`flex gap-4 ${chat.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {chat.sender === 'ai' && (
                     <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
                        <Bot size={18} />
                     </div>
                  )}
                  <div className={`px-5 py-3.5 rounded-2xl max-w-[75%] whitespace-pre-wrap text-sm leading-relaxed ${
                     chat.sender === 'user' ? 'bg-blue-600 text-white rounded-br-sm shadow-sm' : 'bg-gray-50 text-gray-800 border border-gray-100 rounded-bl-sm shadow-sm'
                  }`}>
                     {chat.text}
                  </div>
                  {chat.sender === 'user' && (
                     <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 shrink-0">
                        <User size={18} />
                     </div>
                  )}
               </div>
            ))}
         </div>
         <div className="p-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-gray-300 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
               <input 
                  type="text" 
                  className="flex-1 bg-transparent px-3 py-1.5 outline-none text-gray-800 text-sm placeholder-gray-400" 
                  placeholder="Ask a manufacturing question... (e.g. Predict batch completion time)"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
               />
               <button className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors" title="AI copilot is mocked in this POC">
                  <Send size={18} />
               </button>
            </div>
         </div>
      </div>
    </div>
  );
}
