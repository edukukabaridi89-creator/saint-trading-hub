jest.mock('../dispatcher', () => ({ dispatch: jest.fn() }));
jest.mock('../store', () => ({ nexus: { log: jest.fn(), autoOn: false, root: { client: { currency: 'USD' } } } }));
jest.mock('@/external/bot-skeleton/utils/observer', () => ({ observer: { emit: jest.fn() } }));
jest.mock('../voice-say', () => ({ say: jest.fn() }));
jest.mock('../ticks-hub', () => {
    const feeds: any = {};
    const listeners = new Set<any>();
    return {
        hub: {
            feed: (s: string) => feeds[s],
            watch: jest.fn(),
            watchAll: jest.fn(),
            distribution: () => Array(10).fill(10),
            isUnavailable: () => false,
            onTick: (fn: any) => (listeners.add(fn), () => listeners.delete(fn)),
            tick: (s: string, d: number) => {
                const f = feeds[s] || (feeds[s] = { digits: Array(1000).fill(0), seq: 0, outs: [] });
                f.digits.push(d); f.digits.shift(); f.seq++;
                listeners.forEach(l => l(s, f.seq));
            },
        },
    };
});
import { renderHook } from '@testing-library/react';
import { auto, loadSuggestion, startAi, useAutoEngine } from '../auto-engine';
import { dispatch } from '../dispatcher';
import { speedState } from '../speed';
import { nexus } from '../store';
import { hub } from '../ticks-hub';
import { CANDIDATES } from '../signals';

const H: any = hub;
const suggestion: any = { symbol: 'R_100', type: 'DIGITOVER', barrier: 3, label: 'Over 3', edge: 0, z: 3, trigger: 7, rate: 60, samples: 100 };

describe('Auto Trader: entry once, then consecutive runs', () => {
    beforeEach(() => {
        (dispatch as jest.Mock).mockReset();
        (dispatch as jest.Mock).mockImplementation(() => new Promise(() => {}));
        (speedState as any).mode = 'TURBO';
        auto.ai = true; auto.keep = true; auto.ttl = 3600;
        loadSuggestion(suggestion);
    });
    it('waits for the entry digit once, then trades on every following tick', () => {
        const { unmount } = renderHook(() => useAutoEngine());
        startAi();
        H.tick('R_100', 1); H.tick('R_100', 2);
        expect(dispatch).not.toHaveBeenCalled(); // still waiting for the entry digit 7
        H.tick('R_100', 7);
        expect(dispatch).toHaveBeenCalledTimes(1);
        H.tick('R_100', 1); H.tick('R_100', 2); H.tick('R_100', 9);
        expect(dispatch).toHaveBeenCalledTimes(4); // no waiting for the entry again
        nexus.autoOn = false;
        H.tick('R_100', 4);
        expect(dispatch).toHaveBeenCalledTimes(4);
        unmount();
    });
    it('with keep off it waits for the entry digit before every trade', () => {
        auto.keep = false;
        const { unmount } = renderHook(() => useAutoEngine());
        startAi();
        H.tick('R_100', 7); H.tick('R_100', 1); H.tick('R_100', 2); H.tick('R_100', 7);
        expect(dispatch).toHaveBeenCalledTimes(2);
        nexus.autoOn = false;
        unmount();
    });
});

describe('signals only suggest balanced trades', () => {
    it('never includes Under 1, Over 8, Under 2, Over 7, Over 9 or Matches', () => {
        const keys = CANDIDATES.map(c => `${c.type}${c.barrier}`);
        ['DIGITUNDER1', 'DIGITUNDER2', 'DIGITUNDER9', 'DIGITOVER7', 'DIGITOVER8', 'DIGITOVER0'].forEach(k => expect(keys).not.toContain(k));
        expect(CANDIDATES.filter(c => c.type === 'DIGITOVER').map(c => c.barrier)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(CANDIDATES.filter(c => c.type === 'DIGITUNDER').map(c => c.barrier)).toEqual([3, 4, 5, 6, 7, 8]);
        expect(CANDIDATES.some(c => c.type === 'DIGITEVEN') && CANDIDATES.some(c => c.type === 'DIGITODD')).toBe(true);
    });
});
