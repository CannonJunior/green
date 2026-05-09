/**
 * Reminder skill — persistent, polled reminder delivery via Signal.
 *
 * Storage: ~/.local/share/green/reminders.json
 * Reminders are checked every 30 s; due ones are fired and removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface Reminder {
  id: string;
  text: string;
  dueAt: number; // ms since epoch
  createdAt: number;
}

const STORE = path.join(os.homedir(), '.local', 'share', 'green', 'reminders.json');

function load(): Reminder[] {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8')) as Reminder[];
  } catch {
    return [];
  }
}

function save(reminders: Reminder[]): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(reminders, null, 2));
}

function genId(): string {
  const existing = load();
  const max = existing.reduce((m, r) => Math.max(m, parseInt(r.id, 10) || 0), 0);
  return String(max + 1).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface ParsedRemind {
  message: string;
  dueAt: Date;
}

/**
 * Extract a time expression from the end of an /remind argument.
 * Returns { message, dueAt } or null if no recognizable time pattern is found.
 *
 * Supported patterns (case-insensitive, at end of string):
 *   "in N seconds|minutes|hours|days|weeks"
 *   "at H[:MM] [am|pm]"
 *   "tomorrow [at H[:MM] [am|pm]]"
 *   "in N days [at H[:MM] [am|pm]]"
 */
export function parseRemind(arg: string): ParsedRemind | null {
  const now = new Date();
  const s = arg.trim();

  // "... in N unit[s]" — relative delay
  const inRel = s.match(/^(.+?)\s+in\s+(\d+)\s+(second|minute|hour|day|week)s?\s*$/i);
  if (inRel) {
    const n = parseInt(inRel[2], 10);
    const unit = inRel[3].toLowerCase() as 'second' | 'minute' | 'hour' | 'day' | 'week';
    const ms: Record<typeof unit, number> = {
      second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000,
    };
    return { message: inRel[1].trim(), dueAt: new Date(Date.now() + n * ms[unit]) };
  }

  // "... in N days at H[:MM] [am|pm]"
  const inDaysAt = s.match(/^(.+?)\s+in\s+(\d+)\s+days?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
  if (inDaysAt) {
    const dueAt = new Date(now);
    dueAt.setDate(dueAt.getDate() + parseInt(inDaysAt[2], 10));
    applyTime(dueAt, inDaysAt[3], inDaysAt[4], inDaysAt[5]);
    return { message: inDaysAt[1].trim(), dueAt };
  }

  // "... tomorrow [at H[:MM] [am|pm]]"
  const tmrw = s.match(/^(.+?)\s+tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s*$/i);
  if (tmrw) {
    const dueAt = new Date(now);
    dueAt.setDate(dueAt.getDate() + 1);
    if (tmrw[2]) {
      applyTime(dueAt, tmrw[2], tmrw[3], tmrw[4]);
    } else {
      dueAt.setHours(9, 0, 0, 0); // default: 9am
    }
    return { message: tmrw[1].trim(), dueAt };
  }

  // "... at H[:MM] [am|pm]" — next occurrence of that clock time
  const atTime = s.match(/^(.+?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
  if (atTime) {
    const dueAt = new Date(now);
    applyTime(dueAt, atTime[2], atTime[3], atTime[4]);
    if (dueAt <= now) dueAt.setDate(dueAt.getDate() + 1); // next occurrence
    return { message: atTime[1].trim(), dueAt };
  }

  return null;
}

function applyTime(date: Date, hourStr: string, minuteStr: string | undefined, ampm: string | undefined): void {
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
  const meridiem = ampm?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  date.setHours(hour, minute, 0, 0);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function addReminder(message: string, dueAt: Date): { id: string; formattedDue: string } {
  const id = genId();
  const reminders = load();
  reminders.push({ id, text: message, dueAt: dueAt.getTime(), createdAt: Date.now() });
  save(reminders);
  return { id, formattedDue: formatAbsolute(dueAt) };
}

export function listReminders(): string {
  const pending = load()
    .filter(r => r.dueAt > Date.now())
    .sort((a, b) => a.dueAt - b.dueAt);

  if (pending.length === 0) return 'No pending reminders.';

  const lines = [`Pending reminders (${pending.length}):`];
  for (const r of pending) {
    lines.push(`#${r.id} — ${r.text} — ${formatRelative(r.dueAt)}`);
  }
  return lines.join('\n');
}

export function cancelReminder(id: string): boolean {
  const reminders = load();
  const before = reminders.length;
  save(reminders.filter(r => r.id !== id));
  return reminders.length > before;
}

export function cancelAllReminders(): number {
  const reminders = load();
  const count = reminders.filter(r => r.dueAt > Date.now()).length;
  save(reminders.filter(r => r.dueAt <= Date.now()));
  return count;
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

/** Poll every 30 s and fire any due reminders via `send`. */
export function startReminderPoller(send: (text: string) => Promise<void>): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    const now = Date.now();
    const all = load();
    const due = all.filter(r => r.dueAt <= now);
    if (due.length === 0) return;

    save(all.filter(r => r.dueAt > now));

    for (const r of due) {
      try {
        await send(`Reminder: ${r.text}`);
      } catch (err) {
        console.error('[remind] send failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatRelative(dueAt: number): string {
  const diff = dueAt - Date.now();
  if (diff < 0) return 'overdue';
  const totalMinutes = Math.ceil(diff / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
  return formatAbsolute(new Date(dueAt));
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
