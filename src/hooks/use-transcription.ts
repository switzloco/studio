'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';

export function useTranscription(
  onTranscript: (text: string) => void,
  getToken?: () => Promise<string>,
) {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const transcribe = useCallback(async (blob: Blob) => {
    setStatus('transcribing');
    try {
      const buf = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''),
      );
      const mimeType = blob.type || 'audio/webm';
      const dataUri = `data:${mimeType};base64,${base64}`;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getToken) {
        const token = await getToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ audioDataUri: dataUri }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Transcription failed');
      }

      const { text } = await res.json();
      if (text) onTranscript(text);
    } catch (err: any) {
      setError(err?.message ?? 'Transcription failed');
    } finally {
      setStatus('idle');
    }
  }, [onTranscript, getToken]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (blob.size > 0) transcribe(blob);
        else setStatus('idle');
      };

      recorder.start();
      setStatus('recording');
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permissions.'
        : err?.message ?? 'Could not start recording';
      setError(msg);
      setStatus('idle');
    }
  }, [transcribe]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const toggle = useCallback(() => {
    if (status === 'idle') startRecording();
    else if (status === 'recording') stopRecording();
  }, [status, startRecording, stopRecording]);

  return { status, startRecording, stopRecording, toggle, error };
}
