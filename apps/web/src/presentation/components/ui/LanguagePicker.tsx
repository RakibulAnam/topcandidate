import * as React from 'react';
import ISO6391 from 'iso-639-1';
import { ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from './utils';

interface LangEntry {
    code: string;
    name: string;
    nativeName: string;
}

let _cache: LangEntry[] | null = null;
function getAllLanguages(): LangEntry[] {
    if (_cache) return _cache;
    _cache = ISO6391.getAllCodes().map(code => ({
        code,
        name: ISO6391.getName(code),
        nativeName: ISO6391.getNativeName(code),
    })).sort((a, b) => a.name.localeCompare(b.name));
    return _cache;
}

type Props = {
    value: string;
    onChange: (name: string) => void;
    isError?: boolean;
    disabled?: boolean;
    placeholder?: string;
};

export function LanguagePicker({ value, onChange, isError, disabled, placeholder = 'Select language…' }: Props) {
    const languages = React.useMemo(() => getAllLanguages(), []);
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');

    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return languages;
        return languages.filter(
            l =>
                l.name.toLowerCase().includes(q) ||
                l.nativeName.toLowerCase().includes(q) ||
                l.code.toLowerCase().startsWith(q),
        );
    }, [languages, search]);

    const handleSelect = (name: string) => {
        onChange(name);
        setOpen(false);
        setSearch('');
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3.5 py-2.5 text-sm transition-colors focus:outline-none',
                        isError
                            ? 'border-red-400 focus:ring-2 focus:ring-red-400'
                            : 'border-charcoal-300 hover:border-charcoal-400 focus:ring-2 focus:ring-accent-400 focus:border-accent-400',
                        disabled && 'cursor-not-allowed bg-charcoal-100 text-charcoal-400',
                        !value && 'text-charcoal-400',
                        value && 'text-brand-800',
                    )}
                >
                    <span className="truncate">{value || placeholder}</span>
                    <ChevronDown size={14} className="shrink-0 text-charcoal-400" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-72 p-0">
                <div className="flex items-center gap-2 border-b border-charcoal-200 px-3 py-2">
                    <Search size={14} className="text-charcoal-400" />
                    <input
                        autoFocus
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search language…"
                        className="flex-1 bg-transparent text-sm text-brand-800 placeholder:text-charcoal-400 focus:outline-none"
                    />
                </div>
                <ul className="max-h-64 overflow-y-auto py-1">
                    {filtered.map(l => (
                        <li key={l.code}>
                            <button
                                type="button"
                                onClick={() => handleSelect(l.name)}
                                className={cn(
                                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-accent-50',
                                    value === l.name && 'bg-accent-50 font-semibold text-brand-800',
                                )}
                            >
                                <span className="text-brand-800">{l.name}</span>
                                <span className="text-xs text-charcoal-500 shrink-0">{l.nativeName}</span>
                            </button>
                        </li>
                    ))}
                    {filtered.length === 0 && (
                        <li className="px-3 py-3 text-sm text-charcoal-500">No matches</li>
                    )}
                </ul>
            </PopoverContent>
        </Popover>
    );
}
