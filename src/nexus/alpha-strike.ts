// @ts-nocheck
import { useEffect } from 'react';
import { observable, runInAction } from 'mobx';
import { dispatch } from './dispatcher';
import { hub } from './ticks-hub';

export type Kind = 'EO' | 'OU' | 'RF';
export const as = observable({
    symbol: 'R_100',
    kind: 'EO' as Kind,
    barrier: 4, // Over / Under digit
    n: 10, // the last n ticks are compared with the n before them
    follow: true, // true: trade the side that is rising; false: trade the opposite side
    auto: true,
    running: false,
    stake: 1,
    ticks: 1,
    mg: { on: false, mult: 2, max: 5 },
    tp: 0,
    sl: 0,
    view: null as any,
    busy: false,
    losses: 0,
    rounds: 0,
    wins: 0,
    pnl: 0,
    last: '',
});

type Side = { label: string; type: string; barrier?: number; now: number; prev: number };

/** Compares the share of each side in the last n ticks with the n ticks before. The side with the bigger rise is the signal. */
export const analyse = (digits: number[], n: number, kind: Kind, barrier: number, follow: boolean, prices: number[] = []) => {
    let A: Side, B: Side;
    if (kind === 'RF') {
        if (prices.length < 2 * n + 1) return null;
        const mv = prices.slice(-(2 * n + 1)).map((p, i, a) => (i ? Math.sign(p - a[i - 1]) : 0)).slice(1); // +1 up, -1 down, 0 flat
        const old = mv.slice(0, n), cur = mv.slice(n);
        const mk = (label: string, type: string, v: number): Side => ({ label, type, now: cur.filter(x => x === v).length, prev: old.filter(x => x === v).length });
        A = mk('Rise', 'CALL', 1);
        B = mk('Fall', 'PUT', -1);
    } else {
        if (digits.length < n * 2) return null;
        const cur = digits.slice(-n), old = digits.slice(-2 * n, -n);
        const mk = (label: string, type: string, test: (d: number) => boolean, b?: number): Side => ({ label, type, barrier: b, now: cur.filter(test).length, prev: old.filter(test).length });
        A = kind === 'EO' ? mk('Even', 'DIGITEVEN', d => d % 2 === 0) : mk(`Over ${barrier}`, 'DIGITOVER', d => d > barrier, barrier);
        B = kind === 'EO' ? mk('Odd', 'DIGITODD', d => d % 2 === 1) : mk(`Under ${barrier}`, 'DIGITUNDER', d => d < barrier, barrier);
    }
    const ra = A.now - A.prev, rb = B.now - B.prev;
    let rising: Side | null = null;
    if (ra > rb && ra > 0) rising = A;
    else if (rb > ra && rb > 0) rising = B;
    const pick = rising ? (follow ? rising : rising === A ? B : A) : null;
    return { A, B, ra, rb, rising, pick, n };
};

export const stakeNow = () => Math.round(as.stake * (as.mg.on ? as.mg.mult ** Math.min(as.losses, as.mg.max) : 1) * 100) / 100;

export const refreshAlpha = () => {
    const f = hub.feed(as.symbol);
    if (!f) return;
    runInAction(() => (as.view = analyse(f.digits, as.n, as.kind, as.barrier, as.follow, f.prices)));
};

export const fire = async () => {
    const v = as.view;
    if (as.busy || !v?.pick) return;
    const side = v.pick as Side;
    runInAction(() => (as.busy = true));
    const stake = stakeNow();
    const r = await dispatch({ symbol: as.symbol, contract_type: side.type, stake, barrier: side.barrier, duration: as.ticks, source: 'alpha' });
    runInAction(() => {
        if (r.error) {
            as.running = false;
            as.last = r.error;
        } else {
            as.rounds++;
            as.pnl = Math.round((as.pnl + (r.profit ?? 0)) * 100) / 100;
            if (r.won) (as.wins++, (as.losses = 0));
            else as.losses = as.mg.on && as.losses >= as.mg.max ? 0 : as.losses + 1;
            as.last = `${side.label}: ${r.won ? 'Won' : 'Lost'} ${Math.abs(r.profit ?? 0).toFixed(2)}`;
            if ((as.tp > 0 && as.pnl >= as.tp) || (as.sl > 0 && as.pnl <= -as.sl)) {
                as.running = false;
                as.last += as.pnl >= 0 ? ' · take profit reached, stopped.' : ' · stop loss reached, stopped.';
            }
        }
        as.busy = false;
    });
};

/** Mounted once at app level: re-checks the market on every tick and fires at once when Automatic is running. */
export const useAlphaEngine = () =>
    useEffect(() => {
        hub.watch([as.symbol]);
        return hub.onTick(sym => {
            if (sym !== as.symbol) return;
            refreshAlpha();
            if (as.running && as.auto && !as.busy && as.view?.pick) fire();
        });
    }, []);
