const EMPTY_PAGE_HINTS = [
    'empty main content',
    'no job listing',
    'no actionable',
    'only footer',
    'blank',
    'loading',
    'spinner',
    'still loading',
    'page remains unchanged',
    'content has not loaded',
    'not yet loaded',
];

export function shouldRequestSelfFix(decision = {}, history = [], selfFixCount = 0) {
    if (selfFixCount >= 2) {
        return false;
    }

    const targetType = String(decision?.targetType || '').toLowerCase();
    const description = String(decision?.description || '').toLowerCase();
    const pageState = String(decision?.pageState || '').toLowerCase();
    const explicitWait = targetType === 'wait';
    const selfFixRequested = Boolean(decision?.selfFixAttempted);

    const recentHistory = history.slice(-3);
    const repeatedNoProgress = recentHistory.length >= 2 && recentHistory.every((entry) => {
        const result = String(entry?.result || '').toLowerCase();
        const navAction = String(entry?.navAction || '').toLowerCase();
        return result.includes('page unchanged')
            || result.includes('not found')
            || result.includes('failed')
            || result.includes('stalled')
            || navAction.includes('could not')
            || navAction.includes('failed');
    });

    const looksStalled = EMPTY_PAGE_HINTS.some((hint) => description.includes(hint) || pageState.includes(hint));
    return Boolean(explicitWait || selfFixRequested || (repeatedNoProgress && looksStalled));
}
