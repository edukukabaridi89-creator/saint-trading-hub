// @ts-nocheck
import React from 'react';
import { DigitAnalysis } from '@/nexus/digit-analysis';
import { DigitCircles, Field, Panel, SymbolSelect } from '@/nexus/ui';

export const DCircles = () => (
    <>
        <Panel title='Digit Analysis · last 1,000 ticks'>
            <Field label='Volatility index'><SymbolSelect /></Field>
            <DigitCircles />
        </Panel>
        <Panel title='Even / Odd and Over / Under analysis'>
            <DigitAnalysis />
        </Panel>
    </>
);
