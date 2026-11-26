// @ts-nocheck
import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { SYMBOLS, symbolName } from '@/nexus/config';
import { mp, placeRound, refreshPicks, roundStake } from '@/nexus/matches-pro';
import { hub } from '@/nexus/ticks-hub';
import { DigitCircles, Field, Num, Panel } from '@/nexus/ui';
import { runInAction } from 'mobx';
import { useState } from 'react';
import { RapidMatches } from './rapid';

export const MatchesPro = observer(() => {
    const [mode, setMode] = useState<'rapid' | 'spread'>('rapid');
    useEffect(() => { hub.watch([mp.symbol]); refreshPicks(); const t = setInterval(refreshPicks, 1000); return () => clearInterval(t); }, [mp.symbol, mp.n, mp.count]);
    const ready = mp.picks.length >= mp.count;
    const total = Math.round(roundStake() * mp.count * 100) / 100;
    const f = hub.feed(mp.symbol);
    const need = mp.n * 2;
    const loaded = (f?.digits.length ?? 0) >= need;
    const tabs = (
        <div className='nx-seg' style={{ margin: '0 0 12px' }}>
            <button className={mode === 'rapid' ? 'on' : ''} onClick={() => setMode('rapid')}>Rapid</button>
            <button className={mode === 'spread' ? 'on' : ''} onClick={() => setMode('spread')}>Several digits</button>
        </div>
    );
    if (mode === 'rapid') return <><div style={{ padding: '0 12px' }}>{tabs}</div><RapidMatches /></>;
    return (
        <div className='nx-split'>
            <Panel title='Matches Pro'>
                {tabs}
                <Field label='Market'>
                    <select className='nx-input' value={mp.symbol} onChange={e => runInAction(() => { mp.symbol = e.target.value; mp.picks = []; hub.watch([e.target.value]); })}>
                        {SYMBOLS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <Field label='Who takes the trades'>
                    <div className='nx-seg'>
                        <button className={mp.auto ? 'on' : ''} onClick={() => runInAction(() => { mp.auto = true; mp.running = false; })}>Automatic</button>
                        <button className={!mp.auto ? 'on' : ''} onClick={() => runInAction(() => { mp.auto = false; mp.running = false; })}>Manual</button>
                    </div>
                </Field>
                <div className='nx-row'>
                    <Field label='Digits at once'><Num int min={1} max={6} value={mp.count} onChange={v => (mp.count = v)} /></Field>
                    <Field label='Stake per digit'><Num min={0.35} step={0.1} value={mp.stake} onChange={v => (mp.stake = v)} /></Field>
                </div>
                <div className='nx-row'>
                    <Field label='Duration (ticks)'><Num int min={1} max={10} value={mp.ticks} onChange={v => (mp.ticks = v)} /></Field>
                    <Field label='Digits that rose in the last'>
                        <select className='nx-input' value={mp.n} onChange={e => (mp.n = Number(e.target.value))}>
                            <option value={3}>3 ticks</option><option value={5}>5 ticks</option><option value={8}>8 ticks</option><option value={10}>10 ticks</option><option value={15}>15 ticks</option>
                        </select>
                    </Field>
                </div>
                <div className='nx-row'>
                    <Field label='Take profit (0 = off)'><Num min={0} step={1} value={mp.tp} onChange={v => (mp.tp = v)} /></Field>
                    <Field label='Stop loss (0 = off)'><Num min={0} step={1} value={mp.sl} onChange={v => (mp.sl = v)} /></Field>
                </div>
                <label className='nx-check'>
                    <input type='checkbox' checked={mp.mg.on} onChange={e => (mp.mg.on = e.target.checked)} />
                    <span>Martingale on loss<small>Multiply the stake per digit after a lost round, reset after a win.</small></span>
                </label>
                {mp.mg.on && (
                    <div className='nx-row'>
                        <Field label='Multiplier'><Num min={1.1} step={0.1} value={mp.mg.mult} onChange={v => (mp.mg.mult = v)} /></Field>
                        <Field label='Max steps'><Num int min={1} max={8} value={mp.mg.max} onChange={v => (mp.mg.max = v)} /></Field>
                    </div>
                )}
                <p className='nx-muted nx-note'>Each round buys {mp.count} Matches contract{mp.count === 1 ? '' : 's'} at the same moment, each at the same price ({total.toFixed(2)} in total). At most one can win. A win pays several times one stake, so it covers the cost of the round plus part of earlier losses, but most rounds still lose.</p>
                {mp.auto ? (
                    <button className={`nx-btn ${mp.running ? 'nx-btn--stop' : 'nx-btn--hedge'}`} disabled={!loaded && !mp.running} onClick={() => runInAction(() => (mp.running = !mp.running))}>
                        {mp.running ? 'STOP' : 'START AUTOMATIC'}
                    </button>
                ) : (
                    <button className={`nx-btn nx-btn--hedge ${ready ? 'nx-glow' : ''}`} disabled={!ready || mp.busy} onClick={placeRound}>
                        {mp.busy ? 'TRADING…' : `TRADE NOW · ${mp.picks.slice(0, mp.count).join(' · ') || '…'}`}
                    </button>
                )}
            </Panel>
            <div className='nx-stack'>
                <div className={`nx-banner nx-banner--${ready ? 'signal' : 'idle'}`}>
                    {!loaded
                        ? 'Collecting ticks for this market, one moment…'
                        : ready
                            ? `Digits that rose in the last ${mp.n} ticks: ${mp.picks.join(', ')}${mp.auto ? (mp.running ? ' — placing the round.' : ' — press Start to trade them automatically.') : ' — press Trade now.'}`
                            : `Waiting for ${mp.count} digits that rose (found ${mp.picks.length}).`}
                </div>
                <Panel title={`Market: ${symbolName(mp.symbol)}`}>
                    <DigitCircles symbol={mp.symbol} marks={mp.picks.slice(0, mp.count)} />
                </Panel>
                <Panel title='Session'>
                    <div className='nx-dstats'>
                        <span>Rounds <b>{mp.rounds}</b></span>
                        <span>Rounds won <b>{mp.wins}</b></span>
                        <span>Hit rate <b>{mp.rounds ? ((mp.wins / mp.rounds) * 100).toFixed(0) : '--'}%</b></span>
                        <span>P/L <b>{mp.pnl.toFixed(2)}</b></span>
                    </div>
                    {mp.last && <p className='nx-muted'>Last round: {mp.last}</p>}
                    <p className='nx-muted nx-note'>A digit "rises" when it lands and its share of the last 1,000 ticks goes up. Watch the hit rate over many rounds before trusting the pattern; a short winning streak proves nothing.</p>
                </Panel>
            </div>
        </div>
    );
});
