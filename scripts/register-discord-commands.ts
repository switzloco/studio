/**
 * Registers global + user-installable Discord slash commands (`/start`, `/eat`, `/status`, `/stop`)
 * for `the CFO` (`1570868560065077420`).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/register-discord-commands.ts
 */

const APP_ID = process.env.NEXT_PUBLIC_DISCORD_APP_ID || '1570868560065077420';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();

if (!BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN in environment.');
  process.exit(1);
}

// integration_types: 0 = GUILD_INSTALL, 1 = USER_INSTALL
// contexts: 0 = GUILD, 1 = BOT_DM, 2 = PRIVATE_CHANNEL
const SHARED_META = {
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const COMMANDS = [
  {
    name: 'start',
    description: 'Activate free 3x/day CFO Eat-By briefings in Discord (and optionally link your CFO email)',
    ...SHARED_META,
    options: [
      {
        name: 'email',
        description: 'Your CFO Fitness email (optional — links directly to your existing ledger)',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'weight_lbs',
        description: 'Current body weight in lbs (optional, e.g. 185)',
        type: 10, // NUMBER
        required: false,
      },
      {
        name: 'timezone',
        description: 'IANA timezone (default: America/Los_Angeles)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'eat',
    description: 'Log food, drink, or a meal/nutrition-label photo straight to your CFO ledger',
    ...SHARED_META,
    options: [
      {
        name: 'meal',
        description: 'What did you have? (e.g. "3 eggs and sourdough toast")',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'photo',
        description: 'Optional meal or nutrition-label photo',
        type: 11, // ATTACHMENT
        required: false,
      },
    ],
  },
  {
    name: 'status',
    description: 'Check your live CFO Eat-By clock, protein target, and VF score',
    ...SHARED_META,
  },
  {
    name: 'stop',
    description: 'Pause/cancel automated CFO Discord briefings immediately',
    ...SHARED_META,
  },
];

async function main() {
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(COMMANDS),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed (${res.status}):`, text);
    process.exit(1);
  }

  const parsed = JSON.parse(text) as Array<{ id: string; name: string }>;
  console.log(
    `Registered ${parsed.length} slash commands for app ${APP_ID}:`,
    parsed.map((c) => `/${c.name} (${c.id})`).join(', '),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
