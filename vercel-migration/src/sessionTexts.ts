// Egress: after one full read, the page asks for `reply=lean` (only the changing part of the project plus a
// fingerprint of its text). The text kept from the full read is merged back; a different fingerprint means the
// text changed, and the page reads the full project once. Field lists match supabase/functions/studio-api.
type Loose = Record<string, any>;
const TOP = ['script', 'stylePrompt', 'rewrite'];
const PART = ['title', 'content', 'range', 'analysisText'];
const SCENE = ['title', 'backdrop', 'content', 'character', 'emotion', 'shot', 'prompt'];
export function mergeLean<T>(lean: T, full: Loose): T {
  const out = structuredClone(lean) as Loose;
  for (const k of TOP) if (!(k in out) && k in full) out[k] = full[k];
  if (out.lastJob && !('prompt' in out.lastJob) && full.lastJob?.id === out.lastJob.id && 'prompt' in (full.lastJob || {})) out.lastJob.prompt = full.lastJob.prompt;
  const old = new Map<string, Loose>((full.parts || []).map((p: Loose) => [String(p.id), p]));
  for (const part of out.parts || []) {
    const src = old.get(String(part.id)); if (!src) continue;
    for (const k of PART) if (!(k in part) && k in src) part[k] = src[k];
    (part.scenes || []).forEach((scene: Loose, i: number) => { const ref = src.scenes?.[i]; if (ref) for (const k of SCENE) if (!(k in scene) && k in ref) scene[k] = ref[k]; });
  }
  return out as T;
}
