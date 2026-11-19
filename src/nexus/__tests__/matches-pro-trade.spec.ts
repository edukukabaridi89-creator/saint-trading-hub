import { mp, placeRound } from '../matches-pro';

jest.mock('../dispatcher', () => ({ dispatch: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dispatch } = require('../dispatcher');

describe('Matches Pro round', () => {
    it('buys one Matches contract per picked digit at once and records the result', async () => {
        dispatch.mockImplementation(async (r: any) => ({ contract_id: 1, profit: r.barrier === 7 ? 8 : -1, won: r.barrier === 7 }));
        Object.assign(mp, { picks: [7, 2, 9, 4], count: 3, stake: 1, ticks: 1, symbol: 'R_100', busy: false, rounds: 0, wins: 0, pnl: 0 });
        await placeRound();
        expect(dispatch).toHaveBeenCalledTimes(3);
        expect(dispatch.mock.calls.map((c: any) => [c[0].contract_type, c[0].barrier])).toEqual([['DIGITMATCH', 7], ['DIGITMATCH', 2], ['DIGITMATCH', 9]]);
        expect(mp.rounds).toBe(1);
        expect(mp.wins).toBe(1);
        expect(mp.pnl).toBe(6);
    });
    it('does nothing until enough digits are picked', async () => {
        dispatch.mockClear();
        Object.assign(mp, { picks: [1, 2], count: 3, busy: false });
        await placeRound();
        expect(dispatch).not.toHaveBeenCalled();
    });
});
