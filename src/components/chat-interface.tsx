
'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Camera, X, Loader2 } from "lucide-react";
import { sendChatMessage } from '@/app/actions/chat';
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { HealthData } from '@/lib/health-service';

interface Message {
  role: 'user' | 'model';
  content: string;
  image?: string;
}

export function ChatInterface() {
  const { user } = useUser();
  const db = useFirestore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [initialMessageSet, setInitialMessageSet] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData } = useDoc<HealthData>(userDocRef);

  // Set the correct opening message once we know the user's onboarding state
  useEffect(() => {
    if (initialMessageSet || healthData === undefined) return;
    const firstName = user?.displayName?.split(' ')[0] || 'Partner';
    const content = healthData?.onboardingComplete
      ? `Portfolio's live, ${firstName}. What are we logging today — protein or movement?`
      : "I'm your new Chief Fitness Officer. I've been hired to audit your visceral fat and protein solvency. Let's start the discovery audit: What are we working with in terms of equipment and your current weekly routine?";
    setMessages([{ role: 'model', content }]);
    setInitialMessageSet(true);
  }, [healthData, initialMessageSet, user]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setSelectedImage(reader.result as string);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleSend = async () => {
    if (!user || (!input.trim() && !selectedImage) || isLoading) return;

    const userMessage = input.trim();
    const userImage = selectedImage;
    
    setInput('');
    setSelectedImage(null);
    setMessages(prev => [...prev, { role: 'user', content: userMessage || "Asset Audit Attached", image: userImage || undefined }]);
    setIsLoading(true);

    // CRITICAL FIX: Sanitize healthData for Server Action. 
    // Firestore Timestamps are not plain objects and cause serialization errors in Server Actions.
    const sanitizedHealth = healthData ? JSON.parse(JSON.stringify(healthData)) : {};

    const result = await sendChatMessage(
      userMessage, 
      messages.map(m => ({ role: m.role, content: m.content })), 
      sanitizedHealth,
      userImage || undefined,
      user.uid,
      user.displayName || undefined
    );

    if (result.success && result.response) {
      setMessages(prev => [...prev, { role: 'model', content: result.response! }]);
    } else {
      toast({ variant: "destructive", title: "Audit Failed", description: result.error });
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
                {m.image && <Image src={m.image} alt="Audit" width={400} height={300} className="mb-2 rounded-lg border w-full h-auto" unoptimized />}
                {m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex flex-col items-start">
              <div className="chat-bubble-ai flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-[10px] font-bold uppercase">Auditing Assets...</span>
              </div>
            </div>
          )}
          <div ref={scrollRef} className="h-4" />
        </div>
      </ScrollArea>

      <div className="p-4 glass-morphism border-t shadow-2xl safe-area-bottom">
        {selectedImage && (
          <div className="mb-4 relative w-24 h-24 rounded-xl overflow-hidden border-2 border-primary">
            <Image src={selectedImage} alt="Preview" width={96} height={96} className="w-full h-full object-cover" unoptimized />
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
            onPaste={handlePaste}
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
