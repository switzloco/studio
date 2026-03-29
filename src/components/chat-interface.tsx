
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Camera, X, Loader2, Zap, Images } from "lucide-react";
import { sendChatMessage } from '@/app/actions/chat';
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { HealthData } from '@/lib/health-service';
import {
  loadGIS,
  getPhotosPickerToken,
  createPickerSession,
  waitForPickerSelection,
  getPickerMediaItems,
  downloadMediaItem,
  deletePickerSession,
  extractTimestampFromMediaItem,
} from '@/lib/google-photos-picker';

interface Message {
  role: 'user' | 'model';
  content: string;
  images?: string[];
}

interface SelectedPhoto {
  dataUri: string;
  /** HH:MM (24h) extracted from EXIF DateTimeOriginal — undefined if unavailable */
  exifTime?: string;
  /** YYYY-MM-DD extracted from EXIF — included when different from today */
  exifDate?: string;
}

const MAX_PHOTOS = 5;

/** Extracts photo timestamp from EXIF data; falls back to file.lastModified. */
async function extractExifInfo(file: File): Promise<{ time?: string; date?: string }> {
  try {
    // Dynamic import keeps exifr out of the critical path
    const exifr = await import('exifr');
    const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const dt: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) {
      return {
        time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
        date: dt.toLocaleDateString('en-CA'),
      };
    }
  } catch {
    // exifr parse failed — fall through to lastModified
  }
  if (file.lastModified) {
    const d = new Date(file.lastModified);
    return {
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      date: d.toLocaleDateString('en-CA'),
    };
  }
  return {};
}

/** Reads a File as a base64 data URI. */
function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatInterface() {
  const { user } = useUser();
  const db = useFirestore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [initDone, setInitDone] = useState(false);
  const [coachingRequested, setCoachingRequested] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);

  // picker state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerAbortRef = useRef<AbortController | null>(null);

  // Separate refs: one for camera (capture), one for gallery (multiple)
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData } = useDoc<HealthData>(userDocRef);

  // A user is "known" once they have any activity beyond the initial portfolio creation.
  // history starts with 1 entry ("Portfolio Initialized") — any real activity adds more.
  const isKnownUser = !!healthData && (
    healthData.onboardingComplete ||
    (healthData.history && healthData.history.length > 1)
  );

  useEffect(() => {
    if (initDone || healthData === undefined || !user) return;
    if (isKnownUser && !coachingRequested) return;
    setInitDone(true);

    const runInit = async () => {
      setIsLoading(true);
      try {
        const now = new Date();
        const sanitizedHealth = healthData ? JSON.parse(JSON.stringify(healthData)) : {};
        const result = await sendChatMessage(
          '__init__', [], sanitizedHealth, undefined, user.uid,
          user.displayName || undefined,
          now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0'),
          now.toLocaleTimeString('en-US'),
        );
        setMessages([{
          role: 'model',
          content: result.success && result.response
            ? result.response
            : "Hey Partner, I'm your Chief Fitness Officer. What are we working on today?",
        }]);
      } catch (e) {
        console.error('[ChatInit] sendChatMessage threw:', e);
        setMessages([{ role: 'model', content: "Hey Partner, I'm your Chief Fitness Officer. What are we working on today?" }]);
      } finally {
        setIsLoading(false);
      }
    };

    runInit();
  }, [healthData, initDone, user, isKnownUser, coachingRequested]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  /** Processes File objects → SelectedPhoto array, respecting MAX_PHOTOS cap. */
  const processFiles = async (files: File[]) => {
    const slots = MAX_PHOTOS - selectedPhotos.length;
    if (slots <= 0) {
      toast({ title: `Max ${MAX_PHOTOS} photos per message`, variant: 'destructive' });
      return;
    }
    const toProcess = files.slice(0, slots);
    const results = await Promise.all(
      toProcess.map(async (file) => {
        const [dataUri, exif] = await Promise.all([readFileAsDataUri(file), extractExifInfo(file)]);
        return { dataUri, exifTime: exif.time, exifDate: exif.date } satisfies SelectedPhoto;
      })
    );
    setSelectedPhotos(prev => [...prev, ...results]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await processFiles(files);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageFiles: File[] = [];
    for (let i = 0; i < e.clipboardData.items.length; i++) {
      const item = e.clipboardData.items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length) await processFiles(imageFiles);
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const cancelPicker = useCallback(() => {
    pickerAbortRef.current?.abort();
    pickerAbortRef.current = null;
    setIsPickerOpen(false);
  }, []);

  const handleGooglePhotos = async () => {
    if (!GOOGLE_CLIENT_ID) {
      toast({ variant: 'destructive', title: 'Google Photos not configured', description: 'Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your environment.' });
      return;
    }
    const slots = MAX_PHOTOS - selectedPhotos.length;
    if (slots <= 0) {
      toast({ title: `Max ${MAX_PHOTOS} photos per message`, variant: 'destructive' });
      return;
    }

    try {
      // Warm up GIS while showing spinner
      await loadGIS();
      const accessToken = await getPhotosPickerToken(GOOGLE_CLIENT_ID);
      const session = await createPickerSession(accessToken);

      // Open picker in new tab
      window.open(session.pickerUri, '_blank');
      setIsPickerOpen(true);

      // Set up abort controller so the user can cancel
      const abort = new AbortController();
      pickerAbortRef.current = abort;

      const selected = await waitForPickerSelection(session, accessToken, abort.signal);
      setIsPickerOpen(false);
      pickerAbortRef.current = null;

      if (!selected) {
        // Timed out or user cancelled — clean up silently
        deletePickerSession(session.id, accessToken);
        return;
      }

      // Fetch + download selected items
      const items = await getPickerMediaItems(session.id, accessToken);
      deletePickerSession(session.id, accessToken); // best-effort async cleanup

      const photos = await Promise.all(
        items.slice(0, slots).map(async (item) => {
          const dataUri = await downloadMediaItem(item.mediaFile.baseUrl);
          const { time, date } = extractTimestampFromMediaItem(item);
          return { dataUri, exifTime: time, exifDate: date } satisfies SelectedPhoto;
        })
      );
      setSelectedPhotos(prev => [...prev, ...photos]);
    } catch (err: any) {
      setIsPickerOpen(false);
      pickerAbortRef.current = null;
      // OAuth popup closed by user — don't show error
      if (err?.message?.includes('popup_closed') || err?.type === 'popup_closed') return;
      console.error('[GooglePhotos]', err);
      toast({ variant: 'destructive', title: 'Google Photos failed', description: err?.message ?? 'Unknown error' });
    }
  };

  const handleSend = async () => {
    const hasPhotos = selectedPhotos.length > 0;
    if (!user || (!input.trim() && !hasPhotos) || isLoading) return;

    const userMessage = input.trim();
    const photos = selectedPhotos;
    const now = new Date();
    const localDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');

    setInput('');
    setSelectedPhotos([]);
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage || (photos.length > 1 ? `${photos.length} photos attached` : "Photo attached"),
      images: photos.map(p => p.dataUri),
    }]);
    setIsLoading(true);

    const sanitizedHealth = healthData ? JSON.parse(JSON.stringify(healthData)) : {};

    // Build EXIF context prefix so the AI knows when each photo was taken
    const photoTimestamps = photos.map(p => p.exifTime ?? '');
    const photoDates = photos.map(p => p.exifDate ?? '');
    let exifContext = '';
    if (photos.length > 0 && photos.some(p => p.exifTime)) {
      const parts = photos.map((p, i) =>
        `Photo ${i + 1}: taken at ${p.exifTime ?? 'unknown time'}${p.exifDate && p.exifDate !== localDate ? ` on ${p.exifDate}` : ''}`
      );
      exifContext = `[${parts.join(' | ')}] `;
    }
    const fullMessage = exifContext + userMessage;

    try {
      const result = await sendChatMessage(
        fullMessage,
        messages.map(m => ({ role: m.role, content: m.content })),
        sanitizedHealth,
        undefined,
        user.uid,
        user.displayName || undefined,
        localDate,
        now.toLocaleTimeString('en-US'),
        photos.map(p => p.dataUri),
        photoTimestamps,
        photoDates,
      );
      if (result.success && result.response) {
        setMessages(prev => [...prev, { role: 'model', content: result.response! }]);
      } else {
        toast({ variant: "destructive", title: "Audit Failed", description: result.error });
      }
    } catch (e) {
      console.error('[ChatSend] sendChatMessage threw:', e);
      toast({ variant: "destructive", title: "Audit Failed", description: "The CFO is unavailable. Check GOOGLE_GENAI_API_KEY and server logs." });
    } finally {
      setIsLoading(false);
    }
  };

  const hasTargets = healthData?.onboardingComplete || (healthData?.visceralFatPoints && healthData.visceralFatPoints > 1250);
  const placeholder = hasTargets
    ? "Log a meal, workout, or ask The CFO..."
    : "Tell me about your goals, equipment, routine...";

  /** Google Photos colorful pinwheel icon. */
  const GooglePhotosIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill="#4285F4"/>
      <path d="M12 12 L20.5 12 A8.5 8.5 0 0 1 12 20.5 Z" fill="#34A853"/>
      <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill="#FBBC05"/>
      <path d="M12 12 L3.5 12 A8.5 8.5 0 0 1 12 3.5 Z" fill="#EA4335"/>
    </svg>
  );

  /** Shared photo thumbnail strip shown above the input bar. */
  const PhotoStrip = selectedPhotos.length > 0 || isPickerOpen ? (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1 px-1">
      {isPickerOpen && (
        <div className="flex-shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-20 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <span className="text-[7px] font-bold text-primary/60 uppercase text-center leading-tight px-1">Picking…</span>
          <button onClick={cancelPicker} className="text-[7px] font-black text-destructive/60 uppercase underline leading-none">cancel</button>
        </div>
      )}
      {selectedPhotos.map((photo, i) => (
        <div key={i} className="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 border-primary shadow-md">
          <Image src={photo.dataUri} alt={`Photo ${i + 1}`} width={80} height={80} className="w-full h-full object-cover" unoptimized />
          {photo.exifTime && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-bold text-center py-0.5 leading-tight">
              {photo.exifTime}
              {photo.exifDate && photo.exifDate !== new Date().toLocaleDateString('en-CA') && (
                <div className="text-[7px] opacity-80">{photo.exifDate.slice(5)}</div>
              )}
            </div>
          )}
          <Button
            size="icon" variant="destructive"
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full p-0"
            onClick={() => removePhoto(i)}
          >
            <X className="w-2.5 h-2.5" />
          </Button>
        </div>
      ))}
      {selectedPhotos.length < MAX_PHOTOS && (
        <button
          className="flex-shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/40 hover:border-primary/40 hover:text-primary/40 transition-colors"
          onClick={() => galleryInputRef.current?.click()}
        >
          <span className="text-[9px] font-bold uppercase text-center leading-tight px-1">Add<br />More</span>
        </button>
      )}
    </div>
  ) : null;

  /** Shared input bar used in both the idle screen and main chat view. */
  const InputBar = (
    <div className="p-4 glass-morphism border-t shadow-2xl safe-area-bottom">
      {PhotoStrip}
      <div className="flex items-center gap-2">
        {/* Hidden inputs */}
        <input
          type="file" accept="image/*" capture="environment"
          hidden ref={cameraInputRef}
          onChange={handleFileChange}
        />
        <input
          type="file" accept="image/*" multiple
          hidden ref={galleryInputRef}
          onChange={handleFileChange}
        />

        {/* Camera button — opens native camera directly */}
        <Button
          variant="secondary" size="icon"
          className="rounded-full shrink-0 w-12 h-12"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isLoading || isPickerOpen || selectedPhotos.length >= MAX_PHOTOS}
          title="Take photo"
        >
          <Camera className="w-5 h-5 text-muted-foreground" />
        </Button>

        {/* Gallery / multi-select button */}
        <Button
          variant="secondary" size="icon"
          className="rounded-full shrink-0 w-12 h-12"
          onClick={() => galleryInputRef.current?.click()}
          disabled={isLoading || isPickerOpen || selectedPhotos.length >= MAX_PHOTOS}
          title="Choose from library"
        >
          <Images className="w-5 h-5 text-muted-foreground" />
        </Button>

        {/* Google Photos Picker */}
        {GOOGLE_CLIENT_ID && (
          <Button
            variant="secondary" size="icon"
            className="rounded-full shrink-0 w-12 h-12"
            onClick={handleGooglePhotos}
            disabled={isLoading || isPickerOpen || selectedPhotos.length >= MAX_PHOTOS}
            title="Pick from Google Photos"
          >
            <GooglePhotosIcon className="w-5 h-5" />
          </Button>
        )}

        <Input
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          onPaste={handlePaste}
          className="flex-1 rounded-full border-muted bg-white/50"
        />
        <Button
          size="icon" className="rounded-full w-12 h-12"
          onClick={handleSend}
          disabled={isLoading || isPickerOpen || (!input.trim() && selectedPhotos.length === 0)}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Idle screen for known users
  if (isKnownUser && messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col flex-1 h-0">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="p-4 bg-primary/10 rounded-3xl">
            <Zap className="w-10 h-10 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-black uppercase tracking-tight text-foreground italic">The CFO is standing by</p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Your portfolio, your call</p>
          </div>
          <Button
            className="h-14 px-10 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl"
            onClick={() => setCoachingRequested(true)}
          >
            <Zap className="w-4 h-4 mr-2" />
            Get Coaching
          </Button>
          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-50">
            Or snap a photo, or type below to log
          </p>
        </div>
        {InputBar}
      </div>
    );
  }

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
                {m.images && m.images.length > 0 && (
                  <div className={`mb-2 ${m.images.length > 1 ? 'grid grid-cols-2 gap-1' : ''}`}>
                    {m.images.map((img, j) => (
                      <Image key={j} src={img} alt={`Photo ${j + 1}`} width={400} height={300} className="rounded-lg border w-full h-auto" unoptimized />
                    ))}
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
      {InputBar}
    </div>
  );
}
