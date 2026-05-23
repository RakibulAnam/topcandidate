import React from 'react';
import { LogOut, User, Menu } from 'lucide-react';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { useT } from '../../i18n/LocaleContext';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { CreditsBadge } from '../CreditsBadge';

interface NavbarProps {
    onDashboardClick?: () => void;
    showExitBuilder?: boolean;
    /** Optional — when supplied, the navbar shows a clickable credits pill. */
    credits?: number | null;
    onBuyCredits?: () => void;
}

export const Navbar = ({ onDashboardClick, showExitBuilder, credits, onBuyCredits }: NavbarProps) => {
    const { signOut, user } = useAuth();
    const t = useT();
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);

    return (
        <nav className="bg-white border-b border-charcoal-200 sticky top-0 z-20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                    {/* Logo Section */}
                    <button type="button" className="flex items-center" onClick={onDashboardClick}>
                        <div className="flex items-baseline gap-1.5 select-none">
                            <span className="font-display text-lg font-semibold tracking-tight text-brand-700">TOP</span>
                            <span className="font-display text-lg font-semibold tracking-tight text-accent-500">CANDIDATE</span>
                        </div>
                    </button>

                    {/* Center Section - Optional (could be used for simple nav links later) */}
                    <div className="hidden md:flex items-center flex-1 justify-center px-8">
                        {showExitBuilder && (
                            <button
                                type="button"
                                onClick={onDashboardClick}
                                className="text-sm font-medium text-charcoal-500 hover:text-brand-600 transition-colors px-3 py-1 rounded-md hover:bg-charcoal-50 bg-charcoal-50"
                            >
                                {t('navbar.exitBuilder')}
                            </button>
                        )}
                    </div>


                    {/* Right Section - Language toggle + User Menu */}
                    <div className="hidden md:flex items-center gap-3">
                        {credits !== undefined && onBuyCredits && (
                            <CreditsBadge credits={credits} onBuy={onBuyCredits} />
                        )}
                        <LanguageToggle />

                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal-50 border border-charcoal-200">
                            <div className="w-6 h-6 bg-accent-50 rounded-full flex items-center justify-center">
                                <User size={14} className="text-accent-600" />
                            </div>
                            <span className="text-sm font-medium text-brand-600 max-w-[150px] truncate">
                                {user?.user_metadata?.full_name || user?.email}
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={() => signOut()}
                            className="p-2 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                            title={t('navbar.signOutTooltip')}
                        >
                            <LogOut size={20} />
                        </button>
                    </div>

                    {/* Mobile: credits pill + language toggle stay visible, then hamburger */}
                    <div className="flex items-center gap-2 md:hidden">
                        {credits !== undefined && onBuyCredits && (
                            <CreditsBadge credits={credits} onBuy={onBuyCredits} />
                        )}
                        <LanguageToggle variant="compact" />
                        <button
                            type="button"
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="inline-flex items-center justify-center p-2 rounded-md text-charcoal-400 hover:text-charcoal-500 hover:bg-charcoal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                        >
                            <Menu size={24} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Menu */}
            {isMenuOpen && (
                <div className="md:hidden border-t border-charcoal-200">
                    <div className="pt-2 pb-3 space-y-1 px-4">
                        {showExitBuilder && (
                            <button
                                type="button"
                                onClick={onDashboardClick}
                                className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-charcoal-700 hover:text-charcoal-900 hover:bg-charcoal-50"
                            >
                                {t('navbar.exitBuilder')}
                            </button>
                        )}
                        <div className="px-3 py-3 border-t border-charcoal-100 mt-2">
                            <p className="text-sm font-medium text-charcoal-500">{t('navbar.signedInAs')}</p>
                            <p className="text-sm font-bold text-charcoal-900 truncate">{user?.email}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => signOut()}
                            className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-red-50"
                        >
                            {t('navbar.signOut')}
                        </button>
                    </div>
                </div>
            )}
        </nav>
    );
};
