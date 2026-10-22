// App retains these across dialog remounts, without credentials or SDK storage.
// Reloading the page cannot recover an uncertain server outcome.
export interface AccountDeletionOperation {
  readonly accountId: string;
  phase: 'deleting' | 'completing' | 'deleted' | 'cleanup-failed' | 'failed' | 'unknown';
}

export type AccountDeletionOperations = Map<string, AccountDeletionOperation>;
export interface AccountDeletionCompletion {
  readonly operation: AccountDeletionOperation;
  // Guards dialog-local UI only; confirmed account retirement survives it.
  readonly isCurrent: () => boolean;
}
export type CompleteAccountDeletion = (completion: AccountDeletionCompletion) => Promise<{ error: unknown | null }>;

export function deletionMessage(phase: AccountDeletionOperation['phase']): string {
  switch (phase) {
    case 'deleting': return 'Account deletion is in progress. It cannot be cancelled once sent.';
    case 'completing': return 'Account deletion confirmed. Finishing local cleanup…';
    case 'deleted': return 'Account deletion confirmed. Your saved sign-in was not removed automatically. Sign in to another account to continue.';
    case 'cleanup-failed': return 'Account deletion confirmed, but local cleanup could not finish. Do not submit deletion again. Close this dialog and reload to check your sign-in state.';
    case 'failed': return 'The database rejected the deletion request. Close this dialog and confirm again if you want to retry.';
    case 'unknown': return 'The server outcome is unknown. The account may have been deleted. Do not repeat deletion until you have verified the account status.';
  }
}

// Explicit PostgreSQL/PostgREST rejection establishes failure. Transport errors
// (including status 0), gateways and malformed responses do not.
export function isConfirmedDeletionFailure(response: { status?: number; error?: unknown }): boolean {
  const code = response.error && typeof response.error === 'object' && 'code' in response.error
    ? response.error.code : null;
  return typeof response.status === 'number' && response.status >= 400 && response.status < 600
    && typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d{3}$/.test(code));
}
