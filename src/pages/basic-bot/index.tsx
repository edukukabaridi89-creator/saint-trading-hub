// @ts-nocheck
import React from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { bb, chooseType, formNow, patchForm, resetBasic, startBasic, stopBasic, typeDef } from '@/nexus/basic-bot';
import { TRADE_TYPES } from '@/nexus/dtrader/trade-types';
import { Field, Num, Panel, SymbolSelect } from '@/nexus/ui';

export const BasicBot = observer(() => {
    const def = typeDef();
    const f = formNow();
    const has = (x: string) => def.fields.includes(x);
    return (
        <div className='nx-split'>
            <Panel title='Basic Bot'>
                <Field label='Market'><SymbolSelect /></Field>
                <Field label='Trade type'>
                    <select className='nx-input' value={bb.typeId} onChange={e => chooseType(e.target.value)}>
                        {TRADE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </Field>
                <Field label='Side'>
                    <div className='nx-seg'>
                        {def.sides.map((s, i) => <button key={s.contract_type} className={bb.sideIdx === i ? 'on' : ''} onClick={() => runInAction(() => (bb.sideIdx = i))}>{s.label}</button>)}
                    </div>
                </Field>
                <div className='nx-row'>
                    <Field label='Stake'><Num min={0.35} step={0.1} value={f.amount} onChange={v => patchForm({ amount: v })} /></Field>
                    {has('ticks') && <Field label='Ticks'><Num int min={1} max={10} value={f.ticks} onChange={v => patchForm({ ticks: v })} /></Field>}
                    {has('prediction') && <Field label='Digit'><Num int min={0} max={9} value={f.digit} onChange={v => patchForm({ digit: v })} /></Field>}
                </div>
                {has('duration') && (
                    <div className='nx-row'>
                        <Field label='Duration'><Num int min={1} value={f.durationValue} onChange={v => patchForm({ durationValue: v })} /></Field>
                        <Field label='Unit'>
                            <select className='nx-input' value={f.durationUnit} onChange={e => patchForm({ durationUnit: e.target.value })}>
                                {(def.units ?? ['t']).map(u => <option key={u} value={u}>{{ t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[u]}</option>)}
                            </select>
                        </Field>
                    </div>
                )}
                {has('barrier') && <Field label='Barrier (e.g. +0.50)'><input className='nx-input' value={f.barrier} onChange={e => patchForm({ barrier: e.target.value })} /></Field>}
                {has('growth') && (
                    <Field label='Growth rate'>
                        <select className='nx-input' value={f.growth} onChange={e => patchForm({ growth: Number(e.target.value) })}>
                            {[0.01, 0.02, 0.03, 0.04, 0.05].map(g => <option key={g} value={g}>{g * 100}%</option>)}
                        </select>
                    </Field>
                )}
                {has('multiplier') && <Field label='Multiplier'><Num int min={1} value={f.multiplier} onChange={v => patchForm({ multiplier: v })} /></Field>}
                <label className='nx-check'>
                    <input type='checkbox' checked={bb.mg.on} onChange={e => runInAction(() => (bb.mg.on = e.target.checked))} />
                    <span>Martingale on loss<small>Multiply the stake after each loss, reset after a win.</small></span>
                </label>
                {bb.mg.on && (
                    <div className='nx-row'>
                        <Field label='Multiplier'><Num min={1.1} step={0.1} value={bb.mg.mult} onChange={v => (bb.mg.mult = v)} /></Field>
                        <Field label='Max steps'><Num int min={1} max={10} value={bb.mg.max} onChange={v => (bb.mg.max = v)} /></Field>
                    </div>
                )}
                <div className='nx-row'>
                    <Field label='Take profit (0 = off)'><Num min={0} step={1} value={bb.tp} onChange={v => (bb.tp = v)} /></Field>
                    <Field label='Stop loss (0 = off)'><Num min={0} step={1} value={bb.sl} onChange={v => (bb.sl = v)} /></Field>
                </div>
                <button className={`nx-btn ${bb.running ? 'nx-btn--stop' : 'nx-btn--hedge'}`} onClick={() => (bb.running ? stopBasic() : startBasic())}>
                    {bb.running ? 'STOP' : 'RUN'}
                </button>
            </Panel>
            <div className='nx-stack'>
                <Panel title='Session'>
                    <div className='nx-dstats'>
                        <span>Trades <b>{bb.trades}</b></span>
                        <span>Won <b>{bb.wins}</b></span>
                        <span>P/L <b>{bb.pnl.toFixed(2)}</b></span>
                    </div>
                    {bb.last && <p className='nx-muted'>{bb.last}</p>}
                    <p className='nx-muted nx-note'>One trade at a time. It places the next one as soon as the last one finishes, until you press Stop or a limit is reached.</p>
                    <button className='nx-btn' onClick={resetBasic}>Reset stats</button>
                </Panel>
            </div>
        </div>
    );
});
