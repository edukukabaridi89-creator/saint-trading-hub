// @ts-nocheck
import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { SYMBOLS, symbolName } from '@/nexus/config';
import { eo, resetEO, stakeFor, stopEO } from '@/nexus/eo-rapid';
import { hub } from '@/nexus/ticks-hub';
import { DigitCircles, Field, Num, Panel } from '@/nexus/ui';

export const EvenOddRapid = observer(() => {
    useEffect(() => { hub.watch([eo.symbol]); }, [eo.symbol]);
    const loaded = (hub.feed(eo.symbol)?.digits.length ?? 0) >= 20;
    return (
        <div className='nx-split'>
            <Panel title='Even / Odd Rapid'>
                <Field label='Market'>
                    <select className='nx-input' value={eo.symbol} onChange={e => runInAction(() => { eo.symbol = e.target.value; eo.running = false; hub.watch([e.target.value]); })}>
                        {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <Field label='Trade'>
                    <div className='nx-seg'>
                        <button className={eo.side === 'EVEN' ? 'on' : ''} onClick={() => runInAction(() => (eo.side = 'EVEN'))}>Even</button>
                        <button className={eo.side === 'ODD' ? 'on' : ''} onClick={() => runInAction(() => (eo.side = 'ODD'))}>Odd</button>
                        <button className={eo.side === 'RISING' ? 'on' : ''} onClick={() => runInAction(() => (eo.side = 'RISING'))}>Rising side</button>
                    </div>
                </Field>
                <Field label='Martingale version'>
                    <div className='nx-seg'>
                        <button className={eo.version === 'both' ? 'on' : ''} onClick={() => runInAction(() => (eo.version = 'both'))}>Both chains</button>
                        <button className={eo.version === 'odd' ? 'on' : ''} onClick={() => runInAction(() => (eo.version = 'odd'))}>Odd runs only</button>
                    </div>
                </Field>
                <p className='nx-muted nx-note'>
                    {eo.version === 'both'
                        ? 'Every run learns from the run two ticks before it (run 3 from run 1, run 4 from run 2, and so on) and raises its stake after that run lost. Two martingale chains run side by side, so no run is left flat.'
                        : 'Runs 3, 5, 7… learn from the run two ticks before them and raise their stake after a loss. Runs 2, 4, 6… always use the base stake.'}
                </p>
                <div className='nx-row'>
                    <Field label='Base stake'><Num min={0.35} step={0.1} value={eo.stake} onChange={v => (eo.stake = v)} /></Field>
                    <Field label='Multiplier'><Num min={1.1} step={0.1} value={eo.mult} onChange={v => (eo.mult = v)} /></Field>
                </div>
                <div className='nx-row'>
                    <Field label='Max martingale steps'><Num int min={1} max={8} value={eo.max} onChange={v => (eo.max = v)} /></Field>
                    <Field label='Stop after runs (0 = off)'><Num int min={0} max={1000} value={eo.maxRuns} onChange={v => (eo.maxRuns = v)} /></Field>
                </div>
                <div className='nx-row'>
                    <Field label='Take profit (0 = off)'><Num min={0} step={1} value={eo.tp} onChange={v => (eo.tp = v)} /></Field>
                    <Field label='Stop loss (0 = off)'><Num min={0} step={1} value={eo.sl} onChange={v => (eo.sl = v)} /></Field>
                </div>
                <p className='nx-muted nx-note'>One 1-tick trade on every tick. Next stakes: run {eo.run + 1} = {stakeFor(eo.run + 1).toFixed(2)}, run {eo.run + 2} = {stakeFor(eo.run + 2).toFixed(2)}.</p>
                <button className={`nx-btn ${eo.running ? 'nx-btn--stop' : 'nx-btn--hedge'}`} disabled={!loaded && !eo.running} onClick={() => (eo.running ? stopEO() : runInAction(() => (eo.running = true)))}>
                    {eo.running ? 'STOP' : 'START'}
                </button>
            </Panel>
            <div className='nx-stack'>
                <Panel title={`Market: ${symbolName(eo.symbol)}`}><DigitCircles symbol={eo.symbol} /></Panel>
                <Panel title='Session'>
                    <div className='nx-dstats'>
                        <span>Runs <b>{eo.run}</b></span>
                        <span>Won <b>{eo.wins}</b></span>
                        <span>Lost <b>{eo.lost}</b></span>
                        <span>P/L <b>{eo.pnl.toFixed(2)}</b></span>
                    </div>
                    {eo.last && <p className='nx-muted'>{eo.last}</p>}
                    <button className='nx-btn' onClick={resetEO}>Reset stats</button>
                </Panel>
            </div>
        </div>
    );
});
