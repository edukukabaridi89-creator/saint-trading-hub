// @ts-nocheck
import { useEffect } from 'react';
import { observable, runInAction } from 'mobx';
import { analyse } from './alpha-strike';
import { celebrateTP } from './celebrate';
import { dispatch } from './dispatcher';
import { hub } from './ticks-hub';

/**
 * Even/Odd Rapid: one 1-tick Even or Odd trade on EVERY tick, same market, never skipping a tick.
 * A 1-tick trade is settled by the time the run two ticks later is sent, so run 3 can know run 1's result, run 4 can know run 2's.
 *   version 'both': both chains (odd runs 1,3,5.. and even runs 2,4,6..) apply the martingale after their own loss.
 *   version 'odd' : only runs 3,5,7.. use the martingale (from the run two before); runs 2,4,6.. always use the base stake.
 */
export const eo = observable({
    symbol: 'R_100',
    side: 'EVEN' as 'EVEN' | 'ODD' | 'RISING',
    version: 'both' as 'both' | 'odd',
    stake: 1,
    mult: 2,
    max: 4,
    tp: 0,
    sl: 0,
    maxRuns: 0, // 0 = until stopped
    running: false,
    run: 0,
    inflight: 0,
    wins: 0,
    lost: 0,
    pnl: 0,
    last: '',
    chainA: 0, // consecutive losses on the odd-numbered runs
    chainB: 0, // consecutive losses on the even-numbered runs
});

export const stakeFor = (k: number) => {
    const odd = k % 2 === 1;
    const losses = odd ? eo.chainA : eo.chainB;
    const useMg = eo.version === 'both' || odd;
    return Math.round(eo.stake * (useMg ? Math.pow(eo.mult, Math.min(losses, eo.max)) : 1) * 100) / 100;
};

export const stopEO = () => runInAction(() => (eo.running = false));
export const resetEO = () => runInAction(() => { eo.run = 0; eo.wins = 0; eo.lost = 0; eo.pnl = 0; eo.last = ''; eo.chainA = 0; eo.chainB = 0; });

const onTick = (sym: string) => {
    if (!eo.running || sym !== eo.symbol) return;
    const f = hub.feed(sym);
    if (!f) return;
    if (eo.inflight > 12) return; // safety: never pile up more than a dozen open trades
    let type = eo.side === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';
    if (eo.side === 'RISING') {
        const v = analyse(f.digits, 10, 'EO', 0, true);
        if (!v?.pick) return;
        type = v.pick.type;
    }
    const k = eo.run + 1;
    const stake = stakeFor(k);
    runInAction(() => { eo.run = k; eo.inflight++; });
    if (eo.maxRuns > 0 && k >= eo.maxRuns) runInAction(() => (eo.running = false));
    dispatch({ symbol: sym, contract_type: type, stake, duration: 1, source: 'eo-rapid' }).then(r => {
        runInAction(() => {
            eo.inflight = Math.max(0, eo.inflight - 1);
            if (r.error) { eo.running = false; eo.last = r.error; return; }
            const odd = k % 2 === 1;
            const p = r.profit ?? 0;
            eo.pnl = Math.round((eo.pnl + p) * 100) / 100;
            if (r.won) eo.wins++; else eo.lost++;
            const next = r.won ? 0 : 1;
            if (odd) eo.chainA = r.won ? 0 : eo.chainA >= eo.max ? 0 : eo.chainA + next;
            else eo.chainB = r.won ? 0 : eo.chainB >= eo.max ? 0 : eo.chainB + next;
            eo.last = `Run ${k}: ${r.won ? 'Won' : 'Lost'} ${Math.abs(p).toFixed(2)}`;
            if (eo.running && eo.tp > 0 && eo.pnl >= eo.tp) { eo.running = false; eo.last = celebrateTP(eo.pnl); }
            else if (eo.running && eo.sl > 0 && eo.pnl <= -eo.sl) { eo.running = false; eo.last = `Stop loss reached (${eo.pnl.toFixed(2)}). Stopped.`; }
        });
    });
};

export const useEORapidEngine = () =>
    useEffect(() => {
        hub.watch([eo.symbol]);
        return hub.onTick(onTick);
    }, []);
