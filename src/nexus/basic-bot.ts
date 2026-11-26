// @ts-nocheck
import { observable, runInAction } from 'mobx';
import { celebrateTP } from './celebrate';
import { dispatch } from './dispatcher';
import { nexus } from './store';
import { defaultForm, requestFor, TRADE_TYPES, validate, type Form } from './dtrader/trade-types';

/** Basic Bot: pick any trade type, set stake, martingale, take profit and stop loss, press Run, press Stop when done. */
export const bb = observable({
    typeId: 'evenodd',
    sideIdx: 0,
    form: null as Form | null,
    mg: { on: false, mult: 2, max: 4 },
    tp: 0,
    sl: 0,
    running: false,
    busy: false,
    trades: 0,
    wins: 0,
    pnl: 0,
    losses: 0,
    last: '',
});

export const typeDef = () => TRADE_TYPES.find(t => t.id === bb.typeId) ?? TRADE_TYPES[0];
export const formNow = (): Form => bb.form ?? defaultForm(typeDef());
export const chooseType = (id: string) => runInAction(() => { bb.typeId = id; bb.sideIdx = 0; bb.form = defaultForm(TRADE_TYPES.find(t => t.id === id) ?? TRADE_TYPES[0]); bb.running = false; });
export const patchForm = (p: Partial<Form>) => runInAction(() => (bb.form = { ...formNow(), ...p }));
export const stopBasic = () => runInAction(() => (bb.running = false));
export const resetBasic = () => runInAction(() => { bb.trades = 0; bb.wins = 0; bb.pnl = 0; bb.losses = 0; bb.last = ''; });

export const startBasic = async () => {
    if (bb.running) return;
    const def = typeDef();
    const bad = validate(def, formNow());
    if (bad) return nexus.log(bad);
    runInAction(() => { bb.running = true; bb.losses = 0; });
    while (bb.running) {
        const f = formNow();
        const stake = Math.round(f.amount * (bb.mg.on ? Math.pow(bb.mg.mult, Math.min(bb.losses, bb.mg.max)) : 1) * 100) / 100;
        const side = def.sides[Math.min(bb.sideIdx, def.sides.length - 1)];
        runInAction(() => (bb.busy = true));
        const r = await dispatch({ ...requestFor(def, side, { ...f, amount: stake }, nexus.symbol), source: 'basic' });
        runInAction(() => {
            bb.busy = false;
            if (r.error) { bb.running = false; bb.last = r.error; return; }
            const p = r.profit ?? 0;
            bb.trades++;
            bb.pnl = Math.round((bb.pnl + p) * 100) / 100;
            if (r.won) { bb.wins++; bb.losses = 0; } else bb.losses = bb.mg.on && bb.losses >= bb.mg.max ? 0 : bb.losses + 1;
            bb.last = `${r.won ? 'Won' : 'Lost'} ${Math.abs(p).toFixed(2)}`;
            if (bb.running && bb.tp > 0 && bb.pnl >= bb.tp) { bb.running = false; bb.last = celebrateTP(bb.pnl); }
            else if (bb.running && bb.sl > 0 && bb.pnl <= -bb.sl) { bb.running = false; bb.last = `Stop loss reached (${bb.pnl.toFixed(2)}). Stopped.`; }
        });
        if (bb.running) await new Promise(res => setTimeout(res, 400));
    }
};
