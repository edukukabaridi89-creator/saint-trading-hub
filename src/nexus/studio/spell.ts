/** Forgiving input: expands trader shorthand and repairs small spelling mistakes, using only the words this studio knows. */

const VOCAB = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'half', 'point',
    'even', 'odd', 'over', 'under', 'above', 'below', 'differs', 'differ', 'matches', 'match', 'volatility', 'consecutive', 'consecutively', 'losses', 'loss', 'lost', 'lose', 'loses', 'wins', 'win', 'won',
    'martingale', 'recover', 'recovery', 'stake', 'profit', 'take', 'stop', 'tick', 'ticks', 'percent', 'percentage', 'digit', 'digits', 'market', 'markets', 'likelier', 'likely', 'probability',
    'switch', 'change', 'different', 'another', 'trade', 'trades', 'trading', 'dollars', 'dollar', 'after', 'before', 'when', 'wait', 'enter', 'entry', 'only', 'every', 'always', 'never',
    'double', 'triple', 'times', 'rising', 'falling', 'rise', 'fall', 'price', 'average', 'strength', 'index', 'pattern', 'repeat', 'repeating', 'condition', 'conditions', 'remove', 'delete', 'explain',
    'between', 'least', 'more', 'less', 'than', 'equal', 'equals', 'still', 'then', 'also', 'and', 'with', 'from', 'that', 'last', 'same', 'next', 'previous', 'again', 'start', 'reset',
];
const SET = new Set(VOCAB);

const lev = (a: string, b: string): number => {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 9;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // swapped letters
        }
    return d[m][n];
};

const FIXED: [RegExp, string][] = [
    [/\b(?:evn|eevn|evne|evan)\b/g, 'even'],
    [/\b(?:ood|oddd)\b/g, 'odd'],
    [/\b(?:dollas|dolars|dolla|dollors|bucks?)\b/g, 'dollars'],
    [/\bv\s*-?\s*(\d{2,3})\s*\(?(1s)?\)?\b/g, (_m: string, n: string, s?: string) => ` volatility ${n}${s ? ' 1s' : ''} `] as any,
    [/\bvol\s*-?\s*(\d{2,3})\b/g, ' volatility $1 '],
    [/\bdiff(?:s|er|erent)?\b(?!\s+(?:trade|volatility|market|contract|type))/g, 'differs'],
    [/\bcons(?:ec|ecutive|ecutively|ecutiv)\w*\b/g, 'consecutive'],
    [/\bin\s+a\s+row\b/g, 'consecutive'],
    [/\bback\s+to\s+back\b/g, 'consecutive'],
    [/\b(?:tp)\b/g, 'take profit'],
    [/\b(?:sl)\b/g, 'stop loss'],
    [/\bmarting(?:a|ae)l(?:e)?\b/g, 'martingale'],
];

export const repair = (raw: string): string => {
    let t = ` ${raw.toLowerCase()} `;
    for (const [re, to] of FIXED) t = t.replace(re, to as string);
    return t
        .split(/(\s+)/)
        .map(tok => {
            if (!/^[a-z]{4,}$/.test(tok) || SET.has(tok)) return tok;
            let best = '', bd = 9;
            for (const w of VOCAB) {
                const d = lev(tok, w);
                if (d < bd) { bd = d; best = w; }
            }
            return bd <= (tok.length >= 7 ? 2 : 1) ? best : tok;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
};
