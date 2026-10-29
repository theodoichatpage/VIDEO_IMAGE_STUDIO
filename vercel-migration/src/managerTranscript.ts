// AI MANAGER -> Studio: "get transcript (and rewrite)" request for the open project, plus its progress.
export type ManagerTranscript = { id: string; sessionId: string; url: string; language?: string; rewrite: boolean; style?: string };
export type ManagerTranscriptState = { id: string; stage: string; attempts?: number; done?: number; total?: number; error?: string; at?: number };
const COMMAND = 'vis-manager-transcript', STATE = 'vis-manager-transcript-state';
const read = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
export const readManagerTranscript = () => read<ManagerTranscript>(COMMAND);
export const readManagerTranscriptState = () => read<ManagerTranscriptState>(STATE);
export const writeManagerTranscriptState = (state: ManagerTranscriptState) => { try { localStorage.setItem(STATE, JSON.stringify(state)); } catch { /* best effort */ } };
const YOUTUBE = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{6,}/;
// Accept a command only for this project and only with a real YouTube link; a new id replaces the old one.
export function acceptManagerTranscript(raw: unknown, sessionId: string) {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as Record<string, unknown>;
  const id = String(c.id || ''), url = String(c.url || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || !YOUTUBE.test(url) || c.type !== 'transcript_pipeline') return false;
  if (readManagerTranscript()?.id === id) return true;
  const command: ManagerTranscript = { id, sessionId, url, language: c.language === 'en' ? 'en' : 'vi', rewrite: c.rewrite !== false, style: typeof c.style === 'string' ? c.style.slice(0, 20000) : undefined };
  try { localStorage.setItem(COMMAND, JSON.stringify(command)); } catch { return false; }
  return true;
}
