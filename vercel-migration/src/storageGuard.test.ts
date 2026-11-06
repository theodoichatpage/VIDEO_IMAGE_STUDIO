import { describe, expect, it } from 'vitest';
import { evictFor } from './storageGuard';

const fake = (data: Record<string, string>) => {
  const map = new Map(Object.entries(data));
  return { get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null, getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => { map.delete(k); }, map };
};
const mine = 'a'.repeat(32), other = 'b'.repeat(32);

describe('storage guard', () => {
  it('removes old copies first, then other projects, never the current project', () => {
    const store = fake({
      ['vis-automatic-analysis-v2-' + mine]: 'x'.repeat(400_000),
      ['vis-automatic-analysis-v2-' + mine + '-previous']: 'x'.repeat(300_000),
      ['vis-transcript-workspace-' + other]: 'x'.repeat(800_000),
      ['vis-script-draft-' + other]: 'x'.repeat(10_000),
      ['vis-script-draft-' + mine]: 'x'.repeat(300_000),
      'vis-session': mine,
    });
    const { removed } = evictFor(store, 'vis-script-draft', 500_000, mine);
    expect(removed[0]).toBe('vis-automatic-analysis-v2-' + mine + '-previous');
    expect(removed).toContain('vis-transcript-workspace-' + other);
    expect(store.map.has('vis-automatic-analysis-v2-' + mine)).toBe(true);
    expect(store.map.has('vis-script-draft-' + mine)).toBe(true);
    expect(store.map.has('vis-session')).toBe(true);
  });
  it('removes nothing when there is nothing it may remove', () => {
    const store = fake({ ['vis-script-draft-' + mine]: 'x'.repeat(300_000), 'vis-session': mine });
    expect(evictFor(store, 'vis-script-draft', 200_000, mine).removed).toEqual([]);
  });
});
