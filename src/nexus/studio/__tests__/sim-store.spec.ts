import { simulate } from '../simulate';
import { understand } from '../brain';
import { memoryKV, Projects, nameFrom, newId } from '../store';
import { newSession } from '../chat';

const ticks = (n: number) => { let x = 100, s = 7; return Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) % 2147483648; x += ((s % 200) - 100) / 100; return Math.round(x * 100) / 100; }); };

describe('history test', () => {
    const u = understand('even on vol 50, stake 1, martingale 2, take profit 5, stop loss 50')!;
    it('counts exactly and shows no profit without a payout', () => {
        const r = simulate(u.plan, ticks(3000), 2);
        expect(r.trades).toBeGreaterThan(100);
        expect(r.wins + r.losses).toBe(r.trades);
        expect(r.profit).toBeNull();
        expect(r.notes.join(' ')).toMatch(/not a promise/);
    });
    it('uses a real payout ratio when given and respects consecutive-even entries', () => {
        const p = understand('odd on vol 50 after 3 consecutive even, stake 1, take profit 3, stop loss 20')!.plan;
        const r = simulate(p, ticks(5000), 2, { DIGITODD: 1.95 });
        expect(r.profit).not.toBeNull();
        expect(r.trades).toBeGreaterThan(0);
    });
});
describe('storage', () => {
    it('keeps projects per account', async () => {
        const kv = memoryKV();
        const a = new Projects(kv, 'ROT1'), b = new Projects(kv, 'ROT2');
        const id = newId();
        await a.save({ id, name: 'x', session: newSession(), messages: [], updatedAt: 1 });
        expect((await a.list()).length).toBe(1);
        expect((await b.list()).length).toBe(0);
        await a.remove(id);
        expect((await a.list()).length).toBe(0);
    });
    it('only accepts real names, never account ids', () => {
        expect(nameFrom('Edwin')).toBe('Edwin');
        expect(nameFrom("call me ed")).toBe('Ed');
        expect(nameFrom('ROT90116785')).toBeNull();
        expect(nameFrom('even')).toBeNull();
        expect(nameFrom('make a bot on vol 50')).toBeNull();
    });
});
