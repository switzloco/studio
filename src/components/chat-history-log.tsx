'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, MessagesSquare, Paperclip } from "lucide-react";
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { ChatSession } from '@/lib/food-exercise-types';

/** "2026-06-05" → "Thu, Jun 5". Parsed as local date to avoid TZ drift. */
function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/**
 * Browsable per-day chat transcript. Read-only visibility into what was said
 * each day — one collapsible card per day, newest first.
 */
export function ChatHistoryLog() {
  const { user } = useUser();
  const db = useFirestore();
  const [expanded, setExpanded] = useState<string | null>(null);

  const sessionsQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'chat_sessions'),
    orderBy('date', 'desc'),
    limit(30),
  ) : null, [db, user]);
  const { data: sessions } = useCollection<ChatSession>(sessionsQuery);

  if (!sessions || sessions.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <MessagesSquare className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] italic">Conversation Log</h3>
      </div>

      <div className="space-y-3">
        {sessions.map((session) => {
          const isOpen = expanded === session.date;
          const msgs = session.messages ?? [];
          return (
            <Card
              key={session.date}
              className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all cursor-pointer"
              onClick={() => setExpanded(prev => prev === session.date ? null : session.date)}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-black italic">{formatDayLabel(session.date)}</p>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {msgs.length} message{msgs.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground opacity-30 transition-all shrink-0 ml-3 ${isOpen ? 'rotate-180' : ''}`} />
                </div>

                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-muted/40 flex flex-col gap-3 animate-in slide-in-from-top-1 fade-in duration-200">
                    {msgs.map((m, i) => (
                      <div key={i} className={m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
                        <span className="text-[9px] font-bold text-muted-foreground uppercase mb-1 px-1">
                          {m.role === 'model' ? 'the CFO' : 'You'}
                        </span>
                        <div className={m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                          {m.hasImages && (
                            <div className="flex items-center gap-1 text-[10px] font-bold uppercase opacity-70 mb-1">
                              <Paperclip className="w-3 h-3" /> Photo attached
                            </div>
                          )}
                          {m.role === 'model' ? (
                            <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-primary prose-headings:text-primary">
                              <ReactMarkdown>{m.content}</ReactMarkdown>
                            </div>
                          ) : (
                            m.content
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
