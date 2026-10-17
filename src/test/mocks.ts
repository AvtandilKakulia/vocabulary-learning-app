import { beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';

const { supabaseMock, authMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn(), auth: { updateUser: vi.fn() } },
  authMock: { user: { id: 'user-a' } as { id: string; email?: string } | null },
}));

export { supabaseMock, authMock };

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => {
  authMock.user = { id: 'user-a' };
  supabaseMock.auth.updateUser.mockReset();
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
  count?: number | null;
}

// Records the fluent contract. Array fixtures represent the complete result;
// supply an explicit count for partial pages (range-aware tests use a server mock).
export function query(result: QueryResult | Promise<QueryResult> = { error: null }) {
  let exactCount = false;
  const chain = {
    select: vi.fn().mockImplementation((_columns?: string, options?: { count?: string }) => {
      exactCount = options?.count === 'exact';
      return chain;
    }),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: <T, U>(resolve?: (value: QueryResult) => T, reject?: (reason: unknown) => U) =>
      Promise.resolve(result).then(value => {
        const response = exactCount && value.count === undefined && Array.isArray(value.data)
          ? { ...value, count: value.data.length } : value;
        return resolve ? resolve(response) : response;
      }, reject),
  };
  return chain;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
