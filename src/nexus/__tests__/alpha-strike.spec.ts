import { analyse, as, fire, stakeNow } from '../alpha-strike';

jest.mock('../dispatcher', () => ({ dispatch: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dispatch } = require('../dispatcher');

describe('Alpha Strike', () => {
    const calm = [1, 3, 5, 7, 9, 2, 4, 6, 8, 0]; // 5 odd / 5 even
    it('signals the rising side (Even / Odd)', () => {
        const odd = [...calm, 1, 3, 5, 7, 9, 1, 3, 5, 2, 0]; // odd 7/10 now vs 5/10 before
        const v = analyse(odd, 10, 'EO', 4, true)!;
        expect(v.rising!.label).toBe('Odd');
        expect(v.pick!.type).toBe('DIGITODD');
        expect(analyse(odd, 10, 'EO', 4, false)!.pick!.type).toBe('DIGITEVEN');
    });
    it('works for Over / Under with a barrier', () => {
        const hi = [...calm, 9, 8, 7, 9, 8, 7, 6, 9, 0, 1];
        const v = analyse(hi, 10, 'OU', 4, true)!;
        expect(v.pick!.type).toBe('DIGITOVER');
        expect(v.pick!.barrier).toBe(4);
    });
    it('works for Rise / Fall from price moves', () => {
        const flat = Array.from({ length: 11 }, (_, i) => 100 + (i % 2)); // 5 up, 5 down
        const rising = Array.from({ length: 10 }, (_, i) => 101 + i * 0.1); // all up
        const v = analyse([], 10, 'RF', 4, true, [...flat, ...rising])!;
        expect(v.rising!.label).toBe('Rise');
        expect(v.pick!.type).toBe('CALL');
        expect(analyse([], 10, 'RF', 4, false, [...flat, ...rising])!.pick!.type).toBe('PUT');
    });
    it('has no signal when nothing rises', () => { expect(analyse([...calm, ...calm], 10, 'EO', 4, true)!.pick).toBeNull(); });
    it('fires one contract and applies martingale on a loss', async () => {
        dispatch.mockImplementation(async () => ({ contract_id: 1, profit: -1, won: false }));
        Object.assign(as, { busy: false, rounds: 0, wins: 0, pnl: 0, losses: 0, stake: 1, ticks: 1, symbol: 'R_100' });
        as.mg.on = true; as.mg.mult = 2; as.mg.max = 3;
        as.view = analyse([...calm, 1, 3, 5, 7, 9, 1, 3, 5, 2, 0], 10, 'EO', 4, true);
        await fire();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ contract_type: 'DIGITODD', stake: 1 }));
        expect(as.losses).toBe(1);
        expect(stakeNow()).toBe(2);
    });
});
