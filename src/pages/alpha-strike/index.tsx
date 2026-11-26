// @ts-nocheck
import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { SYMBOLS, symbolName } from '@/nexus/config';
import { as, fire, refreshAlpha, stakeNow } from '@/nexus/alpha-strike';
import { hub } from '@/nexus/ticks-hub';
import { DigitCircles, Field, Num, Panel } from '@/nexus/ui';

const Bar = ({ side, rise, best }: any) => (
    <div className={`nx-as__side ${best ? 'is-best' : ''}`}>
        <b>{side.label}</b>
        <span>{side.now}/{as.n}</span>
        <em className={rise > 0 ? 'up' : rise < 0 ? 'dn' : ''}>{rise > 0 ? '+' : ''}{rise} vs previous {as.n}</em>
        <div className='nx-as__bar'><i style={{ width: `${(side.now / as.n) * 100}%` }} /></div>
    </div>
);

export const AlphaStrike = observer(() => {
    useEffect(() => { hub.watch([as.symbol]); refreshAlpha(); const t = setInterval(refreshAlpha, 1000); return () => clearInterval(t); }, [as.symbol, as.n, as.kind, as.barrier, as.follow, as.strength]);
    const v = as.view;
    const ready = !!v?.pick;
    return (
        <div className='nx-split'>
            <Panel title='Alpha Strike'>
                <Field label='Market'>
                    <select className='nx-input' value={as.symbol} onChange={e => runInAction(() => { as.symbol = e.target.value; as.view = null; hub.watch([e.target.value]); })}>
                        {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <Field label='Trade type'>
                    <div className='nx-seg'>
                        <button className={as.kind === 'EO' ? 'on' : ''} onClick={() => runInAction(() => { as.kind = 'EO'; as.running = false; })}>Even / Odd</button>
                        <button className={as.kind === 'OU' ? 'on' : ''} onClick={() => runInAction(() => { as.kind = 'OU'; as.running = false; })}>Over / Under</button>
                        <button className={as.kind === 'RF' ? 'on' : ''} onClick={() => runInAction(() => { as.kind = 'RF'; as.running = false; })}>Rise / Fall</button>
                    </div>
                </Field>
                {as.kind === 'OU' && <Field label='Digit (Over / Under)'><Num int min={1} max={8} value={as.barrier} onChange={v => (as.barrier = v)} /></Field>}
                <div className='nx-row'>
                    <Field label='Look at the last'>
                        <select className='nx-input' value={as.n} onChange={e => (as.n = Number(e.target.value))}>
                            <option value={5}>5 ticks</option><option value={10}>10 ticks</option><option value={15}>15 ticks</option><option value={20}>20 ticks</option>
                        </select>
                    </Field>
                    <Field label='Trade the side that is'>
                        <select className='nx-input' value={as.follow ? 'f' : 'o'} onChange={e => (as.follow = e.target.value === 'f')}>
                            <option value='f'>Rising</option><option value='o'>Falling (opposite)</option>
                        </select>
                    </Field>
                </div>
                <Field label='Signal strength'>
                    <select className='nx-input' value={as.strength} onChange={e => (as.strength = Number(e.target.value))}>
                        <option value={1}>Normal</option><option value={2}>Sharp (recommended)</option><option value={3}>Sharpest (trades less often)</option>
                    </select>
                </Field>
                <Field label='Who takes the trades'>
                    <div className='nx-seg'>
                        <button className={as.auto ? 'on' : ''} onClick={() => runInAction(() => { as.auto = true; as.running = false; })}>Automatic</button>
                        <button className={!as.auto ? 'on' : ''} onClick={() => runInAction(() => { as.auto = false; as.running = false; })}>Manual</button>
                    </div>
                </Field>
                <div className='nx-row'>
                    <Field label='Stake'><Num min={0.35} step={0.1} value={as.stake} onChange={v => (as.stake = v)} /></Field>
                    <Field label='Duration (ticks)'><Num int min={1} max={10} value={as.ticks} onChange={v => (as.ticks = v)} /></Field>
                </div>
                <label className='nx-check'>
                    <input type='checkbox' checked={as.mg.on} onChange={e => (as.mg.on = e.target.checked)} />
                    <span>Martingale on loss<small>Multiply the stake after each loss, reset after a win.</small></span>
                </label>
                {as.mg.on && (
                    <div className='nx-row'>
                        <Field label='Multiplier'><Num min={1.1} step={0.1} value={as.mg.mult} onChange={v => (as.mg.mult = v)} /></Field>
                        <Field label='Max steps'><Num int min={1} max={10} value={as.mg.max} onChange={v => (as.mg.max = v)} /></Field>
                    </div>
                )}
                <div className='nx-row'>
                    <Field label='Take profit (0 = off)'><Num min={0} step={1} value={as.tp} onChange={v => (as.tp = v)} /></Field>
                    <Field label='Stop loss (0 = off)'><Num min={0} step={1} value={as.sl} onChange={v => (as.sl = v)} /></Field>
                </div>
                {as.auto ? (
                    <button className={`nx-btn ${as.running ? 'nx-btn--stop' : 'nx-btn--hedge'}`} disabled={!v && !as.running} onClick={() => runInAction(() => (as.running = !as.running))}>{as.running ? 'STOP' : 'START AUTOMATIC'}</button>
                ) : (
                    <button className={`nx-btn nx-btn--hedge ${ready ? 'nx-glow' : ''}`} disabled={!ready || as.busy} onClick={fire}>{as.busy ? 'TRADING…' : `TRADE NOW · ${v?.pick?.label ?? '…'} · ${stakeNow()}`}</button>
                )}
            </Panel>
            <div className='nx-stack'>
                <div className={`nx-banner nx-banner--${ready ? 'signal' : 'idle'}`}>
                    {!v ? 'Collecting ticks for this market, one moment…' : ready ? `${v.rising.label} is rising — ${as.follow ? 'trading it' : 'trading the opposite'}: ${v.pick.label}${as.auto ? (as.running ? ' — firing now.' : ' — press Start to trade automatically.') : ' — press Trade now.'}` : 'No side is rising yet — waiting for the next tick.'}
                </div>
                <Panel title={`Market: ${symbolName(as.symbol)}`}>
                    {v && <div className='nx-as'><Bar side={v.A} rise={v.ra} best={v.rising === v.A} /><Bar side={v.B} rise={v.rb} best={v.rising === v.B} /></div>}
                    <DigitCircles symbol={as.symbol} small />
                </Panel>
                <Panel title='Session'>
                    <div className='nx-dstats'>
                        <span>Trades <b>{as.rounds}</b></span>
                        <span>Won <b>{as.wins}</b></span>
                        <span>Win rate <b>{as.rounds ? ((as.wins / as.rounds) * 100).toFixed(0) : '--'}%</b></span>
                        <span>P/L <b>{as.pnl.toFixed(2)}</b></span>
                    </div>
                    {as.last && <p className='nx-muted'>Last trade: {as.last}</p>}
                    <p className='nx-muted nx-note'>The signal is the side that appeared more in the last {as.n} ticks than in the {as.n} before{as.kind === 'RF' ? ' (price moves up vs down)' : ''}. Watch the win rate over many trades before trusting any pattern. Martingale raises the stake after losses and can lose a lot quickly.</p>
                </Panel>
            </div>
        </div>
    );
});
