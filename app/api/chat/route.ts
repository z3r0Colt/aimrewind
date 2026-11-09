import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../db';
import { rateLimits } from '../../../db/schema';
import { CHARACTERS, CHARACTER_IDS, CLUES, MAX_NIGHTS, WORLD_BIBLE, awayFor, type CharacterId, type ClueId } from '../../../lib/game/world';

export const dynamic = 'force-dynamic';

const MODEL = 'claude-opus-5-5';
const MESSAGES_PER_HOUR = 90;
const MAX_HISTORY = 40;
const MAX_TEXT = 500;

type Line = { from: 'player' | 'them'; text: string };
type ChatRequest = {
  character: CharacterId;
  identity: { screenName: string; main: boolean };
  night: number;
  trust: number;
  clues: ClueId[];
  history: Line[];
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    replies: { type: 'array', items: { type: 'string' } },
    trust_change: { type: 'integer', enum: [-2, -1, 0, 1, 2] },
    clues: { type: 'array', items: { type: 'string', enum: Object.keys(CLUES) } },
    reveal: { type: 'array', items: { type: 'string', enum: CHARACTER_IDS } },
    sign_off: { type: 'boolean' },
    ending: { type: 'string', enum: ['none', 'called_home', 'pushed_away'] },
  },
  required: ['replies', 'trust_change', 'clues', 'reveal', 'sign_off', 'ending'],
  additionalProperties: false,
};

type Output = {
  replies: string[];
  trust_change: number;
  clues: string[];
  reveal: string[];
  sign_off: boolean;
  ending: 'none' | 'called_home' | 'pushed_away';
};

function parseRequest(raw: unknown): ChatRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const character = r.character as CharacterId;
  if (!CHARACTER_IDS.includes(character)) return null;
  const identity = r.identity as ChatRequest['identity'];
  if (!identity || typeof identity.screenName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(identity.screenName)) return null;
  const history = Array.isArray(r.history) ? r.history : [];
  const lines: Line[] = history
    .filter((l): l is Line => !!l && (l.from === 'player' || l.from === 'them') && typeof l.text === 'string')
    .slice(-MAX_HISTORY)
    .map(l => ({ from: l.from, text: l.text.slice(0, MAX_TEXT) }));
  if (!lines.length || lines[lines.length - 1].from !== 'player' || !lines[lines.length - 1].text.trim()) return null;
  return {
    character,
    identity: { screenName: identity.screenName, main: !!identity.main },
    night: Math.min(MAX_NIGHTS, Math.max(1, Number(r.night) || 1)),
    trust: Math.max(-5, Math.min(5, Number(r.trust) || 0)),
    clues: (Array.isArray(r.clues) ? r.clues : []).filter((c): c is ClueId => typeof c === 'string' && c in CLUES),
    history: lines,
  };
}

async function allowed(ip: string) {
  try {
    const db = getDb(), now = Date.now(), hour = 3_600_000;
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, ip));
    if (!row || now - row.windowStart > hour) {
      await db.insert(rateLimits).values({ key: ip, count: 1, windowStart: now })
        .onConflictDoUpdate({ target: rateLimits.key, set: { count: 1, windowStart: now } });
      return true;
    }
    if (row.count >= MESSAGES_PER_HOUR) return false;
    await db.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, ip));
    return true;
  } catch (e) {
    // If the limiter's table is missing, keep the game playable and log loudly.
    console.error('rate limiter unavailable', e);
    return true;
  }
}

function briefing(req: ChatRequest) {
  const c = CHARACTERS[req.character];
  const who = req.identity.main
    ? `The player is using their real, main screen name "${req.identity.screenName}". They are Dani's best friend from freshman year. ${req.character === 'kat' || req.character === 'eli' ? 'This character has heard Dani mention this friend but has never talked to them before.' : 'This character knows them.'}`
    : `The player is using an ALTERNATE screen name "${req.identity.screenName}". This character has no idea who is behind it and treats them as a stranger, unless the player convincingly explains who they are.`;
  const known = req.clues.length ? req.clues.map(id => `- ${CLUES[id]}`).join('\n') : '- nothing yet';
  return `BRIEFING FOR THIS TURN
You are playing: ${c.screenName} (${c.realName}, id: ${c.id}).
It is night ${req.night} of ${MAX_NIGHTS}. ${c.screenName}'s current away message: ${awayFor(c.id, req.night) || '(none, they are online)'}.
${who}
This character's current trust in this identity: ${req.trust} (scale -5 to 5).
What the player has learned so far (the character does NOT know this unless the player tells them):
${known}
Only give clues from this character's own sheet: ${c.canGiveClues.join(', ') || 'none'}. Only reveal: ${c.canReveal.join(', ') || 'nobody'}.
Respond as ${c.screenName} to the player's latest message.`;
}

export async function POST(request: Request) {
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'The game server is missing its AI key. The site owner needs to add ANTHROPIC_API_KEY.' }, { status: 503 });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Invalid origin' }, { status: 403 });

  let req: ChatRequest | null = null;
  try { req = parseRequest(await request.json()); } catch { /* handled below */ }
  if (!req) return Response.json({ error: 'That message could not be sent.' }, { status: 400 });

  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (!(await allowed(ip))) {
    return Response.json({ error: 'You’ve been chatting a lot! Take a short break and come back in a bit.' }, { status: 429 });
  }

  const c = CHARACTERS[req.character];
  const messages: Anthropic.Beta.BetaMessageParam[] = req.history.map(l => ({
    role: l.from === 'player' ? 'user' : 'assistant',
    content: l.from === 'player' ? `${req.identity.screenName}: ${l.text}` : l.text,
  }));
  if (messages[0].role !== 'user') messages.unshift({ role: 'user', content: `(${req.identity.screenName} opened an IM window)` });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: 'https://api.anthropic.com' });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: [
        { type: 'text', text: WORLD_BIBLE, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: briefing(req) },
      ],
      messages,
    });

    const text = response.content.find(b => b.type === 'text');
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens' || !text || text.type !== 'text') {
      return Response.json({ replies: ['hold on, my roommate needs the phone line. brb'], trustChange: 0, clues: [], reveal: [], signOff: false, ending: 'none' });
    }
    const out = JSON.parse(text.text) as Output;
    return Response.json({
      replies: out.replies.map(r => r.trim()).filter(Boolean).slice(0, 4),
      trustChange: Math.max(-2, Math.min(2, Math.round(out.trust_change))),
      // The AI can only hand out what this character actually knows.
      clues: out.clues.filter(id => (c.canGiveClues as string[]).includes(id)),
      reveal: out.reveal.filter(id => (c.canReveal as string[]).includes(id)),
      signOff: !!out.sign_off,
      ending: c.id === 'dani' ? out.ending : 'none',
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'The servers are busy right now. Try again in a minute.' }, { status: 503 });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic key rejected');
      return Response.json({ error: 'The game server’s AI key isn’t working. The site owner needs to check it.' }, { status: 503 });
    }
    console.error(e);
    return Response.json({ error: 'Connection dropped. Try sending that again.' }, { status: 502 });
  }
}
