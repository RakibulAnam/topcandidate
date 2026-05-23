import * as React from 'react';
import isEmail from 'validator/lib/isEmail';
import { cn } from './utils';

// Synchronous, single-source-of-truth email format check used by every form
// field. Heavier checks (disposable-domain block, mash-detection) live in
// `application/validation/emailValidator.ts` and only run at signup — those
// require lazy-loading a 2 MB domain list, which we don't want on every
// keystroke of every profile field.
export function isValidEmail(value: string): boolean {
    const trimmed = (value || '').trim();
    if (!trimmed) return false;
    return isEmail(trimmed);
}

type Props = Omit<React.ComponentProps<'input'>, 'onChange' | 'value' | 'type'> & {
    value: string;
    onChange: (value: string) => void;
    // External error from the parent's form-submit validator. When set,
    // overrides the live-validation state and forces the red treatment.
    error?: string;
    // Generic invalid-format message. Defaults to a short English string;
    // callers in localized contexts should pass a translated one in.
    invalidMessage?: string;
    onValidChange?: (valid: boolean) => void;
};

// Inline-validated email input. Shows the red treatment only after the
// field has been blurred at least once (so we don't yell at the user while
// they're still typing) OR when the parent passes an external `error`.
export function EmailInput({
    value,
    onChange,
    error,
    invalidMessage = "That doesn't look like a valid email.",
    onValidChange,
    onBlur,
    className,
    ...rest
}: Props) {
    const [touched, setTouched] = React.useState(false);
    const valid = isValidEmail(value);

    // Surface validity changes to parents that wire up custom enable/disable
    // logic on top of the field (e.g. a Save button).
    React.useEffect(() => {
        onValidChange?.(valid);
    }, [valid, onValidChange]);

    const showLiveError = touched && !!value.trim() && !valid;
    const displayError = error || (showLiveError ? invalidMessage : undefined);
    const hasError = !!displayError;

    return (
        <div className="flex flex-col gap-1">
            <input
                {...rest}
                type="email"
                inputMode="email"
                autoComplete={rest.autoComplete ?? 'email'}
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={e => {
                    setTouched(true);
                    onBlur?.(e);
                }}
                aria-invalid={hasError}
                className={cn(
                    'w-full rounded-lg border px-3.5 py-2.5 text-sm bg-white text-brand-800 placeholder:text-charcoal-400 focus:outline-none focus-visible:ring-2 transition-colors disabled:bg-charcoal-100 disabled:text-charcoal-400',
                    hasError
                        ? 'border-red-400 focus-visible:ring-red-400'
                        : 'border-charcoal-300 hover:border-charcoal-400 focus-visible:ring-accent-400 focus-visible:border-accent-400',
                    className,
                )}
            />
            {displayError && (
                <span className="text-xs text-red-600 font-medium">{displayError}</span>
            )}
        </div>
    );
}
