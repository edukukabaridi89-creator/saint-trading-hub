// @ts-nocheck
import { useEffect } from 'react';
import { observable, runInAction } from 'mobx';
import { dispatch } from './dispatcher';
import { nexus } from './store';
import { hub } from './ticks-hub';

export const mp = observable({
    symbol: 'R_100',
    auto: true, // true: the system takes the trades; false: the user presses TRADE NOW
    running: false,
    count: 3, // how many digits are covered at once
    stake: 1, // stake per digit
    ticks: 1,
    n: 10, // short look-back: the last n ticks are compared with the n before them
    mg: { on: false, mult: 2, max: 4 }, // martingale on a lost round
    losses: 0,
    tp: 0,
    sl: 0,
    picks: [] as number[],
    scores: {} as Record<number, number>,
    busy: false,
    rounds: 0,
    wins: 0,
    pnl: 0,
    last: '',
});

/**
 * Short look-back: compares each digit's share of the last `n` ticks with its share of the `n` ticks before them.
 * Digits whose share went UP are the picks, biggest rise first (then the one that landed most recently).
 */
export const pickDigits = (digits: number[], n: number, count: number) => {
    const len = digits.length;
    if (len < n * 2) return { picks: [] as number[], scores: {} as Record<number, number> };
    const now = Array(10).fill(0), prev = Array(10).fill(0), recent = Array(10).fill(-1);
    for (let i = len - n; i < len; i++) { now[digits[i]]++; recent[digits[i]] = i; }
    for (let i = len - 2 * n; i < len - n; i++) prev[digits[i]]++;
    const rise = (d: number) => now[d] - prev[d];
    const ranked = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => rise(d) > 0).sort((a, b) => rise(b) - rise(a) || recent[b] - recent[a]);
    const scores: Record<number, number> = {};
    ranked.forEach(d => (scores[d] = rise(d)));
    return { picks: ranked.slice(0, count), scores };
};

export const refreshPicks = () => {
    const f = hub.feed(mp.symbol);
    if (!f) return;
    const r = pickDigits(f.digits, mp.n, mp.count);
    runInAction(() => { mp.picks = r.picks; mp.scores = r.scores; });
};

export const roundStake = () => Math.round(mp.stake * (mp.mg.on ? mp.mg.mult ** Math.min(mp.losses, mp.mg.max) : 1) * 100) / 100;

export const stopMatches = () => runInAction(() => (mp.running = false));

/** Buys one Matches contract per picked digit, all in the same instant (a hedge: at most one of them can win). */
export const placeRound = async () => {
    if (mp.busy || mp.picks.length < mp.count) return;
    const picks = mp.picks.slice(0, mp.count), symbol = mp.symbol;
    runInAction(() => (mp.busy = true));
    const res = await Promise.all(picks.map(d => dispatch({ symbol, contract_type: 'DIGITMATCH', stake: roundStake(), barrier: d, duration: mp.ticks, source: 'matches' })));
    runInAction(() => {
        const err = res.find(r => r.error);
        const ok = res.filter(r => !r.error);
        if (!ok.length) {
            mp.running = false;
            mp.last = err?.error ?? 'No trade was placed.';
        } else {
            const profit = ok.reduce((a, r) => a + (r.profit ?? 0), 0);
            mp.rounds++;
            if (ok.some(r => r.won)) (mp.wins++, (mp.losses = 0));
            else mp.losses = mp.mg.on && mp.losses >= mp.mg.max ? 0 : mp.losses + 1;
            mp.pnl = Math.round((mp.pnl + profit) * 100) / 100;
            mp.last = `${picks.join(' · ')}: ${profit >= 0 ? 'Won' : 'Lost'} ${Math.abs(profit).toFixed(2)}${err ? ' (one trade was rejected)' : ''}`;
            if ((mp.tp > 0 && mp.pnl >= mp.tp) || (mp.sl > 0 && mp.pnl <= -mp.sl)) {
                mp.running = false;
                mp.last += mp.pnl >= 0 ? ' · take profit reached, stopped.' : ' · stop loss reached, stopped.';
            }
        }
        mp.busy = false;
    });
};

/** Mounted once at app level: re-checks the digits on every tick of the chosen market, and trades when Automatic is on. */
export const useMatchesEngine = () =>
    useEffect(() => {
        hub.watch([mp.symbol]);
        return hub.onTick(sym => {
            if (sym !== mp.symbol) return;
            const f = hub.feed(sym);
            if (!f) return;
            const r = pickDigits(f.digits, mp.n, mp.count);
            runInAction(() => {
                mp.picks = r.picks;
                mp.scores = r.scores;
            });
            if (mp.running && mp.auto && !mp.busy && r.picks.length >= mp.count) placeRound();
        });
    }, []);
