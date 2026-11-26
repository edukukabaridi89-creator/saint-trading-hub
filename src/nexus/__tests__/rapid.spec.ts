jest.mock('../dispatcher', () => ({ dispatch: jest.fn() }));
jest.mock('../store', () => ({ nexus: { log: jest.fn(), root: { client: { currency: 'USD' } } } }));
jest.mock('@/external/bot-skeleton/utils/observer', () => ({ observer: { emit: jest.fn() } }));
jest.mock('../voice-say', () => ({ say: jest.fn(), sayReady: () => false }));
jest.mock('../ticks-hub', () => {
    const feeds: any = {};
    const listeners = new Set<any>();
    return {
        hub: {
            feeds,
            feed: (s: string) => feeds[s],
            watch: jest.fn(),
            onTick: (fn: any) => (listeners.add(fn), () => listeners.delete(fn)),
            tick: (s: string, d: number, out: number | undefined) => {
                const f = feeds[s] || (feeds[s] = { digits: Array(1000).fill(0), prices: [], outs: [], seq: 0 });
                f.digits.push(d); f.digits.shift(); f.outs.push(out); f.seq++;
                listeners.forEach(l => l(s, f.seq));
            },
        },
    };
});
import { recentRisers, roseAt, testRule } from '../rise';
import { fireNow, sx, stopRapid } from '../rapid';
import { eo, stakeFor } from '../eo-rapid';
import { hub } from '../ticks-hub';
import { dispatch } from '../dispatcher';
import { renderHook } from '@testing-library/react';
import { useRapidEngine } from '../rapid';

const H: any = hub;

describe('rise rule', () => {
    beforeEach(() => { Object.keys(H.feeds).forEach(k => delete H.feeds[k]); });
    it('a digit rose when the digit that left the window is different, and stayed level when it is the same', () => {
        H.tick('R_100', 7, 3); // 7 landed, a 3 left: 7 rose
        expect(roseAt('R_100', 0)).toBe(true);
        H.tick('R_100', 8, 8); // 8 landed, an 8 left: level
        expect(roseAt('R_100', 0)).toBe(false);
        expect(roseAt('R_100', 1)).toBe(true);
        expect(recentRisers('R_100', 2)).toEqual([7]);
    });
    it('unknown outgoing digit is never counted as a rise', () => {
        H.tick('R_100', 5, undefined);
        expect(roseAt('R_100', 0)).toBe(false);
    });
    it('history test finds setups and counts hits within the next runs', () => {
        const W = 1000;
        const digits = Array.from({ length: W + 60 }, (_, i) => (i * 7 + 3) % 10);
        const r = testRule(digits, 4, false);
        expect(r.ticks).toBe(60);
        expect(r.chance).toBeCloseTo(34.39, 1);
        expect(r.hits).toBeLessThanOrEqual(r.triggers);
    });
});

describe('rapid firing', () => {
    beforeEach(() => {
        Object.keys(H.feeds).forEach(k => delete H.feeds[k]);
        (dispatch as jest.Mock).mockReset();
        (dispatch as jest.Mock).mockImplementation(() => new Promise(() => {})); // trades stay open
        stopRapid(); sx.symbol = 'R_100'; sx.digitMode = 'auto'; sx.runs = 4; sx.stake = 1; sx.trick = false; sx.fired = 0;
    });
    it('fires one buy per tick, runs times, same stake and digit, without waiting for results', () => {
        const { unmount } = renderHook(() => useRapidEngine());
        sx.running = true;
        H.tick('R_100', 7, 2); // 7 rose
        H.tick('R_100', 3, 5); // cursor moved on, the leaving digit was not 7: 7 keeps its rise -> first buy now
        expect(dispatch).toHaveBeenCalledTimes(1);
        H.tick('R_100', 1, 4);
        H.tick('R_100', 9, 0);
        H.tick('R_100', 2, 6);
        H.tick('R_100', 4, 6); // no fifth run
        expect(dispatch).toHaveBeenCalledTimes(4);
        (dispatch as jest.Mock).mock.calls.forEach(([req]) => {
            expect(req).toMatchObject({ contract_type: 'DIGITMATCH', barrier: 7, stake: 1, symbol: 'R_100' });
        });
        stopRapid();
        unmount();
    });
    it('does not fire when the digit loses its rise after the cursor leaves (the same digit drops out)', () => {
        const { unmount } = renderHook(() => useRapidEngine());
        sx.running = true;
        H.tick('R_100', 7, 2);
        H.tick('R_100', 3, 7); // a 7 left the window: 7's share dropped back
        expect(dispatch).not.toHaveBeenCalled();
        unmount();
    });
    it('manual digit only reacts to that digit', () => {
        const { unmount } = renderHook(() => useRapidEngine());
        sx.running = true; sx.digitMode = 'manual'; sx.digit = 4;
        H.tick('R_100', 7, 2); H.tick('R_100', 3, 5);
        expect(dispatch).not.toHaveBeenCalled();
        H.tick('R_100', 4, 2); H.tick('R_100', 3, 5);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect((dispatch as jest.Mock).mock.calls[0][0].barrier).toBe(4);
        stopRapid();
        unmount();
    });
    it('stops sending when a run wins (stop on hit)', async () => {
        (dispatch as jest.Mock).mockImplementation(() => Promise.resolve({ contract_id: 1, profit: 8, won: true }));
        const { unmount } = renderHook(() => useRapidEngine());
        sx.running = true; sx.stopOnHit = true;
        H.tick('R_100', 7, 2); H.tick('R_100', 3, 5);
        await Promise.resolve(); await Promise.resolve();
        H.tick('R_100', 7, 5);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(sx.pnl).toBe(8);
        stopRapid();
        unmount();
    });
});

describe('Even/Odd rapid stakes', () => {
    it('both chains: each run uses its own chain', () => {
        eo.version = 'both'; eo.stake = 1; eo.mult = 2; eo.max = 4; eo.chainA = 1; eo.chainB = 2;
        expect(stakeFor(1)).toBe(2); // odd chain, 1 loss
        expect(stakeFor(2)).toBe(4); // even chain, 2 losses
        expect(stakeFor(3)).toBe(2);
    });
    it('odd only: even runs always use the base stake', () => {
        eo.version = 'odd'; eo.chainA = 2; eo.chainB = 3;
        expect(stakeFor(3)).toBe(4);
        expect(stakeFor(4)).toBe(1);
    });
    it('caps at max steps', () => {
        eo.version = 'both'; eo.max = 2; eo.chainA = 5;
        expect(stakeFor(1)).toBe(4);
    });
});
