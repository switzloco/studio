'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Loader2, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { sendLedgerMessage } from '@/app/actions/ledger-chat';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

interface Message {
  role: 'user' | 'model';
  content: string;
}

const SUGGESTIONS = [
  'How was last week?',
  'Pull my 30-day protein average',
  'What are my best workout days?',
  'Show my highest calorie days this month',
];

export function LedgerChat() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [initDone, setInitDone] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Init greeting when panel first opens
  useEffect(() => {
    if (!isOpen || initDone || !user) return;
    setInitDone(true);

    const runInit = async () => {
      setIsLoading(true);
      try {
        const localDate = new Date().toLocaleDateString('en-CA');
        const result = await sendLedgerMessage('__init__', [], user.uid, user.displayName || undefined, localDate);
        if (result.success && result.response) {
          setMessages([{ role: 'model', content: result.response }]);
        } else {
          setMessages([{ role: 'model', content: 'Ledger Analyst online. Ask me anything about your history.' }]);
        }
      } catch {
        setMessages([{ role: 'model', content: 'Ledger Analyst online. Ask me anything about your history.' }]);
      } finally {
        setIsLoading(false);
      }
    };

    runInit();
  }, [isOpen, initDone, user]);

  const handleSend = async (text?: string) => {
    const messageText = (text ?? input).trim();
    if (!user || !messageText || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: messageText }]);
    setIsLoading(true);

    try {
      const localDate = new Date().toLocaleDateString('en-CA');
      const result = await sendLedgerMessage(
        messageText,
        messages.map(m => ({ role: m.role, content: m.content })),
        user.uid,
        user.displayName || undefined,
        localDate,
      );
      if (result.success && result.response) {
        setMessages(prev => [...prev, { role: 'model', content: result.response! }]);
      } else {
        toast({ variant: 'destructive', title: 'Analyst Error', description: result.error });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Analyst Error', description: 'Could not reach the Ledger Analyst.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
      {/* Header — always visible */}
      <button
        className="w-full p-5 flex items-center justify-between text-left"
        onClick={() => setIsOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-100 rounded-xl shadow-sm">
            <BarChart3 className="w-4 h-4 text-emerald-700" />
          </div>
          <div>
            <p className="text-[12px] font-black text-foreground uppercase tracking-[0.1em]">Ledger Analyst</p>
            <p className="text-[10px] font-medium text-muted-foreground">Query your food & workout history</p>
          </div>
        </div>
        {isOpen
          ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {/* Expandable body */}
      {isOpen && (
        <CardContent className="p-0 border-t border-primary/5">
          {/* Message area */}
          <div className="flex flex-col gap-3 p-4 max-h-80 overflow-y-auto">
            {messages.length === 0 && !isLoading && (
              /* Suggestion chips shown before first interaction */
              <div className="space-y-3">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Try asking:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => handleSend(s)}
                      className="text-[11px] font-bold px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full hover:bg-emerald-100 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-1">
                  {m.role === 'model' ? 'Analyst' : 'You'}
                </span>
                <div className={
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm font-medium max-w-[85%]'
                    : 'bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[90%]'
                }>
                  {m.role === 'model' ? (
                    <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-emerald-700 prose-headings:text-foreground text-[13px]">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="text-[13px]">{m.content}</span>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex flex-col items-start">
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-1">Analyst</span>
                <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-2.5 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Querying Ledger...</span>
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-primary/5 flex items-center gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask about your history..."
              className="flex-1 rounded-full text-sm border-muted bg-white/50 h-9"
              disabled={isLoading}
            />
            <Button
              size="icon"
              className="rounded-full w-9 h-9 bg-emerald-600 hover:bg-emerald-700 shrink-0"
              onClick={() => handleSend()}
              disabled={isLoading || !input.trim()}
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
