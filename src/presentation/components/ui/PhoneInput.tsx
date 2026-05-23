import * as React from 'react';
import {
    AsYouType,
    getCountries,
    getCountryCallingCode,
    getExampleNumber,
    isValidPhoneNumber,
    parsePhoneNumberFromString,
    type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/examples.mobile.json';
import { ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from './utils';

// Country-specific example shown as the input placeholder so the user sees
// the expected national format ("01712-345678" for BD, "(201) 555-0123" for
// US, etc). Falls back silently if the country has no example in the
// metadata.
function examplePlaceholder(country: CountryCode): string {
    try {
        const ex = getExampleNumber(country, examples);
        return ex ? ex.formatNational() : '';
    } catch {
        return '';
    }
}

// Default to Bangladesh — primary user base. Falls back to US if BD is ever
// removed from the metadata.
const DEFAULT_COUNTRY: CountryCode = 'BD';

// Unicode regional-indicator emoji from ISO-3166 alpha-2 code. Works in
// every modern browser without a flag-asset dependency.
function flagFor(country: CountryCode): string {
    const codePoints = country
        .toUpperCase()
        .split('')
        .map(c => 0x1f1a5 + c.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

// `Intl.DisplayNames` is in every evergreen browser. We hold one instance per
// UI locale at module load — building it per render is wasteful.
const englishDisplayNames =
    typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
        ? new Intl.DisplayNames(['en'], { type: 'region' })
        : null;

function nameFor(country: CountryCode): string {
    if (englishDisplayNames) {
        try {
            return englishDisplayNames.of(country) || country;
        } catch {
            return country;
        }
    }
    return country;
}

interface CountryEntry {
    code: CountryCode;
    name: string;
    callingCode: string;
    flag: string;
}

// Built once on first render — `getCountries()` returns ~240 entries and the
// data never changes within a session.
let _countriesCache: CountryEntry[] | null = null;
function getAllCountries(): CountryEntry[] {
    if (_countriesCache) return _countriesCache;
    _countriesCache = getCountries()
        .map(code => ({
            code,
            name: nameFor(code),
            callingCode: getCountryCallingCode(code),
            flag: flagFor(code),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return _countriesCache;
}

// Best-effort guess of the country a stored phone number belongs to.
// Returns `undefined` if the value is blank or can't be parsed — caller
// decides on the default country in that case.
function detectCountry(value: string): CountryCode | undefined {
    if (!value) return undefined;
    const parsed = parsePhoneNumberFromString(value);
    return parsed?.country;
}

export function isValidPhone(value: string, country?: CountryCode): boolean {
    if (!value || !value.trim()) return false;
    try {
        return isValidPhoneNumber(value.trim(), country);
    } catch {
        return false;
    }
}

type Props = {
    value: string;
    onChange: (value: string) => void;
    // External error from the parent's form-submit validator. Forces red
    // treatment even before the field has been touched.
    error?: string;
    invalidMessage?: string;
    placeholder?: string;
    disabled?: boolean;
    defaultCountry?: CountryCode;
    onValidChange?: (valid: boolean) => void;
    className?: string;
    id?: string;
};

// Phone input with international country picker.
//
// Value contract: the value passed to `onChange` is the user's raw typed
// digits formatted for the chosen country (international E.164 once it
// parses to a complete number, e.g. `+8801711000000`). We do NOT strip
// the leading `+` — downstream code (PDF render, Supabase, AI prompts)
// can use the stored string verbatim.
export function PhoneInput({
    value,
    onChange,
    error,
    invalidMessage = "That doesn't look like a valid phone number.",
    placeholder,
    disabled,
    defaultCountry = DEFAULT_COUNTRY,
    onValidChange,
    className,
    id,
}: Props) {
    const countries = React.useMemo(() => getAllCountries(), []);

    // Country is local UI state — the canonical value the parent owns is the
    // formatted phone string. We seed from the stored value when present.
    const [country, setCountry] = React.useState<CountryCode>(
        () => detectCountry(value) || defaultCountry,
    );

    // If the parent swaps in a value (e.g. after loading profile), and that
    // value carries a different country code, follow it.
    React.useEffect(() => {
        const detected = detectCountry(value);
        if (detected && detected !== country) {
            setCountry(detected);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const [touched, setTouched] = React.useState(false);
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');

    const filteredCountries = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return countries;
        return countries.filter(
            c =>
                c.name.toLowerCase().includes(q) ||
                c.code.toLowerCase().includes(q) ||
                c.callingCode.includes(q),
        );
    }, [countries, search]);

    const valid = isValidPhone(value, country);
    React.useEffect(() => {
        onValidChange?.(valid);
    }, [valid, onValidChange]);

    const showLiveError = touched && !!value.trim() && !valid;
    const displayError = error || (showLiveError ? invalidMessage : undefined);
    const hasError = !!displayError;

    // National part shown to the user — strip the calling code so they only
    // see/edit the local digits. When the user changes country we keep the
    // local digits and re-attach the new prefix.
    const localPart = React.useMemo(() => {
        const callingCode = '+' + getCountryCallingCode(country);
        const v = value.trim();
        if (v.startsWith(callingCode)) {
            return v.slice(callingCode.length).trimStart();
        }
        // Value belongs to another country (or is freshly typed digits);
        // show as-is, letting the AsYouType formatter handle it.
        return v;
    }, [value, country]);

    const formatPhone = (rawLocal: string, c: CountryCode): string => {
        const digitsOnly = rawLocal.replace(/[^\d]/g, '');
        if (!digitsOnly) return '';
        // AsYouType returns the user's input progressively formatted in
        // international form for the chosen country.
        const formatter = new AsYouType(c);
        formatter.input('+' + getCountryCallingCode(c) + digitsOnly);
        return formatter.getNumber()?.formatInternational() || `+${getCountryCallingCode(c)} ${digitsOnly}`;
    };

    const handleLocalChange = (next: string) => {
        onChange(formatPhone(next, country));
    };

    const handleCountrySelect = (next: CountryCode) => {
        setCountry(next);
        setPickerOpen(false);
        setSearch('');
        // Re-format the existing local digits under the new country.
        if (localPart) {
            onChange(formatPhone(localPart, next));
        }
    };

    const current = countries.find(c => c.code === country);

    return (
        <div className="flex flex-col gap-1">
            <div
                className={cn(
                    'flex items-stretch rounded-lg border bg-white transition-colors',
                    hasError
                        ? 'border-red-400 focus-within:ring-2 focus-within:ring-red-400'
                        : 'border-charcoal-300 hover:border-charcoal-400 focus-within:ring-2 focus-within:ring-accent-400 focus-within:border-accent-400',
                    disabled && 'bg-charcoal-100 text-charcoal-400',
                    className,
                )}
            >
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            disabled={disabled}
                            aria-label={`Country: ${current?.name ?? country}`}
                            className="flex items-center gap-1.5 pl-3 pr-2 py-2.5 text-sm text-brand-800 border-r border-charcoal-200 hover:bg-charcoal-50 focus:outline-none rounded-l-lg disabled:cursor-not-allowed"
                        >
                            <span className="text-base leading-none" aria-hidden>
                                {current?.flag ?? '🌐'}
                            </span>
                            <span className="text-charcoal-600">+{current?.callingCode ?? ''}</span>
                            <ChevronDown size={14} className="text-charcoal-400" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        sideOffset={6}
                        className="w-72 p-0"
                    >
                        <div className="flex items-center gap-2 border-b border-charcoal-200 px-3 py-2">
                            <Search size={14} className="text-charcoal-400" />
                            <input
                                autoFocus
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search country or code"
                                className="flex-1 bg-transparent text-sm text-brand-800 placeholder:text-charcoal-400 focus:outline-none"
                            />
                        </div>
                        <ul className="max-h-64 overflow-y-auto py-1">
                            {filteredCountries.map(c => {
                                const active = c.code === country;
                                return (
                                    <li key={c.code}>
                                        <button
                                            type="button"
                                            onClick={() => handleCountrySelect(c.code)}
                                            className={cn(
                                                'flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent-50',
                                                active && 'bg-accent-50 text-brand-800 font-semibold',
                                            )}
                                        >
                                            <span className="text-base leading-none" aria-hidden>
                                                {c.flag}
                                            </span>
                                            <span className="flex-1 truncate text-brand-800">{c.name}</span>
                                            <span className="text-xs text-charcoal-500">+{c.callingCode}</span>
                                        </button>
                                    </li>
                                );
                            })}
                            {filteredCountries.length === 0 && (
                                <li className="px-3 py-3 text-sm text-charcoal-500">
                                    No matches
                                </li>
                            )}
                        </ul>
                    </PopoverContent>
                </Popover>
                <input
                    id={id}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    disabled={disabled}
                    value={localPart}
                    onChange={e => handleLocalChange(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={hasError}
                    placeholder={examplePlaceholder(country) || placeholder || 'Phone number'}
                    className="flex-1 min-w-0 bg-transparent px-3.5 py-2.5 text-sm text-brand-800 placeholder:text-charcoal-400 focus:outline-none rounded-r-lg disabled:cursor-not-allowed"
                />
            </div>
            {displayError && (
                <span className="text-xs text-red-600 font-medium">{displayError}</span>
            )}
        </div>
    );
}
