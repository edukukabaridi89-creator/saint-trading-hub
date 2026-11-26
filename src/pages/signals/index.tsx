// @ts-nocheck
import React from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { ApiHelpers } from '@/external/bot-skeleton';
import { auto, loadSuggestion } from '@/nexus/auto-engine';
import { SYMBOLS, symbolName } from '@/nexus/config';
import { suggest } from '@/nexus/signals';
import { nexus } from '@/nexus/store';
import { hub } from '@/nexus/ticks-hub';
import { observable, runInAction } from 'mobx';
import { DigitCircles, Field, Num, Panel, useHub } from '@/nexus/ui';

/** What the user wants the signals for: one market or all of them. */
const pref = observable({ market: 'all' });

/** Loads the suggestion into Auto Trader: type, barrier and entry digit are filled, just press START AI / RUN NOW. */
const toAutoTrader = s => {
    loadSuggestion(s);
    nexus.goTab(DBOT_TABS.AUTO_TRADER);
};

/** Loads the suggestion into Bot Builder using the app's own Martingale quick-strategy template. */
const toBotBuilder = async s => {
    const qs = nexus.root?.quick_strategy;
    if (!qs || !ApiHelpers?.instance?.contracts_for) return nexus.log('Log in first so the app can load market data, then try again.');
    nexus.goTab(DBOT_TABS.BOT_BUILDER);
    qs.setSelectedStrategy('MARTINGALE');
    const stake = auto.stake;
    await qs.onSubmit({
        symbol: s.symbol,
        tradetype: s.type === 'DIGITEVEN' || s.type === 'DIGITODD' ? 'evenodd' : 'overunder',
        durationtype: 't',
        duration: 1,
        stake,
        profit: +(stake * 10).toFixed(2), // target profit and max loss are just starting values, editable in Bot Builder
        loss: +(stake * 20).toFixed(2),
        size: auto.mg.on ? auto.mg.mult : 1,
        last_digit_prediction: s.barrier,
        type: s.type,
        action: 'EDIT',
    });
    nexus.pullSymbol();
};

export const Signals = observer(() => {
    useHub(SYMBOLS.map(m => m.id));
    const rows = SYMBOLS.filter(m => !hub.isUnavailable(m.id) && (pref.market === 'all' || m.id === pref.market)).map(m => ({ id: m.id, sug: suggest(m.id) }));
    const rank = [...rows].filter(r => r.sug).sort((a, b) => b.sug.z - a.sug.z).map(r => r.id);
    return (
        <>
            <Panel title='Your settings (used when you load a signal)'>
                <div className='nx-row'>
                    <Field label='Stake'><Num min={0.35} step={0.1} value={auto.stake} onChange={v => (auto.stake = v)} /></Field>
                    <Field label='Signals for'>
                        <select className='nx-input' value={pref.market} onChange={e => runInAction(() => (pref.market = e.target.value))}>
                            <option value='all'>All markets</option>
                            {SYMBOLS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </Field>
                </div>
                <label className='nx-check'>
                    <input type='checkbox' checked={auto.mg.on} onChange={e => (auto.mg.on = e.target.checked)} />
                    <span>Martingale on loss<small>Multiply the stake after each loss, reset after a win.</small></span>
                </label>
                {auto.mg.on && (
                    <div className='nx-row'>
                        <Field label='Multiplier'><Num min={1.1} step={0.1} value={auto.mg.mult} onChange={v => (auto.mg.mult = v)} /></Field>
                        <Field label='Max steps'><Num int min={1} max={10} value={auto.mg.max} onChange={v => (auto.mg.max = v)} /></Field>
                    </div>
                )}
            </Panel>
            <div className='nx-muted'>
                Every volatility with its last-1,000-tick digit circles and the balanced trade type (Even, Odd, Over 1-6 or Under 3-8) whose winning digits currently stand out the most. Digit frequencies describe the past, they don't guarantee the next result.
            </div>
            <div className='nx-grid nx-grid--signals'>
                {rows.map(({ id, sug }) => {
                    const pos = rank.indexOf(id);
                    return (
                        <Panel key={id} className='nx-signal'>
                            <div className='nx-signal__head'>
                                <b>{symbolName(id)}</b>
                                {pos >= 0 && pos < 3 && sug.z >= 2 && <span className='nx-pill ok'>★ #{pos + 1} signal</span>}
                            </div>
                            <DigitCircles symbol={id} small trigger={sug?.trigger ?? null} />
                            {sug ? (
                                <div className='nx-signal__tip'>
                                    <span>Suggested: <b>{sug.label}</b> <span className={`nx-pill ${sug.z >= 2 ? 'ok' : ''}`}>{sug.z >= 3 ? 'Strong' : sug.z >= 2 ? 'Moderate' : 'Weak · looks like noise'}</span></span>
                                    <span className='nx-muted'>edge {sug.edge >= 0 ? '+' : ''}{sug.edge.toFixed(1)}% · enter when the cursor lands on <b>{sug.trigger}</b></span>
                                </div>
                            ) : (
                                <div className='nx-muted'>Loading ticks…</div>
                            )}
                            <div className='nx-row'>
                                <button className='nx-btn nx-btn--go nx-btn--sm' disabled={!sug} onClick={() => toAutoTrader(sug)}>Load in Auto Trader</button>
                                <button className='nx-btn nx-btn--sm' disabled={!sug} onClick={() => toBotBuilder(sug)}>Load in Bot Builder</button>
                            </div>
                        </Panel>
                    );
                })}
            </div>
        </>
    );
});
