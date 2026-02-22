'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, Send, MoreVertical, Briefcase, ChevronRight, User } from "lucide-react";
import { sendChatMessage } from '@/app/actions/chat';
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: 'user' | 'model';
  content: string;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: "Nick, let's look at the portfolio. Your protein intake is looking like a penny stock. Time for a capital infusion. What's the plan for today's lunch session?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    const result = await sendChatMessage(userMessage, messages);

    if (result.success && result.response) {
      setMessages(prev => [...prev, { role: 'model', content: result.response! }]);
    } else {
      toast({
        variant: "destructive",
        title: "Liquidity Crisis",
        description: result.error || "The CFO is unreachable. Market is closed.",
      });
    }

    setIsLoading(false);
  };

  const toggleLive = () => {
    setIsLiveActive(!isLiveActive);
    if (!isLiveActive) {
      toast({
        title: "Gemini Live API Active",
        description: "Establishing bidirectional voice link with the CFO...",
      });
    }
  };

  return (
    <div className="flex flex-col flex-1 h-0">
      <ScrollArea className="flex-1 p-4 pt-2">
        <div className="flex flex-col gap-4">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
              <div className="flex items-center gap-2 mb-1 px-1">
                {m.role === 'model' ? (
                  <>
                    <Briefcase className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">The CFO</span>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Nick</span>
                    <User className="w-3 h-3 text-muted-foreground" />
                  </>
                )}
              </div>
              <div className={m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                {m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-1 px-1">
                <Briefcase className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase">CFO is crunching numbers...</span>
              </div>
              <div className="chat-bubble-ai flex gap-1 items-center">
                <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" />
                <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Persistent Chat UI */}
      <div className="p-4 glass-morphism border-t shadow-2xl safe-area-bottom">
        {isLiveActive && (
            <div className="mb-4 flex items-center justify-between p-3 bg-primary/10 rounded-xl border border-primary/20 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-3 h-3 bg-primary rounded-full animate-ping absolute" />
                        <div className="w-3 h-3 bg-primary rounded-full" />
                    </div>
                    <span className="text-xs font-semibold text-primary">Gemini Live Active</span>
                </div>
                <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className={`w-1 bg-primary rounded-full animate-pulse h-${Math.floor(Math.random()*4)+2}`} />
                    ))}
                </div>
            </div>
        )}
        <div className="flex items-center gap-2">
          <Button 
            variant={isLiveActive ? "destructive" : "secondary"} 
            size="icon" 
            className="rounded-full shrink-0 w-12 h-12 shadow-sm"
            onClick={toggleLive}
          >
            <Mic className={`w-5 h-5 ${isLiveActive ? 'animate-pulse' : ''}`} />
          </Button>
          <div className="relative flex-1">
            <Input 
              placeholder="Send message to The CFO..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="pr-12 py-6 rounded-full border-muted bg-white/50 focus:bg-white shadow-sm"
              disabled={isLoading}
            />
            <Button 
              size="icon" 
              className="absolute right-1 top-1 w-10 h-10 rounded-full"
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-3 font-medium uppercase tracking-widest opacity-60">
            Powered by Genkit & Gemini Live API
        </p>
      </div>
    </div>
  );
}
