import { randomInt } from 'crypto';

/**
 * @fileOverview Pure helpers for the messaging-channel gateway (WhatsApp /
 * Discord). No Firebase or Genkit imports — everything here is unit-testable.
 */

/** How long a one-time channel link code stays valid. */
export const LINK_CODE_TTL_MS = 15 * 60_000;

/** WhatsApp text messages cap at 4096 chars; Discord messages at 2000. */
export const WHATSAPP_MAX_MESSAGE_LEN = 4096;
export const DISCORD_MAX_MESSAGE_LEN = 2000;

/** Unambiguous alphabet for link codes — no I/O/0/1 lookalikes. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateLinkCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export type ChannelCommand =
  | { kind: 'link'; code: string }
  | { kind: 'unlink' }
  | { kind: 'chat' };

/**
 * Recognizes the two out-of-band commands a channel user can send:
 *   "LINK ABC123"  → claim a one-time code generated in the app
 *   "UNLINK"       → disconnect this WhatsApp/Discord identity
 * Everything else is a normal chat message for the CFO.
 */
export function parseChannelCommand(text: string): ChannelCommand {
  const trimmed = text.trim();
  const linkMatch = trimmed.match(/^link[\s:]+([a-z0-9]{4,12})$/i);
  if (linkMatch) return { kind: 'link', code: linkMatch[1].toUpperCase() };
  if (/^unlink$/i.test(trimmed)) return { kind: 'unlink' };
  return { kind: 'chat' };
}

/**
 * Splits a long reply into chunks that fit a channel's message-length cap.
 * Prefers paragraph boundaries, then line boundaries, then a hard cut — so a
 * structured CFO audit arrives as readable consecutive messages.
 */
export function splitMessage(text: string, maxLen: number): string[] {
  const body = text.trim();
  if (body.length <= maxLen) return body ? [body] : [];

  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of body.split('\n\n')) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }
    push();
    if (paragraph.length <= maxLen) {
      current = paragraph;
      continue;
    }
    // Paragraph alone exceeds the cap — split on lines, then hard-cut.
    for (const line of paragraph.split('\n')) {
      const lineCandidate = current ? `${current}\n${line}` : line;
      if (lineCandidate.length <= maxLen) {
        current = lineCandidate;
        continue;
      }
      push();
      let rest = line;
      while (rest.length > maxLen) {
        const cutAt = rest.lastIndexOf(' ', maxLen);
        const cut = cutAt > maxLen / 2 ? cutAt : maxLen;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
    }
  }
  push();
  return chunks;
}

/**
 * WhatsApp uses single-asterisk *bold* and doesn't render markdown headers.
 * Down-converts the CFO's markdown so audits stay readable in the chat.
 */
export function toWhatsAppFormatting(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')      // "## Header" → "*Header*"
    .replace(/\*\*(.+?)\*\*/g, '*$1*');        // "**bold**"  → "*bold*"
}

/**
 * Estimates the client's UTC offset (minutes to ADD to UTC to get local time,
 * e.g. -480 for PST, +120 for CEST) from the localDate/localTime strings the
 * app already sends with every chat turn. Tolerant of "3:04:05 PM" and
 * "15:04" style times; returns undefined when unparseable. Rounded to the
 * nearest 15 minutes so clock skew doesn't produce nonsense offsets.
 */
export function estimateTimezoneOffsetMinutes(
  localDate: string,
  localTime: string,
  nowMs: number = Date.now(),
): number | undefined {
  const dateMatch = localDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = localTime?.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i);
  if (!dateMatch || !timeMatch) return undefined;

  const [, y, mo, d] = dateMatch.map(Number);
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] ?? 0);
  const meridiem = timeMatch[4]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;

  const clientMs = Date.UTC(y, mo - 1, d, hours, minutes, seconds);
  const offset = Math.round((clientMs - nowMs) / 60_000 / 15) * 15;
  if (offset < -840 || offset > 840) return undefined; // UTC-14..UTC+14
  return offset;
}

/**
 * Derives the local date/time strings the coaching flow expects from a stored
 * UTC offset (see estimateTimezoneOffsetMinutes for the sign convention).
 */
export function localNowParts(
  offsetMinutes: number,
  nowMs: number = Date.now(),
): { localDate: string; localTime: string; currentDay: string } {
  const local = new Date(nowMs + offsetMinutes * 60_000);
  return {
    localDate: local.toISOString().slice(0, 10),
    localTime: local.toISOString().slice(11, 16),
    currentDay: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(local),
  };
}
