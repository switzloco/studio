/**
 * @fileOverview Founder Mode Discord <-> Antigravity Remote Bridge (`!vibe` / `!agy`).
 *
 * Lets Nick (Discord User ID `696485160652111943`) send `!vibe ...` commands in his existing
 * Discord DM with `the CFO` (`1570875381844680837`) and route tasks to ANY project under `C:\Users\Nick`.
 *
 * Examples you can DM from your phone:
 *   - `!vibe projects` -> Replies immediately in Discord with all discovered local projects
 *   - `!vibe update the /briefings subheadline` -> Runs in default project (`C:\Users\Nick\VF Score\studio`)
 *   - `!vibe [hot-ones] check git status and run build` -> Runs in `C:\Users\Nick\hot-ones-biometric-gauntlet`
 *   - `!vibe [sundar] fix the layout padding` -> Runs in `C:\Users\Nick\sundar-scale-simulator`
 *   - `!vibe [jam] ...` -> Runs in `C:\Users\Nick\Jam`
 *
 * CLI Usage (called by Antigravity `/schedule` cron or manually):
 *   npx tsx scripts/vibe-discord.ts poll
 *   npx tsx scripts/vibe-discord.ts reply <messageId> "<replyText>"
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const FOUNDER_DISCORD_USER_ID = '696485160652111943';
const FOUNDER_DM_CHANNEL_ID = '1570875381844680837';
const HOME_DIR = 'C:/Users/Nick';
const DEFAULT_PROJECT_DIR = 'C:/Users/Nick/VF Score/studio';
const STATE_FILE = path.join(os.tmpdir(), 'agy-vibe-discord-state.json');

interface VibeBridgeState {
  lastProcessedMessageId?: string;
}

interface DiscoveredProject {
  key: string;
  name: string;
  absPath: string;
  aliases: string[];
}

function loadState(): VibeBridgeState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as VibeBridgeState;
    }
  } catch {
    // Ignore corrupt state
  }
  return {};
}

function saveState(state: VibeBridgeState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function discoverLocalProjects(): DiscoveredProject[] {
  const skipDirs = new Set([
    'AppData',
    'Application Data',
    'Contacts',
    'Cookies',
    'Desktop',
    'Documents',
    'Downloads',
    'Favorites',
    'Links',
    'Local Settings',
    'Music',
    'My Documents',
    'NetHood',
    'OneDrive',
    'Pictures',
    'PrintHood',
    'Recent',
    'Saved Games',
    'Searches',
    'SendTo',
    'Start Menu',
    'Templates',
    'Videos',
    '3D Objects',
  ]);

  const projects: DiscoveredProject[] = [
    {
      key: 'studio',
      name: 'CFO Fitness (VF Score / studio)',
      absPath: DEFAULT_PROJECT_DIR,
      aliases: ['studio', 'cfo', 'vf', 'vf-score', 'cfofitness'],
    },
  ];

  try {
    for (const entry of fs.readdirSync(HOME_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || skipDirs.has(entry.name)) {
        continue;
      }
      if (entry.name === 'VF Score') continue;
      const fullPath = path.join(HOME_DIR, entry.name).replace(/\\/g, '/');
      const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const shortTokens = slug.split('-').filter((t) => t.length >= 3);
      projects.push({
        key: slug,
        name: entry.name,
        absPath: fullPath,
        aliases: Array.from(new Set([slug, entry.name.toLowerCase(), ...shortTokens])),
      });
    }
  } catch {
    // Keep default project if directory scan fails
  }

  return projects;
}

export function parseVibeCommand(rawContent: string): {
  isVibeCommand: boolean;
  isListProjects: boolean;
  project: DiscoveredProject;
  prompt: string;
} {
  const trimmed = rawContent.trim();
  const match = trimmed.match(/^!(?:vibe|agy)\b\s*([\s\S]*)$/i);
  const projects = discoverLocalProjects();
  const defaultProject = projects[0];

  if (!match) {
    return {
      isVibeCommand: false,
      isListProjects: false,
      project: defaultProject,
      prompt: '',
    };
  }

  let body = (match[1] || '').trim();
  if (!body || /^(projects|repos|list|help)$/i.test(body)) {
    return {
      isVibeCommand: true,
      isListProjects: true,
      project: defaultProject,
      prompt: body,
    };
  }

  // Match `[project] task...` or `in <project>: task...`
  const bracketMatch = body.match(/^\[([a-zA-Z0-9_-]+)\]\s*([\s\S]+)$/);
  const inMatch = body.match(/^in\s+([a-zA-Z0-9_-]+)\s*:\s*([\s\S]+)$/i);
  const targetHint = (bracketMatch?.[1] || inMatch?.[1] || '').toLowerCase();

  if (targetHint) {
    const found = projects.find((p) => p.aliases.includes(targetHint));
    if (found) {
      body = (bracketMatch?.[2] || inMatch?.[2] || '').trim();
      return {
        isVibeCommand: true,
        isListProjects: false,
        project: found,
        prompt: body,
      };
    }
  }

  return {
    isVibeCommand: true,
    isListProjects: false,
    project: defaultProject,
    prompt: body,
  };
}

async function sendDiscordReply(botToken: string, replyToMessageId: string, content: string) {
  await fetch(`${DISCORD_API_BASE}/channels/${FOUNDER_DM_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: content.slice(0, 1950),
      message_reference: {
        message_id: replyToMessageId,
        fail_if_not_exists: false,
      },
    }),
  });
}

async function main() {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    console.error('Missing DISCORD_BOT_TOKEN environment variable.');
    process.exit(1);
  }

  const mode = (process.argv[2] || 'poll').toLowerCase();

  if (mode === 'reply') {
    const msgId = process.argv[3];
    const text = process.argv.slice(4).join(' ').trim();
    if (!msgId || !text) {
      console.error('Usage: npx tsx scripts/vibe-discord.ts reply <messageId> "<text>"');
      process.exit(1);
    }
    await sendDiscordReply(botToken, msgId, text);
    console.log(`Replied to Discord message ${msgId}`);
    return;
  }

  // Mode: poll
  const state = loadState();
  const res = await fetch(
    `${DISCORD_API_BASE}/channels/${FOUNDER_DM_CHANNEL_ID}/messages?limit=15`,
    {
      headers: { Authorization: `Bot ${botToken}` },
    },
  );
  if (!res.ok) {
    console.error(`Discord API error: ${res.status}`);
    process.exit(1);
  }

  const messages = (await res.json()) as Array<{
    id: string;
    content?: string;
    timestamp?: string;
    author?: { id?: string; bot?: boolean };
  }>;

  const chronological = [...messages].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0,
  );

  // On first run, initialize cursor to latest message unless the latest message is a recent (<10m) !vibe command
  if (!state.lastProcessedMessageId && chronological.length > 0) {
    const tenMinsAgo = Date.now() - 10 * 60 * 1000;
    const recentVibe = chronological.find(
      (m) =>
        m.author?.id === FOUNDER_DISCORD_USER_ID &&
        /^!(vibe|agy)\b/i.test((m.content || '').trim()) &&
        (m.timestamp ? Date.parse(m.timestamp) >= tenMinsAgo : false),
    );
    if (!recentVibe) {
      saveState({ lastProcessedMessageId: chronological[chronological.length - 1].id });
      console.log(JSON.stringify({ pending: [] }));
      return;
    }
  }

  const pending: Array<{
    messageId: string;
    projectKey: string;
    projectName: string;
    projectDir: string;
    prompt: string;
  }> = [];

  let newestId = state.lastProcessedMessageId;

  for (const msg of chronological) {
    if (
      state.lastProcessedMessageId &&
      BigInt(msg.id) <= BigInt(state.lastProcessedMessageId)
    ) {
      continue;
    }
    newestId = msg.id;

    if (msg.author?.bot || msg.author?.id !== FOUNDER_DISCORD_USER_ID) continue;
    const parsed = parseVibeCommand(msg.content || '');
    if (!parsed.isVibeCommand) continue;

    if (parsed.isListProjects) {
      const projects = discoverLocalProjects();
      const lines = [
        '**Antigravity Remote Bridge · Local Projects**',
        ...projects.map(
          (p) => `- \`[${p.key}]\` → \`${p.absPath}\` _(aliases: ${p.aliases.slice(0, 4).join(', ')})_`,
        ),
        '\n**Usage:**',
        '- `!vibe <task>` (runs in `studio`)',
        '- `!vibe [hot-ones] <task>` or `!vibe [sundar] <task>` or `!vibe [jam] <task>`',
      ];
      await sendDiscordReply(botToken, msg.id, lines.join('\n'));
      continue;
    }

    await sendDiscordReply(
      botToken,
      msg.id,
      `**[AGY Founder Bridge]** Picked up task for \`${parsed.project.name}\` (\`${parsed.project.absPath}\`) — working on it now...`,
    );

    pending.push({
      messageId: msg.id,
      projectKey: parsed.project.key,
      projectName: parsed.project.name,
      projectDir: parsed.project.absPath,
      prompt: parsed.prompt,
    });
  }

  if (newestId && newestId !== state.lastProcessedMessageId) {
    saveState({ lastProcessedMessageId: newestId });
  }

  console.log(JSON.stringify({ pending }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
