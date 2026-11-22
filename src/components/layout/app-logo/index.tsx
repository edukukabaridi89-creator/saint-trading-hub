// Customizable header logo + app name for white-labeling. Renders on both desktop and
// mobile (next to the hamburger). The logo/name resolution lives in LogoMark: partner
// logo (public/logo.<ext>, written by the BFF at deploy time, or a live data URL pushed
// from the App Builder via PREVIEW_BRANDING) → letter-badge fallback; app name from the
// preview or the resolved deploy/build name.
import React, { useRef } from 'react';
import { localize } from '@deriv-com/translations';
import { LogoMark } from './LogoMark';
import './app-logo.scss';

export const TARGET_MARKETING_LOGINID = 'ROT90116785';
const TAP_WINDOW_MS = 1500;
const REQUIRED_TAPS = 5;

interface AppLogoProps {
    activeLoginid?: string | null;
    onTriggerMarketingReset?: () => void;
}

export const AppLogo = ({ activeLoginid, onTriggerMarketingReset }: AppLogoProps) => {
    const tapTimestampsRef = useRef<number[]>([]);

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!onTriggerMarketingReset || activeLoginid !== TARGET_MARKETING_LOGINID) {
            return;
        }

        const now = Date.now();
        const recentTaps = tapTimestampsRef.current.filter(ts => now - ts <= TAP_WINDOW_MS);
        recentTaps.push(now);
        tapTimestampsRef.current = recentTaps;

        if (recentTaps.length >= REQUIRED_TAPS) {
            tapTimestampsRef.current = [];
            e.preventDefault();
            e.stopPropagation();
            onTriggerMarketingReset();
        }
    };

    return (
        <a
            href='/'
            className='app-header__logo'
            aria-label={localize('Home')}
            onClick={handleClick}
        >
            <LogoMark height={32} />
        </a>
    );
};
