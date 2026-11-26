// @ts-nocheck
import { useEffect } from 'react';
import { observable, runInAction } from 'mobx';
import { celebrateTP } from './celebrate';
import { dispatch } from './dispatcher';
import { fetchDigits, testRule } from './rise';
import { nexus } from './store';
import { hub } from './ticks-hub';

/**
 * Rapid Matches. Watches one market tick by tick. When a digit lands and its share RISES, and then the cursor moves on while that
 * digit keeps its risen share, the engine fires `runs` Matches contracts on that digit, one on each of the next ticks, all with the
 * same stake. Nothing waits for a result before the next buy, so no tick is skipped.
 */
export const sx = observable({
    symbol: 'R_100',
    digitMode: 'auto' as 'auto' | 'manual',
    digit: 7,
    runs: 4,
    stake: 1,
    ticks: 1,
    stopOnHit: true,
    trick: false, // the extra "Sainted Trick" check (never explained in the app)
    tp: 0,
    sl: 0,
    running: false,
    firing: false,
    watching: null as number | null, // digit that just rose and is being confirmed
    rounds: 0,
    roundsWon: 0,
    fired: 0,
    pnl: 0,
    last: '',
    test: null as any,
    testing: false,
    testError: '',
});

type Burst = { digit: number; left: number; fired: number; settled: number; hit: boolean; profit: number; at: number };
let burst: Burst | null = null;
let pending: number | null = null;

const finish = (b: Burst) => {
    if (burst !== b) return;
    runInAction(() => {
        sx.rounds++;
        if (b.hit) sx.roundsWon++;
        sx.last = `Digit ${b.digit}: ${b.hit ? 'hit' : 'no hit'} after ${b.fired} run${b.fired === 1 ? '' : 's'}, ${b.profit >= 0 ? '+' : ''}${b.profit.toFixed(2)}`;
        sx.firing = false;
    });
    burst = null;
};

const fireOne = (b: Burst) => {
    b.left--;
    b.fired++;
    runInAction(() => (sx.fired++));
    dispatch({ symbol: sx.symbol, contract_type: 'DIGITMATCH', stake: sx.stake, barrier: b.digit, duration: sx.ticks, source: 'rapid' }).then(r => {
        runInAction(() => {
            b.settled++;
            if (r.error) {
                b.left = 0;
                sx.running = false;
                sx.last = r.error;
            } else {
                const p = r.profit ?? 0;
                b.profit += p;
                sx.pnl = Math.round((sx.pnl + p) * 100) / 100;
                if (r.won) {
                    b.hit = true;
                    if (sx.stopOnHit) b.left = 0; // runs already sent keep going; no new ones
                }
                if (sx.running && sx.tp > 0 && sx.pnl >= sx.tp) { sx.running = false; b.left = 0; sx.last = celebrateTP(sx.pnl); }
                else if (sx.running && sx.sl > 0 && sx.pnl <= -sx.sl) { sx.running = false; b.left = 0; sx.last = `Stop loss reached (${sx.pnl.toFixed(2)}). Stopped.`; }
            }
        });
        if (b.left <= 0 && b.settled >= b.fired) finish(b);
    });
};

const start = (digit: number) => {
    burst = { digit, left: Math.max(1, Math.floor(sx.runs)), fired: 0, settled: 0, hit: false, profit: 0, at: Date.now() };
    runInAction(() => (sx.firing = true));
    fireOne(burst);
};

/** Press "Fire now": starts a burst on the chosen digit without waiting for the rise. */
export const fireNow = () => {
    if (burst || !hub.feed(sx.symbol)) return;
    start(sx.digit);
};

export const stopRapid = () => {
    if (burst) burst.left = 0;
    pending = null;
    burst = null; // late results of trades already sent still update the totals; a new round can start fresh
    runInAction(() => { sx.running = false; sx.firing = false; });
};

const onTick = (sym: string) => {
    if (sym !== sx.symbol) return;
    const f = hub.feed(sym);
    if (!f) return;
    const d = f.digits.at(-1), out = f.outs.at(-1);
    if (burst && burst.left <= 0 && Date.now() - burst.at > 45000) burst = null; // a trade that never answered must not block the engine forever
    // 1. a burst in progress: one more buy on this tick
    if (burst && burst.left > 0) { if (sx.running || burst.fired > 0) fireOne(burst); }
    else if (burst && burst.left <= 0 && burst.settled >= burst.fired) finish(burst);
    // 2. the digit that rose on the last tick: has it kept its rise now that the cursor moved on?
    if (sx.running && !burst && pending !== null) {
        const p = pending;
        const stays = d !== p && out !== undefined && out !== p;
        const flat = out === d; // (Sainted Trick) the digit the cursor moved to did not rise
        if (stays && (!sx.trick || flat)) { pending = null; runInAction(() => (sx.watching = null)); start(p); return; }
    }
    // 3. did this tick's digit rise?
    const rose = d !== undefined && out !== undefined && out !== d;
    pending = rose && (sx.digitMode === 'auto' || d === sx.digit) && !burst ? d : null;
    if (sx.watching !== pending) runInAction(() => (sx.watching = pending));
};

/** Mounted once at app level, so a running rapid session keeps going on any tab. */
export const useRapidEngine = () =>
    useEffect(() => {
        hub.watch([sx.symbol]);
        return hub.onTick(onTick);
    }, []);

export const runHistoryTest = async () => {
    runInAction(() => { sx.testing = true; sx.testError = ''; sx.test = null; });
    try {
        const digits = await fetchDigits(sx.symbol);
        if (digits.length < 1500) throw new Error('Not enough history came back for this market.');
        const res = testRule(digits, Math.max(1, Math.floor(sx.runs)), sx.trick, sx.digitMode === 'manual' ? sx.digit : null);
        runInAction(() => (sx.test = res));
    } catch (e: any) {
        runInAction(() => (sx.testError = e?.error?.message ?? e?.message ?? 'The test could not run.'));
    } finally {
        runInAction(() => (sx.testing = false));
    }
};

export const resetRapid = () => runInAction(() => { sx.rounds = 0; sx.roundsWon = 0; sx.fired = 0; sx.pnl = 0; sx.last = ''; });
void nexus;
