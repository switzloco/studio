'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, Send, Camera, User, Briefcase, X } from "lucide-react";
import { sendChatMessage } from '@/app/actions/chat';
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: 'user' | 'model';
  content: string;
  image?: string;
}

interface ChatInterfaceProps {
  onMessageProcessed?: () => void;
}

export function ChatInterface({ onMessageProcessed }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: "Nick, let's look at the portfolio. Your protein intake is looking like a penny stock. Time for a capital infusion. What's the plan for today's lunch session?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !selectedImage) || isLoading) return;

    const userMessage = input.trim();
    const userImage = selectedImage;
    
    setInput('');
    setSelectedImage(null);
    setMessages(prev => [...prev, { role: 'user', content: userMessage || "Asset Audit Attached", image: userImage || undefined }]);
    setIsLoading(true);

    const result = await sendChatMessage(userMessage, messages.map(m => ({ role: m.role, content: m.content })), userImage || undefined);

    if (result.success && result.response) {
      setMessages(prev => [...prev, { role: 'model', content: result.response! }]);
      // Trigger a refresh of the dashboard cards if the CFO updated the portfolio
      if (onMessageProcessed) {
        onMessageProcessed();
      }
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
        title: "Live Bidirectional Active",
        description: "Establishing low-latency link with the CFO...",
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
                {m.image && (
                  <div className="mb-2 relative w-full aspect-video rounded-lg overflow-hidden border border-white/20">
                    <img src={m.image} alt="Audit Asset" className="object-cover w-full h-full" />
                  </div>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-1 px-1">
                <Briefcase className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Audit in Progress...</span>
              </div>
              <div className="chat-bubble-ai flex gap-1 items-center">
                <span className="w-1 h-1 bg-primary rounded-full animate-bounce" />
                <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 glass-morphism border-t shadow-2xl safe-area-bottom">
        {selectedImage && (
          <div className="mb-4 relative w-24 h-24 rounded-xl overflow-hidden border-2 border-primary shadow-lg animate-in zoom-in-95">
            <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
            <Button 
              size="icon" 
              variant="destructive" 
              className="absolute top-1 right-1 w-6 h-6 rounded-full"
              onClick={() => setSelectedImage(null)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        {isLiveActive && (
            <div className="mb-4 flex items-center justify-between p-3 bg-primary/10 rounded-xl border border-primary/20 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-3 h-3 bg-primary rounded-full animate-ping absolute" />
                        <div className="w-3 h-3 bg-primary rounded-full" />
                    </div>
                    <span className="text-xs font-semibold text-primary">High-Intensity Mode Active</span>
                </div>
                <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className={`w-1 bg-primary rounded-full animate-pulse h-${Math.floor(Math.random()*4)+2}`} />
                    ))}
                </div>
            </div>
        )}

        <div className="flex items-center gap-2">
          <input 
            type="file" 
            accept="image/*" 
            hidden 
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <Button 
            variant="secondary" 
            size="icon" 
            className="rounded-full shrink-0 w-12 h-12 shadow-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          >
            <Camera className="w-5 h-5 text-muted-foreground" />
          </Button>
          
          <div className="relative flex-1">
            <Input 
              placeholder="Send message or asset for audit..." 
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
              disabled={isLoading || (!input.trim() && !selectedImage)}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>

          <Button 
            variant={isLiveActive ? "destructive" : "secondary"} 
            size="icon" 
            className="rounded-full shrink-0 w-12 h-12 shadow-sm"
            onClick={toggleLive}
          >
            <Mic className={`w-5 h-5 ${isLiveActive ? 'animate-pulse' : ''}`} />
          </Button>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-3 font-medium uppercase tracking-widest opacity-60">
            Multimodal Audit | Gemini 3 Pro Preview
        </p>
      </div>
    </div>
  );
}
