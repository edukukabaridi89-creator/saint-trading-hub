import type { Session } from './chat';

/**
 * Browser-only storage for Bot Studio. Saved projects and chats go to IndexedDB, the preferred name to localStorage, and
 * everything is keyed by the signed-in account id (a public id such as ROT123, never a token or password), so people sharing
 * a browser do not see each other's work. Clearing site data or using another device starts empty.
 */

export type ChatMsg = { id: number; role: 'bot' | 'user'; text: string };
export type Project = { id: string; name: string; session: Session; messages: ChatMsg[]; updatedAt: number; botId?: string };

export interface KV {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown): Promise<void>;
    del(key: string): Promise<void>;
    keys(prefix: string): Promise<string[]>;
}

export const memoryKV = (): KV => {
    const m = new Map<string, unknown>();
    return {
        get: async k => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined),
        put: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); },
        del: async k => { m.delete(k); },
        keys: async p => [...m.keys()].filter(k => k.startsWith(p)),
    };
};

export const idbKV = (): KV | null => {
    if (typeof indexedDB === 'undefined') return null;
    let dbp: Promise<IDBDatabase> | null = null;
    const db = () => (dbp ??= new Promise((res, rej) => {
        const r = indexedDB.open('saint-studio', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    }));
    const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
        const d = await db();
        return new Promise((res, rej) => {
            const q = f(d.transaction('kv', mode).objectStore('kv'));
            q.onsuccess = () => res(q.result);
            q.onerror = () => rej(q.error);
        });
    };
    return {
        get: k => run('readonly', s => s.get(k)),
        put: async (k, v) => { await run('readwrite', s => s.put(v, k)); },
        del: async k => { await run('readwrite', s => s.delete(k)); },
        keys: async p => ((await run('readonly', s => s.getAllKeys())) as string[]).filter(k => String(k).startsWith(p)).map(String),
    };
};

/** Public account id of the signed-in user, or "guest". Never a token. */
export const accountId = (): string => {
    try {
        const v = localStorage.getItem('active_loginid');
        return v && v !== 'undefined' && v !== 'null' ? v : 'guest';
    } catch { return 'guest'; }
};

const nameKey = (acct: string) => `nx_studio_name:${acct}`;
export const getName = (acct = accountId()): string => { try { return localStorage.getItem(nameKey(acct)) ?? ''; } catch { return ''; } };
export const setName = (name: string, acct = accountId()) => { try { name.trim() ? localStorage.setItem(nameKey(acct), name.trim().slice(0, 30)) : localStorage.removeItem(nameKey(acct)); } catch { /* storage blocked */ } };
/** A reply that looks like someone giving their name ("Edwin", "call me Ed", "I'm Edwin"), not a bot request. Never a ROT id. */
export const nameFrom = (text: string): string | null => {
    const m = text.trim().match(/^(?:(?:please\s+)?call me|my name is|i am|i'm|im|it'?s|this is)?\s*([A-Za-z][A-Za-z'-]{1,19}(?:\s[A-Za-z][A-Za-z'-]{1,19})?)\s*[.!]?$/i);
    if (!m) return null;
    if (/^(?:yes|no|ok|okay|even|odd|over|under|hello|hi|hey|start|help|skip|nothing|later|undo|rise|fall|matches|differs)$/i.test(m[1]) || /^(?:rot|cr|vrt|dot|vr|mf)\d/i.test(m[1])) return null;
    return m[1].replace(/\b\w/g, c => c.toUpperCase());
};

export class Projects {
    constructor(private kv: KV, private acct: string) {}
    private key = (id: string) => `proj:${this.acct}:${id}`;
    async save(p: Project) { await this.kv.put(this.key(p.id), { ...p, updatedAt: Date.now() }); }
    async load(id: string) { return (await this.kv.get(this.key(id))) as Project | undefined; }
    async remove(id: string) { await this.kv.del(this.key(id)); }
    async list(): Promise<Project[]> {
        const ks = await this.kv.keys(`proj:${this.acct}:`);
        const all = (await Promise.all(ks.map(k => this.kv.get(k)))) as Project[];
        return all.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
    }
}
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
