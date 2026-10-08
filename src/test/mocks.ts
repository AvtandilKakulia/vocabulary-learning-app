import { beforeEach, vi } from 'vitest';

const { supabaseMock, authMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn() },
  authMock: { user: { id: 'user-a' } as { id: string } | null },
}));

export { supabaseMock, authMock };

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authMock }));

beforeEach(() => {
  authMock.user = { id: 'user-a' };
  supabaseMock.from.mockReset().mockImplementation((table) => {
    throw new Error(`Unexpected Supabase table: ${table}`);
  });
  supabaseMock.rpc.mockReset().mockImplementation((name) => {
    throw new Error(`Unexpected Supabase RPC: ${name}`);
  });
});

export interface QueryResult {
  data?: unknown;
  error: { message: string } | null;
  count?: number;
}

// Only records the fluent query contract; it deliberately does not emulate a DB.
export function query(result: QueryResult | Promise<QueryResult> = { error: null }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: <T, U>(resolve?: (value: QueryResult) => T, reject?: (reason: unknown) => U) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
