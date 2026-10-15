// Deterministic browser broker: every coordinator/channel is independent; only
// the origin's native lock queue and cross-context message transport are shared.
// No storage event is dispatched to a writer (jsdom does not implement tabs).
export function practiceBrowser() {
  type Request = { callback: LockGrantedCallback; resolve: (value: unknown) => void;
    reject: (reason: unknown) => void; signal?: AbortSignal; abort?: () => void };
  const held = new Map<string, Request>();
  const queued = new Map<string, Request[]>();
  const grant = (name: string, request: Request) => {
    held.set(name, request);
    if (request.abort) request.signal?.removeEventListener('abort', request.abort);
    void Promise.resolve().then(() => request.callback({ name, mode: 'exclusive' })).then(request.resolve, request.reject).finally(() => {
      held.delete(name);
      const next = queued.get(name)?.shift();
      if (next) grant(name, next);
    });
  };
  const request = ((name: string, options: LockOptions | LockGrantedCallback, callback?: LockGrantedCallback) => {
    const settings = typeof options === 'function' ? {} : options;
    const handler = typeof options === 'function' ? options : callback!;
    return new Promise((resolve, reject) => {
      if (settings.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const item: Request = { callback: handler, resolve, reject, signal: settings.signal };
      if (!held.has(name)) { grant(name, item); return; }
      if (settings.ifAvailable) { void Promise.resolve().then(() => handler(null)).then(resolve, reject); return; }
      const queue = queued.get(name) ?? [];
      queued.set(name, queue);
      queue.push(item);
      item.abort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) { queue.splice(index, 1); reject(new DOMException('Aborted', 'AbortError')); }
      };
      settings.signal?.addEventListener('abort', item.abort, { once: true });
    });
  }) as LockManager['request'];
  const locks = { request, query: async () => ({ held: [...held.keys()].map(name => ({ name, mode: 'exclusive' as const })), pending: [] }) } as LockManager;

  const channels = new Set<Channel>();
  class Channel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly name: string) { channels.add(this); }
    postMessage(data: unknown) {
      for (const other of channels) {
        if (other === this || other.name !== this.name) continue;
        queueMicrotask(() => { if (channels.has(other)) other.onmessage?.(new MessageEvent('message', { data: structuredClone(data) })); });
      }
    }
    close() { channels.delete(this); }
  }
  return { locks, BroadcastChannel: Channel };
}
