// HelpContactSection — "Need a hand?" block with a direct email to support.
//
// Rendered on the dashboard, below purchase history, so anyone with an
// account or payment question has an obvious way to reach us. The email
// address lives in `presentation/support.ts` (single source of truth) and
// the CTA opens a prefilled mailto. Transaction problems are called out
// explicitly because that's the most common reason people need us.

import React from 'react';
import { LifeBuoy, Mail } from 'lucide-react';
import { useT } from '../i18n/LocaleContext';
import { CONTACT_EMAIL, contactMailto } from '../support';

export const HelpContactSection: React.FC = () => {
    const t = useT();
    const mailto = contactMailto(t('help.emailSubject'));

    return (
        <section id="help" aria-labelledby="help-heading" className="mt-12">
            <div className="rounded-2xl border border-charcoal-200 bg-white p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="flex gap-4">
                        <span className="h-11 w-11 rounded-xl bg-accent-50 border border-accent-100 text-accent-600 flex items-center justify-center shrink-0">
                            <LifeBuoy size={20} />
                        </span>
                        <div>
                            <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold mb-1">
                                {t('help.eyebrow')}
                            </p>
                            <h2 id="help-heading" className="font-display text-xl sm:text-2xl font-semibold text-brand-700">
                                {t('help.title')}
                            </h2>
                            <p className="mt-2 text-sm text-brand-500 leading-relaxed max-w-xl">{t('help.body')}</p>
                            <p className="mt-2 text-[13px] text-charcoal-500 leading-relaxed max-w-xl">{t('help.transactionNote')}</p>
                        </div>
                    </div>

                    <div className="shrink-0 sm:text-center">
                        <a
                            href={mailto}
                            className="inline-flex items-center justify-center gap-2 bg-brand-700 text-white font-semibold px-5 py-3 rounded-full hover:bg-brand-800 transition-colors text-sm"
                        >
                            <Mail size={16} />
                            {t('help.emailCta')}
                        </a>
                        <p className="mt-2 text-[12px] text-charcoal-500">
                            <a
                                href={mailto}
                                className="font-mono text-brand-600 hover:text-accent-600 underline underline-offset-2 break-all"
                            >
                                {CONTACT_EMAIL}
                            </a>
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};
