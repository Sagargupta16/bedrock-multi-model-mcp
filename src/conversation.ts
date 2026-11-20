import { getModelInfo } from "./models.js";

export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DEFAULT_TTL_MS = 30 * 60 * 1000;
export const MAX_CONVERSATIONS = 50;
export const MAX_TURNS = 20;
export const MAX_CONVERSATION_CHARS = 200000;

export interface ConversationTurn {
  prompt: string;
  reply: string;
  modelId: string;
  at: number;
}

export interface ConversationStoreOptions {
  ttlMs?: number;
  maxConversations?: number;
  maxTurns?: number;
  maxChars?: number;
  now?: () => number;
}

interface Entry {
  turns: ConversationTurn[];
  expiresAt: number;
}

// In-memory only. Expiry is checked lazily on each call, so there are no timers
// and the process can exit freely. A Map keeps insertion order; re-inserting on
// append makes the first key the least recently appended to.
export class ConversationStore {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxConversations: number;
  private readonly maxTurns: number;
  private readonly maxChars: number;
  private readonly now: () => number;

  constructor(options: ConversationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxConversations = options.maxConversations ?? MAX_CONVERSATIONS;
    this.maxTurns = options.maxTurns ?? MAX_TURNS;
    this.maxChars = options.maxChars ?? MAX_CONVERSATION_CHARS;
    this.now = options.now ?? Date.now;
  }

  private live(id: string): Entry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry;
  }

  private prune(): void {
    for (const id of [...this.entries.keys()]) this.live(id);
  }

  turns(id: string): ConversationTurn[] {
    return this.live(id)?.turns.map((t) => ({ ...t })) ?? [];
  }

  // Returns false when the turn was not kept: an empty reply, or a turn that is
  // larger than the character cap on its own. The cap is a hard memory bound, so
  // such a turn is skipped and the earlier turns stay as they were.
  append(id: string, turn: { prompt: string; reply: string; modelId: string }): boolean {
    if (!CONVERSATION_ID_PATTERN.test(id)) {
      throw new Error(
        `Invalid conversation_id: use 1 to 64 letters, digits, "-" or "_" (pattern ${CONVERSATION_ID_PATTERN.source}).`,
      );
    }
    if (!turn.reply.trim()) return false;
    if (turn.prompt.length + turn.reply.length > this.maxChars) return false;
    const at = this.now();
    const existing = this.live(id);
    const turns = existing?.turns ?? [];
    turns.push({ prompt: turn.prompt, reply: turn.reply, modelId: turn.modelId, at });
    const size = () => turns.reduce((n, t) => n + t.prompt.length + t.reply.length, 0);
    while (turns.length > this.maxTurns || size() > this.maxChars) turns.shift();
    this.entries.delete(id);
    this.entries.set(id, { turns, expiresAt: at + this.ttlMs });
    this.prune();
    while (this.entries.size > this.maxConversations) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }

  buildPrompt(id: string, prompt: string): string {
    const turns = this.turns(id);
    if (turns.length === 0) return prompt;
    const parts = ["Earlier turns of this conversation:"];
    for (const t of turns) {
      const name = getModelInfo(t.modelId)?.name ?? t.modelId;
      parts.push(`User:\n${t.prompt}`, `Assistant (${name}):\n${t.reply}`);
    }
    parts.push("The user's new message:", prompt);
    return parts.join("\n\n");
  }

  clear(id: string): boolean {
    return this.entries.delete(id);
  }

  size(): number {
    this.prune();
    return this.entries.size;
  }
}

export const conversations = new ConversationStore();

export function conversationHelp(): string {
  return (
    "Optional conversation_id turns on a follow-up conversation: earlier turns of the same id are sent along as context. " +
    `It is kept in memory only, forgotten ${DEFAULT_TTL_MS / 60000} minutes after the last turn or when the server restarts, ` +
    `holds at most ${MAX_TURNS} turns, and the id is 1 to 64 letters, digits, "-" or "_". ` +
    "Attached file contents are kept with their turn and sent again on each follow-up, to whichever model that follow-up names."
  );
}
