// @ts-nocheck
import React from 'react';
import { observer } from 'mobx-react-lite';
import { symbolName } from './config';
import { nexus } from './store';
import { hub } from './ticks-hub';
import { useHub } from './ui';

const pct = (a: number[], f: (d: number) => boolean) => (a.length ? (a.filter(f).length / a.length) * 100 : 0);

/** Even/Odd and Over/Under analysis of the selected market: last 1,000 ticks, with the last 100 shown beside it. */
export const DigitAnalysis = observer(() => {
    const sym = nexus.symbol;
    useHub([sym]);
    const all = hub.feed(sym)?.digits ?? [];
    const recent = all.slice(-100);
    if (all.length < 20) return <p className='nx-muted'>Collecting ticks for {symbolName(sym)}…</p>;
    const ev = pct(all, d => d % 2 === 0), ev100 = pct(recent, d => d % 2 === 0);
    const lead = ev >= 50 ? 'Even' : 'Odd', gap = Math.abs(ev - 50) * 2;
    let streak = 1;
    for (let i = all.length - 2; i >= 0 && all[i] % 2 === all.at(-1) % 2; i--) streak++;
    const overs = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(b => ({ b, p: pct(all, d => d > b), fair: (9 - b) * 10, p100: pct(recent, d => d > b) }));
    const unders = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(b => ({ b, p: pct(all, d => d < b), fair: b * 10, p100: pct(recent, d => d < b) }));
    const best = (rows: any[]) => rows.reduce((m, r) => (r.p - r.fair > m.p - m.fair ? r : m), rows[0]);
    const bo = best(overs), bu = best(unders);
    const Row = ({ rows, label, top }: any) => (
        <div className='nx-ou'>
            <b>{label}</b>
            <div>
                {rows.map(r => (
                    <span key={r.b} className={r.b === top.b ? 'is-best' : ''} title={`${label} ${r.b}: ${r.p.toFixed(1)}% of the last ${all.length} ticks (fair ${r.fair}%), ${r.p100.toFixed(0)}% of the last 100`}>
                        <i>{label} {r.b}</i>{r.p.toFixed(1)}%<em className={r.p - r.fair >= 0 ? 'up' : 'dn'}>{r.p - r.fair >= 0 ? '+' : ''}{(r.p - r.fair).toFixed(1)}</em>
                    </span>
                ))}
            </div>
        </div>
    );
    return (
        <div className='nx-ana'>
            <div className='nx-eo'>
                <div className='nx-eo__bar'><i style={{ width: `${ev}%` }} /></div>
                <div className='nx-eo__row'><span>Even <b>{ev.toFixed(1)}%</b></span><span className='nx-muted'>last 100: Even {ev100.toFixed(0)}% · Odd {(100 - ev100).toFixed(0)}%</span><span>Odd <b>{(100 - ev).toFixed(1)}%</b></span></div>
                <p className='nx-muted'>{symbolName(sym)}: {gap < 1 ? 'Even and Odd are almost level' : `${lead} leads by ${gap.toFixed(1)} points`} over the last {all.length} ticks. Current run: {streak} {all.at(-1) % 2 === 0 ? 'even' : 'odd'} in a row.</p>
                <div className='nx-trail'>{all.slice(-20).map((d, i, a) => <span key={i} className={`${d % 2 ? 'o' : 'e'} ${i === a.length - 1 ? 'now' : ''}`}>{d % 2 ? 'O' : 'E'}</span>)}</div>
            </div>
            <Row rows={overs} label='Over' top={bo} />
            <Row rows={unders} label='Under' top={bu} />
            <p className='nx-muted nx-note'>Small figures show how far each side is from its fair share (for example Over 3 is fair at 60%). Highlighted: the side furthest above fair right now.</p>
        </div>
    );
});
