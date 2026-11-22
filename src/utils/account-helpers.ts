// Account and device utility functions
// Moved from src/analytics/utils.ts during analytics cleanup

export const MAX_MOBILE_WIDTH = 926;
export const ACCOUNT_TYPE_KEY = 'account_type';
export const TARGET_MARKETING_LOGINID = 'ROT90116785';
export const ROT_MARKETING_STORAGE_KEY = `rot_marketing_config_${TARGET_MARKETING_LOGINID}`;
export const ROT_MARKETING_EVENT_NAME = 'rot-marketing-config-updated';

export interface RotMarketingConfig {
    enabled: boolean;
    loginid: string;
    balance: number;
    profitabilityEnabled: boolean;
    profitabilityRate: number; // 0 to 100
    updatedAt: number;
}

export const getRotMarketingConfig = (loginid?: string | null): RotMarketingConfig | null => {
    if (loginid !== TARGET_MARKETING_LOGINID) return null;
    try {
        const raw = localStorage.getItem(ROT_MARKETING_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<RotMarketingConfig>;
        if (parsed.enabled === false) return null;
        const balance = typeof parsed.balance === 'number' && Number.isFinite(parsed.balance) ? parsed.balance : 0;
        const profitabilityEnabled =
            typeof parsed.profitabilityEnabled === 'boolean' ? parsed.profitabilityEnabled : true;
        const profitabilityRate =
            typeof parsed.profitabilityRate === 'number' && Number.isFinite(parsed.profitabilityRate)
                ? Math.max(0, Math.min(100, parsed.profitabilityRate))
                : 50;
        return {
            enabled: true,
            loginid: TARGET_MARKETING_LOGINID,
            balance,
            profitabilityEnabled,
            profitabilityRate,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        };
    } catch {
        return null;
    }
};

export const setRotMarketingBalance = (nextBalance: number): RotMarketingConfig => {
    const existing = getRotMarketingConfig(TARGET_MARKETING_LOGINID);
    const safeBalance = Number.isFinite(nextBalance) ? Math.max(0, nextBalance) : 0;
    const updated: RotMarketingConfig = {
        enabled: true,
        loginid: TARGET_MARKETING_LOGINID,
        balance: safeBalance,
        profitabilityEnabled: existing ? existing.profitabilityEnabled : true,
        profitabilityRate: existing ? existing.profitabilityRate : 50,
        updatedAt: Date.now(),
    };
    try {
        localStorage.setItem(ROT_MARKETING_STORAGE_KEY, JSON.stringify(updated));
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent<RotMarketingConfig>(ROT_MARKETING_EVENT_NAME, { detail: updated }));
        }
    } catch {
        // Ignore storage write errors
    }
    return updated;
};

export const adjustRotMarketingBalance = (delta: number): RotMarketingConfig | null => {
    const existing = getRotMarketingConfig(TARGET_MARKETING_LOGINID);
    if (!existing) return null;
    return setRotMarketingBalance(existing.balance + delta);
};

/**
 * Check if a loginid represents a demo account
 * Demo accounts have specific prefixes:
 * - VRTC: Classic demo accounts
 * - VRW: Demo wallet accounts
 * - Starts with DEM: Demo accounts with DEM prefix
 *
 * @param loginid - The account loginid to check
 * @returns true if demo account, false otherwise
 */
export const isDemoAccount = (loginid: string): boolean => {
    if (!loginid) return false;
    // Demo accounts: VRTC (classic), VRW (wallets), or DEM prefix
    return (
        loginid.startsWith('VRTC') ||
        loginid.startsWith('VRW') ||
        loginid.startsWith('DEM') ||
        loginid.startsWith('DOT')
    );
};

/**
 * Get account type based on loginid and localStorage
 * This is the centralized function for determining account type
 * Loginid is the primary source of truth when provided
 *
 * @param loginid - Optional loginid to check (if not provided, uses localStorage only)
 * @returns 'demo' or 'real' or 'public' if cannot determine
 */
export const getAccountType = (loginid?: string): string | undefined => {
    try {
        // If loginid is provided, use it as the source of truth
        if (loginid) {
            return isDemoAccount(loginid) ? 'demo' : 'real';
        }

        // Only fallback to public when loginid is not available
        return 'public';
    } catch (error) {
        // Handle cases where localStorage is not available (SSR, private browsing, etc.)
        return 'public';
    }
};

/**
 * Gets account_id with priority: URL parameter > localStorage > null
 * @returns account_id string or null
 */
export const getAccountId = (): string | null => {
    // 1. Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const accountIdFromUrl = urlParams.get('account_id');

    const tokenFromUrl = urlParams.get('token');
    // Remove token from URL if present
    if (tokenFromUrl) {
        removeUrlParameter('token');
    }

    if (accountIdFromUrl) {
        // Store account ID in localStorage for future use
        localStorage.setItem('active_loginid', accountIdFromUrl);
        // Remove from URL after storing
        removeUrlParameter('account_id');
        // Return the account ID immediately as it takes precedence over localStorage
        return accountIdFromUrl;
    }

    // 2. Check localStorage
    return localStorage.getItem('active_loginid');
};

/**
 * Check if current account is virtual/demo
 * Loginid is the primary source of truth - if provided and valid, it takes precedence
 * Only falls back to localStorage when loginid is not available or empty
 *
 * @param loginid - The account loginid to check
 * @returns true if demo/virtual account, false otherwise
 */
export const isVirtualAccount = (loginid: string): boolean => {
    // If loginid is provided and valid, use it as the source of truth
    if (loginid) {
        return isDemoAccount(loginid);
    }

    // Only fallback to localStorage when loginid is not available
    try {
        const savedAccountType = localStorage.getItem(ACCOUNT_TYPE_KEY);
        return savedAccountType === 'demo';
    } catch (error) {
        return false;
    }
};

/**
 * Get device type based on screen width
 * @returns 'mobile' or 'desktop'
 */
export const getDeviceType = () => {
    // SSR safety check and use constant for breakpoint
    if (typeof window === 'undefined') return 'desktop';
    return window.innerWidth <= MAX_MOBILE_WIDTH ? 'mobile' : 'desktop';
};

/**
 * Removes a parameter from the current URL without page reload
 * @param paramName - The name of the parameter to remove
 */
export const removeUrlParameter = (paramName: string): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete(paramName);
    window.history.replaceState({}, document.title, url.toString());
};
