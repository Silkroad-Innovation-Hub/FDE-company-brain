import type { BrainVectorLean } from '@librechat/data-schemas';
import { createVectorCache } from './cache';
import { fakeEmbedOne, FAKE_DIMS } from './__tests__/helpers/embed';

function row(
  kind: 'note' | 'log',
  refId: string,
  text: string,
  extra: { updatedAt?: Date; sourceAt?: Date; chunk?: number } = {},
): BrainVectorLean {
  const vector = fakeEmbedOne(text);
  return {
    _id: `${kind}-${refId}-${extra.chunk ?? 0}`,
    user: 'u1',
    kind,
    refId,
    chunk: extra.chunk ?? 0,
    title: refId,
    text,
    hash: text,
    embedModel: 'fake',
    dims: FAKE_DIMS,
    vector: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
    sourceAt: extra.sourceAt,
    updatedAt: extra.updatedAt ?? new Date(),
  } as unknown as BrainVectorLean;
}

describe('vector cache', () => {
  it('ranks by cosine similarity and refreshes incrementally by updatedAt', async () => {
    const store: BrainVectorLean[] = [
      row('note', 'Henderson Invoice', 'henderson invoice overdue 12400', {
        updatedAt: new Date(1000),
      }),
      row('note', 'Office Lease', 'office lease renews in march', { updatedAt: new Date(2000) }),
    ];
    const list = jest.fn(async (_user: string, options?: { updatedAfter?: Date }) =>
      store.filter((r) => !options?.updatedAfter || (r.updatedAt as Date) > options.updatedAfter),
    );
    const cache = createVectorCache({ listBrainVectors: list, logDays: 90, maxVectors: 100 });
    expect(await cache.loadOrRefresh('u1')).toBe(2);
    const hits = cache.topK('u1', fakeEmbedOne('what about the henderson invoice'), 2);
    expect(hits[0].meta.refId).toBe('Henderson Invoice');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);

    store.push(
      row('note', 'Dana Lee', 'dana lee ap contact henderson', { updatedAt: new Date(3000) }),
    );
    expect(await cache.loadOrRefresh('u1')).toBe(1);
    expect(list.mock.calls[1][1]?.updatedAfter).toEqual(new Date(2000));
    expect(cache.size('u1')).toBe(3);
  });

  it('replaces re-indexed chunks, forgets refs, and applies filters', async () => {
    const store: BrainVectorLean[] = [
      row('note', 'Acme', 'acme old summary', { updatedAt: new Date(1) }),
    ];
    const cache = createVectorCache({
      listBrainVectors: async (_u, o) =>
        store.filter((r) => !o?.updatedAfter || (r.updatedAt as Date) > o.updatedAfter),
      logDays: 90,
      maxVectors: 100,
    });
    await cache.loadOrRefresh('u1');
    store.push(
      row('note', 'Acme', 'acme brand new summary about rockets', { updatedAt: new Date(2) }),
    );
    await cache.loadOrRefresh('u1');
    expect(cache.size('u1')).toBe(1);
    expect(cache.topK('u1', fakeEmbedOne('rockets'), 1)[0].meta.text).toContain('rockets');
    expect(cache.topK('u1', fakeEmbedOne('rockets'), 1, (meta) => meta.kind === 'log')).toEqual([]);
    expect(cache.forget('u1', 'note', 'Acme')).toBe(1);
    expect(cache.size('u1')).toBe(0);
  });

  it('evicts log rows outside the window and oldest log rows over the cap, never notes', async () => {
    const day = 86_400_000;
    const now = new Date('2026-08-30T00:00:00Z');
    const rows = [
      row('note', 'Acme', 'acme', { updatedAt: new Date(1) }),
      row('log', 'l-old', 'old text', {
        updatedAt: new Date(2),
        sourceAt: new Date(now.getTime() - 200 * day),
      }),
      row('log', 'l-1', 'first', {
        updatedAt: new Date(3),
        sourceAt: new Date(now.getTime() - 10 * day),
      }),
      row('log', 'l-2', 'second', {
        updatedAt: new Date(4),
        sourceAt: new Date(now.getTime() - 5 * day),
      }),
      row('log', 'l-3', 'third', {
        updatedAt: new Date(5),
        sourceAt: new Date(now.getTime() - 1 * day),
      }),
    ];
    const cache = createVectorCache({
      listBrainVectors: async () => rows,
      logDays: 90,
      maxVectors: 3,
      now: () => now,
    });
    await cache.loadOrRefresh('u1');
    const kept = cache
      .topK('u1', fakeEmbedOne('anything'), 10)
      .map((hit) => hit.meta.refId)
      .sort();
    expect(kept).toEqual(['Acme', 'l-2', 'l-3']);
  });
});
