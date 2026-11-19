import { syncosFetch, type SyncRecord } from './api';
/** Fetch every page from an explicitly paged directory; never report partial data as complete. */
export async function completeDirectory(path: string, token: string) {
  const rows: SyncRecord[] = [], seen = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await syncosFetch<SyncRecord[]>(`${path}${separator}limit=200&offset=${offset}`, {token});
    if (!Array.isArray(page)) throw new Error('Could not load the complete directory. Retry the refresh.');
    for (const row of page) {
      const id = String(row.id ?? '');
      if (!id || seen.has(id)) throw new Error('Records changed while loading. Refresh to review a complete list.');
      seen.add(id); rows.push(row);
    }
    if (page.length < 200) return rows;
  }
}
/** Bound concurrent requests, preserving errors instead of silently dropping a batch. */
export async function completeBatchItems(batches: SyncRecord[], prefix: string, token: string) {
  const result: SyncRecord[] = [];
  for (let index = 0; index < batches.length; index += 4) {
    const groups = await Promise.all(batches.slice(index, index + 4).map(batch => syncosFetch<SyncRecord[]>(`${prefix}/${batch.id}/items`, {token})));
    for (const group of groups) { if (!Array.isArray(group)) throw new Error('Could not load all batch items. Retry the refresh.'); result.push(...group); }
  }
  return result;
}
