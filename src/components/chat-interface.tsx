'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, Send, Camera, User, Briefcase, X } from "lucide-react";
import { sendChatMessage } from '@/app/actions/chat';
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { healthService } from '@/lib/health-service';
import { doc } from 'firebase/firestore';

interface Message {
  role: 'user' | 'model';
  content: string;
  image?: string;
}

export function ChatInterface({ onMessageProcessed }: { onMessageProcessed?: () => void }) {
  const { user } = useUser();
  const db = useFirestore();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: "Portfolio audit initialized. What's the plan for today's lunch session?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData } = useDoc(userDocRef);

  const handleSend = async () => {
    if (!user || (!input.trim() && !selectedImage) || isLoading) return;

    const userMessage = input.trim();
    const userImage = selectedImage;
    
    setInput('');
    setSelectedImage(null);
    setMessages(prev => [...prev, { role: 'user', content: userMessage || "Asset Audit Attached", image: userImage || undefined }]);
    setIsLoading(true);

    const result = await sendChatMessage(
      userMessage, 
      messages.map(m => ({ role: m.role, content: m.content })), 
      healthData || {},
      userImage || undefined
    );

    if (result.success && result.response) {
      setMessages(prev => [...prev, { role: 'model', content: result.response! }]);
      
      // Execute commands from the AI
      if (result.commands && result.commands.length > 0) {
        for (const cmd of result.commands) {
          if (cmd.type === 'UPDATE_VITALS' && healthData) {
            await healthService.updateHealthData(db, user.uid, {
              protein_g: (healthData.protein_g || 0) + (cmd.payload.protein_g || 0),
              visceral_fat_points: (healthData.visceral_fat_points || 0) + (cmd.payload.visceral_fat_points || 0),
            });
          } else if (cmd.type === 'BATCH_UPDATE') {
            await healthService.batchUpdateHistory(db, user.uid, cmd.payload.entries);
          } else if (cmd.type === 'CORRECT_HISTORY') {
            await healthService.updateHistoryEntry(db, user.uid, cmd.payload.date, cmd.payload);
          }
        }
      }
    } else {
      toast({ variant: "destructive", title: "Liquidity Crisis", description: result.error });
    }

    setIsLoading(false);
  };

  return (
    <div className="flex flex-col flex-1 h-0">
      <ScrollArea className="flex-1 p-4 pt-2">
        <div className="flex flex-col gap-4">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">{m.role === 'model' ? 'The CFO' : 'User'}</span>
              </div>
              <div className={m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                {m.image && <img src={m.image} alt="Audit" className="mb-2 rounded-lg border w-full h-auto" />}
                {m.content}
              </div>
            </div>
          ))}
          <div className="h-4" />
        </div>
      </ScrollArea>

      <div className="p-4 glass-morphism border-t shadow-2xl safe-area-bottom">
        {selectedImage && (
          <div className="mb-4 relative w-24 h-24 rounded-xl overflow-hidden border-2 border-primary">
            <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
            <Button size="icon" variant="destructive" className="absolute top-1 right-1 w-6 h-6 rounded-full" onClick={() => setSelectedImage(null)}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="file" accept="image/*" hidden ref={fileInputRef} onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onloadend = () => setSelectedImage(reader.result as string);
              reader.readAsDataURL(file);
            }
          }} />
          <Button variant="secondary" size="icon" className="rounded-full shrink-0 w-12 h-12" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
            <Camera className="w-5 h-5 text-muted-foreground" />
          </Button>
          <Input 
            placeholder="Send message..." 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleSend()} 
            className="flex-1 rounded-full border-muted bg-white/50"
            disabled={isLoading}
          />
          <Button size="icon" className="rounded-full w-12 h-12" onClick={handleSend} disabled={isLoading || (!input.trim() && !selectedImage)}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
