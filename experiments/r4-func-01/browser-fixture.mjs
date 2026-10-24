// Synthetic in-memory service. No SDK, project URL, credentials or HTTP transport.
const account = id => ({ id, email: `${id}@example.com` });
let user = account('audit-a');
const listeners = new Set();
let release;
const events = [];
const now = '2026-01-01T00:00:00.123456Z';
const words = ['cat', 'dog', 'bird'].map((name, i) => ({ id: `word-${i}`, user_id: user.id,
  english_word: name, georgian_definitions: [['კატა'], ['ძაღლი'], ['ჩიტი']][i],
  description: 'Synthetic audit example', part_of_speech: 'noun', is_irregular_verb: false,
  past_simple: null, past_participle: null, created_at: now, updated_at: now }));
const tables = { words, test_history: [], profiles: [{ id: 'audit-a', display_name: 'Audit A' }, { id: 'audit-b', display_name: 'Audit B' }] };
const session = () => user ? { user } : null;
export function switchAccount(id) { user = id ? account(id) : null; listeners.forEach(fn => fn('SIGNED_IN', session())); }
export function releaseProfile() { release?.(); release = null; }
export const auditEvents = () => JSON.stringify(events);
export const supabase = {
  auth: {
    async getSession() { return { data: { session: session() }, error: null }; },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
    async signInWithPassword() { switchAccount('audit-a'); return { error: null }; },
    async signUp() { return { error: null }; },
    async signOut() { switchAccount(null); return { error: null }; },
    async updateUser(payload) { events.push({ action: 'updateUser', uid: user?.id, payload }); return { error: null }; },
  },
  from(table) {
    if (!Object.hasOwn(tables, table)) throw Error('Unknown synthetic table');
    let op = 'read', payload, start = 0, end = Infinity, single = false;
    const filters = [], orders = [];
    const q = {
      select() { return q; }, eq(k, v) { filters.push(row => row[k] === v); return q; },
      in(k, values) { filters.push(row => values.includes(row[k])); return q; },
      order(k, options) { orders.push([k, options.ascending]); return q; },
      range(a, b) { start = a; end = b; return q; }, maybeSingle() { single = true; return q; },
      insert(value) { op = 'insert'; payload = value; return q; },
      update(value) { op = 'update'; payload = value; return q; },
      upsert(value) { op = 'upsert'; payload = value; return q; }, delete() { op = 'delete'; return q; },
      async then(ok, fail) {
        try {
          let rows = tables[table].filter(row => (table === 'profiles' ? row.id : row.user_id) === user?.id && filters.every(fn => fn(row)));
          if (op === 'upsert' && table === 'profiles') {
            events.push({ action: 'profile-pending', uid: user.id });
            await new Promise(resolve => { release = resolve; });
            // Already-authorized synthetic A request completes after account change.
            Object.assign(tables.profiles.find(row => row.id === payload.id), payload);
          } else if (op === 'insert') {
            if (payload.user_id !== user?.id) throw Error('Wrong synthetic owner');
            const record = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...payload };
            tables[table].push(record); rows = [record];
          } else if (op === 'update') rows.forEach(row => Object.assign(row, payload, { updated_at: new Date().toISOString() }));
          else if (op === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
          const count = rows.length;
          rows.sort((a, b) => { for (const [key, asc] of orders) { const diff = String(a[key]).localeCompare(String(b[key])); if (diff) return asc ? diff : -diff; } return 0; });
          const data = single ? rows[0] ?? null : rows.slice(start, Math.min(end + 1, start + 500));
          return ok({ data, count, error: null });
        } catch (error) { if (fail) return fail(error); throw error; }
      },
    };
    return q;
  },
  rpc(name, args) {
    if (!['search_words', 'search_words_count'].includes(name)) throw Error('RPC forbidden by audit fixture');
    let rows = tables.words.filter(row => row.user_id === user?.id && row.user_id === args.p_user_id &&
      `${row.english_word} ${row.georgian_definitions.join(' ')}`.toLowerCase().includes(args.p_term.toLowerCase()));
    rows.sort((a, b) => args.p_sort === 'recent' ? b.created_at.localeCompare(a.created_at) :
      (args.p_sort === 'alpha-desc' ? -1 : 1) * a.english_word.localeCompare(b.english_word));
    return Promise.resolve({ error: null, data: name === 'search_words_count' ? rows.length : rows.slice(args.p_offset, args.p_offset + args.p_limit) });
  },
};
