// The browser keeps about 5 MB of localStorage per site. A long script is stored several times (draft, transcript workspace, analysis, hand-off),
// and every earlier project keeps its own copies, so a 300,000-character script can hit the quota. When a write fails, caches that can be rebuilt
// (old copies and the other projects' local data, all of it also kept on the Studio server) are removed, biggest first, and the write is retried.
type Store = { length: number; key(i: number): string | null; getItem(k: string): string | null; removeItem(k: string): void };
const ID = /[a-f0-9]{32}/;
const OLD_COPY = /-(history|previous)\b|backup/;

export function evictFor(store: Store, key: string, need: number, current: string) {
  const rows: { name: string; size: number; tier: number }[] = [];
  for (let i = 0; i < store.length; i++) {
    const name = store.key(i); if (!name || name === key) continue;
    const size = (store.getItem(name) || '').length;
    const other = ID.test(name) && !name.includes(current);
    if (OLD_COPY.test(name) && name.startsWith('vis-')) rows.push({ name, size, tier: 0 });
    else if (other && name.startsWith('vis-') && size > 5000) rows.push({ name, size, tier: 1 });
  }
  rows.sort((a, b) => a.tier - b.tier || b.size - a.size);
  let freed = 0; const removed: string[] = [];
  for (const row of rows) {
    if (freed >= need + 100_000) break;
    store.removeItem(row.name); freed += row.size; removed.push(row.name);
  }
  return { freed, removed };
}

export function installStorageGuard() {
  try {
    const original = Storage.prototype.setItem;
    if ((original as unknown as { guarded?: boolean }).guarded) return;
    const guarded = function (this: Storage, key: string, value: string) {
      try { return original.call(this, key, value); } catch (error) {
        if (this !== window.localStorage || !/quota/i.test(String((error as Error)?.name) + String((error as Error)?.message))) throw error;
        const { removed } = evictFor(this, key, String(value).length, this.getItem('vis-session') || '');
        if (!removed.length) throw error;
        console.warn('Bộ nhớ trình duyệt đầy: đã xóa ' + removed.length + ' bản lưu cũ để ghi ' + key);
        return original.call(this, key, value);
      }
    };
    (guarded as unknown as { guarded: boolean }).guarded = true;
    Storage.prototype.setItem = guarded;
  } catch { /* A browser without Storage keeps working as before. */ }
}
