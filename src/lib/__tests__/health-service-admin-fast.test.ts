import { describe, it, expect, vi } from 'vitest';
import { adminHealthService } from '../health-service-admin';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

/**
 * Minimal fake Firestore covering only what logFast touches:
 * collection().get()/.add(), plus the where/orderBy/limit chain used
 * elsewhere in the file (unused here but kept chainable for safety).
 */
function fakeDb(initialDocs: Array<{ id: string; data: Record<string, unknown> }>) {
  const docs = initialDocs.map(d => ({ ...d }));
  const added: Record<string, unknown>[] = [];
  const updated: Record<string, { id: string; patch: Record<string, unknown> }> = {};

  const collectionRef = {
    get: async () => ({
      docs: docs.map(d => ({
        id: d.id,
        data: () => d.data,
        ref: {
          update: async (patch: Record<string, unknown>) => {
            Object.assign(d.data, patch);
            updated[d.id] = { id: d.id, patch };
          },
        },
      })),
    }),
    add: async (obj: Record<string, unknown>) => {
      const id = `new-${added.length}`;
      added.push(obj);
      docs.push({ id, data: obj });
      return { id };
    },
    where: () => collectionRef,
    orderBy: () => collectionRef,
    limit: () => collectionRef,
  };

  return {
    db: { collection: () => collectionRef } as unknown as FirebaseFirestore.Firestore,
    added,
    updated,
    docs,
  };
}

describe('adminHealthService.logFast', () => {
  it('creates a new active entry when nothing is open', async () => {
    const { db, added } = fakeDb([]);
    await adminHealthService.logFast(db, 'user1', {
      startedAt: '20:00',
      date: '2026-08-30',
    });
    expect(added).toHaveLength(1);
    expect(added[0].endedAt).toBeUndefined();
  });

  it('closes the existing open entry in place instead of creating a duplicate', async () => {
    const { db, added, docs } = fakeDb([
      { id: 'open-1', data: { startedAt: '20:00', date: '2026-08-29' } },
    ]);
    await adminHealthService.logFast(db, 'user1', {
      startedAt: '20:00',
      endedAt: '09:00',
      durationHours: 32,
      date: '2026-08-29',
    });
    expect(added).toHaveLength(0);
    expect(docs).toHaveLength(1);
    expect(docs[0].data).toMatchObject({ endedAt: '09:00', durationHours: 32 });
  });

  it('ignores a stale open entry when a brand new fast is started', async () => {
    const { db, added, docs } = fakeDb([
      { id: 'stale-open', data: { startedAt: '09:00', date: '2026-08-25' } },
    ]);
    await adminHealthService.logFast(db, 'user1', {
      startedAt: '21:00',
      date: '2026-08-30',
    });
    expect(docs.find(d => d.id === 'stale-open')?.data.ignored).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].endedAt).toBeUndefined();
  });
});
