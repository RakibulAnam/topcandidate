// Sign-up email gate. Three layers:
//
//   1. Format — `validator.isEmail` (battle-tested RFC-ish check, far better
//      than a hand-rolled regex for edge cases like quoted locals or IDN).
//   2. Disposable — block known throwaway providers (mailinator, guerrillamail,
//      tempmail, etc.) so accounts don't churn through fake addresses.
//   3. Local-part shape — refuse the obvious "asdfgh@gmail.com" style mash.
//      Names in email locals are *not* real-word-shaped (rakibul.anam,
//      j.smith85), so the bar here is much lower than the resume gibberish
//      detector — only block actual keyboard rolls.
//
// Note on bundle size: the disposable-email-domains JSON is ~2.3 MB (121k
// domains), so it's lazy-loaded inside `validateEmail`. That keeps the
// initial bundle lean — the lists only land when a signup is being checked.

import isEmail from 'validator/lib/isEmail';

export type EmailValidationResult =
    | { valid: true }
    | { valid: false; reason: string };

let disposableCache: { exact: Set<string>; wildcard: string[] } | null = null;

async function loadDisposableLists(): Promise<{ exact: Set<string>; wildcard: string[] }> {
    if (disposableCache) return disposableCache;
    const [exactMod, wildcardMod] = await Promise.all([
        import('disposable-email-domains'),
        import('disposable-email-domains/wildcard.json'),
    ]);
    const exactList = (exactMod.default ?? exactMod) as string[];
    const wildcardList = (wildcardMod.default ?? wildcardMod) as string[];
    disposableCache = {
        exact: new Set(exactList.map(d => d.toLowerCase())),
        wildcard: wildcardList.map(d => d.toLowerCase()),
    };
    return disposableCache;
}

async function isDisposableDomain(domain: string): Promise<boolean> {
    const d = domain.toLowerCase();
    const { exact, wildcard } = await loadDisposableLists();
    if (exact.has(d)) return true;
    // Wildcard list = "any subdomain of these is disposable" (so the rule
    // matches `x.foo.tk` against `foo.tk`, but not `foo.tk` itself unless
    // it's also in the exact list).
    for (const wd of wildcard) {
        if (d === wd || d.endsWith('.' + wd)) return true;
    }
    return false;
}

function isMashedLocal(local: string): boolean {
    const lower = local.toLowerCase();
    // Strip separators commonly found in real locals (rakibul.anam, j_smith,
    // first-last+tag) so "asd.fgh.jkl" still trips on its parts.
    const parts = lower.split(/[._+\-]+/).filter(p => p.length > 0);
    if (parts.length === 0) return true;

    for (const part of parts) {
        // Tiny parts are fine — initials, version suffixes, year tags.
        if (part.length < 5) continue;

        // 4+ same character in a row → "aaaaa", "kkkkkk"
        if (/(.)\1{3,}/.test(part)) return true;

        // 5+ consonants in a row → "asdfgh", "kjhgfd"
        if (/[^aeiouy\d]{5,}/.test(part)) return true;

        // No vowel at all in a 5+ char alphabetic part → "qwrtsd"
        if (/[a-z]/.test(part) && !/[aeiouy]/.test(part)) return true;
    }
    return false;
}

export async function validateEmail(rawEmail: string): Promise<EmailValidationResult> {
    const email = (rawEmail || '').trim();
    if (!email) return { valid: false, reason: 'Please enter your email address.' };

    if (!isEmail(email)) {
        return { valid: false, reason: 'That doesn\'t look like a valid email address.' };
    }

    const atIdx = email.lastIndexOf('@');
    const local = email.slice(0, atIdx);
    const domain = email.slice(atIdx + 1);

    // Run cheap shape check before paying for the disposable-list import — if
    // the local is obvious mash there's no point fetching 2 MB of domains.
    if (isMashedLocal(local)) {
        return {
            valid: false,
            reason: 'That email address looks invalid. Please use your real email.',
        };
    }

    if (await isDisposableDomain(domain)) {
        return {
            valid: false,
            reason: 'Disposable email addresses aren\'t allowed. Please use a permanent address.',
        };
    }

    return { valid: true };
}
