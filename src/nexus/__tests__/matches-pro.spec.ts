import { pickDigits } from '../matches-pro';

describe('Matches Pro: short look-back picks', () => {
    it('needs two windows of ticks', () => { expect(pickDigits([1, 2, 3], 10, 3).picks).toEqual([]); });
    it('picks digits whose share rose versus the previous window, biggest rise first, max count', () => {
        const prev = [0, 1, 2, 3, 5, 6, 8, 9, 0, 1];
        const cur = [4, 4, 4, 7, 7, 2, 5, 6, 8, 9];
        const r = pickDigits([...prev, ...cur], 10, 3);
        expect(r.picks[0]).toBe(4); // 3 now, 0 before
        expect(r.picks.length).toBeLessThanOrEqual(3);
        expect(new Set(r.picks).size).toBe(r.picks.length);
        r.picks.forEach(p => expect(r.scores[p]).toBeGreaterThan(0));
    });
    it('never picks a digit whose share did not rise', () => {
        const r = pickDigits([...Array(10).fill(5), ...Array(10).fill(5)], 10, 3);
        expect(r.picks).toEqual([]);
    });
});
