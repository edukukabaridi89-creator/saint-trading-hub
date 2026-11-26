// @ts-nocheck
import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { SYMBOLS, symbolName } from '@/nexus/config';
import { fireNow, resetRapid, runHistoryTest, stopRapid, sx } from '@/nexus/rapid';
import { hub } from '@/nexus/ticks-hub';
import { DigitCircles, Field, Num, Panel } from '@/nexus/ui';

/** Rapid Matches: the engine is mounted at app level (useRapidEngine), this is its control panel. */
export const RapidMatches = observer(() => {
    useEffect(() => { hub.watch([sx.symbol]); }, [sx.symbol]);
    const f = hub.feed(sx.symbol);
    const loaded = (f?.digits.length ?? 0) >= 1000;
    const t = sx.test;
    return (
        <div className='nx-split'>
            <Panel title='Rapid Matches'>
                <Field label='Market'>
                    <select className='nx-input' value={sx.symbol} onChange={e => runInAction(() => { sx.symbol = e.target.value; sx.running = false; sx.watching = null; hub.watch([e.target.value]); })}>
                        {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <Field label='Digit to predict'>
                    <div className='nx-seg'>
                        <button className={sx.digitMode === 'auto' ? 'on' : ''} onClick={() => runInAction(() => (sx.digitMode = 'auto'))}>System finds it</button>
                        <button className={sx.digitMode === 'manual' ? 'on' : ''} onClick={() => runInAction(() => (sx.digitMode = 'manual'))}>I choose</button>
                    </div>
                </Field>
                {sx.digitMode === 'manual' && <Field label='My digit'><Num int min={0} max={9} value={sx.digit} onChange={v => (sx.digit = v)} /></Field>}
                <div className='nx-row'>
                    <Field label='Number of runs'><Num int min={1} max={20} value={sx.runs} onChange={v => (sx.runs = v)} /></Field>
                    <Field label='Stake (every run)'><Num min={0.35} step={0.1} value={sx.stake} onChange={v => (sx.stake = v)} /></Field>
                </div>
                <div className='nx-row'>
                    <Field label='Take profit (0 = off)'><Num min={0} step={1} value={sx.tp} onChange={v => (sx.tp = v)} /></Field>
                    <Field label='Stop loss (0 = off)'><Num min={0} step={1} value={sx.sl} onChange={v => (sx.sl = v)} /></Field>
                </div>
                <label className='nx-check'>
                    <input type='checkbox' checked={sx.stopOnHit} onChange={e => (sx.stopOnHit = e.target.checked)} />
                    <span>Stop the round when the digit hits<small>Runs already sent still finish; no new ones are sent.</small></span>
                </label>
                <button className={`nx-btn ${sx.trick ? 'nx-btn--hedge' : ''}`} onClick={() => runInAction(() => (sx.trick = !sx.trick))} aria-pressed={sx.trick}>
                    {sx.trick ? 'SAINTED TRICK: ON' : 'SAINTED TRICK: OFF'}
                </button>
                <button className={`nx-btn ${sx.running ? 'nx-btn--stop' : 'nx-btn--hedge'}`} disabled={!loaded && !sx.running} onClick={() => (sx.running ? stopRapid() : runInAction(() => (sx.running = true)))}>
                    {sx.running ? 'STOP' : 'START'}
                </button>
                {sx.digitMode === 'manual' && <button className='nx-btn nx-btn--go' disabled={sx.firing || !loaded} onClick={fireNow}>FIRE NOW ON {sx.digit}</button>}
                <button className='nx-btn' disabled={sx.testing} onClick={runHistoryTest}>{sx.testing ? 'TESTING…' : 'TEST ON HISTORY'}</button>
                {sx.testError && <p className='nx-muted nx-note'>{sx.testError}</p>}
                {t && (
                    <p className='nx-muted nx-note'>
                        Last {t.ticks.toLocaleString()} ticks of this market: {t.triggers} setups, the digit landed again within {t.runs} tick{t.runs === 1 ? '' : 's'} {t.hits} times ({t.rate.toFixed(1)}%).
                        Pure chance would give {t.chance.toFixed(1)}%.
                    </p>
                )}
            </Panel>
            <div className='nx-stack'>
                <div className={`nx-banner nx-banner--${sx.firing ? 'signal' : 'idle'}`}>
                    {!loaded ? 'Collecting ticks for this market, one moment…' : sx.firing ? 'Firing…' : sx.running ? (sx.watching !== null ? `Digit ${sx.watching} just rose, confirming…` : 'Watching every tick…') : 'Stopped. Press Start.'}
                </div>
                <Panel title={`Market: ${symbolName(sx.symbol)}`}>
                    <DigitCircles symbol={sx.symbol} marks={sx.watching !== null ? [sx.watching] : sx.digitMode === 'manual' ? [sx.digit] : []} />
                </Panel>
                <Panel title='Session'>
                    <div className='nx-dstats'>
                        <span>Rounds <b>{sx.rounds}</b></span>
                        <span>Rounds hit <b>{sx.roundsWon}</b></span>
                        <span>Trades sent <b>{sx.fired}</b></span>
                        <span>P/L <b>{sx.pnl.toFixed(2)}</b></span>
                    </div>
                    {sx.last && <p className='nx-muted'>{sx.last}</p>}
                    <button className='nx-btn' onClick={resetRapid}>Reset stats</button>
                </Panel>
            </div>
        </div>
    );
});
