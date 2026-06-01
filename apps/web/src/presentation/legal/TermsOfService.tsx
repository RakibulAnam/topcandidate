// TermsOfService — readable, brand-styled legal document.
//
// SCOPE
// =====
// This document covers the product as it exists today: a paid AI résumé /
// cover-letter / outreach toolkit, sold in Bangladeshi Taka via bKash
// "credit packs", deployed at TOP CANDIDATE's domain.
//
// MAINTENANCE
// ===========
// The legal text below is intentionally NOT i18n'd — Bangladesh courts
// require an English binding text for digital service agreements, and a
// translation that drifts is worse than no translation. If/when product
// counsel is engaged, replace the body with their drafted text and
// version-bump the `Last updated` line.

import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface Props {
  onBack: () => void;
}

const LAST_UPDATED = 'May 31, 2026';
const CONTACT_EMAIL = 'support@topcandidate.app';

export const TermsOfService: React.FC<Props> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-charcoal-50">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-charcoal-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-1.5 select-none">
            <span className="font-display text-lg font-semibold tracking-tight text-brand-700">TOP</span>
            <span className="font-display text-lg font-semibold tracking-tight text-accent-500">CANDIDATE</span>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold text-charcoal-600 hover:text-brand-700 hover:bg-charcoal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-50"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 prose prose-charcoal">
        <div className="text-[11px] uppercase tracking-[0.22em] text-charcoal-500 font-bold mb-2">Legal</div>
        <h1 className="font-display text-3xl md:text-4xl font-semibold text-brand-700 leading-tight">Terms of Service</h1>
        <p className="text-sm text-charcoal-500 mt-2">Last updated: {LAST_UPDATED}</p>

        <p className="mt-8 text-[15px] leading-relaxed text-brand-700">
          These Terms govern your use of <strong>TOP CANDIDATE</strong> ("we", "us", "the service") —
          a web application that helps you tailor a résumé, cover letter, hiring-manager outreach
          email, LinkedIn note, and interview-prep sheet to a specific job description, with the
          help of AI. By creating an account or paying for credits, you agree to be bound by these
          Terms. If you do not agree, do not use the service.
        </p>

        <Section number="1" title="Eligibility & accounts">
          <p>
            You must be at least 16 years old to create an account, and have the legal capacity
            to enter into a binding agreement under Bangladesh law (or the law of your country of
            residence, if outside Bangladesh).
          </p>
          <p>
            You are responsible for the security of your account credentials. Notify us
            immediately at <Mail /> if you believe your account has been accessed without
            authorisation. We are not liable for activity that occurs under your account before
            you notify us.
          </p>
          <p>
            You agree to provide accurate, current information about yourself — including the
            personal details you put into your résumé. Misrepresenting your identity to a
            prospective employer is your responsibility, not ours.
          </p>
        </Section>

        <Section number="2" title="Acceptable use">
          <p>You may not use the service to:</p>
          <List>
            <li>create résumés, cover letters, or outreach for anyone other than yourself, without their explicit consent;</li>
            <li>generate content containing fabricated employment history, credentials, certifications, or metrics that you cannot truthfully claim;</li>
            <li>harass, defame, or impersonate a real hiring manager, recruiter, or company;</li>
            <li>attempt to bypass, probe, or compromise the security of the service (including the AI provider integrations, the payment flow, or the operator-only admin surface);</li>
            <li>scrape, mirror, or resell our generated content as part of a competing résumé service;</li>
            <li>upload content that infringes another party's intellectual property, contains malware, or violates Bangladesh's <em>Digital Security Act, 2018</em> or analogous legislation in your jurisdiction.</li>
          </List>
          <p>
            We may, at our sole discretion and without prior notice, suspend or terminate any
            account that we reasonably believe is engaged in the above conduct. See §7 for the
            termination policy.
          </p>
        </Section>

        <Section number="3" title="AI-generated content">
          <p>
            The service generates text by sending the information you provide (your career history,
            target job description, and related fields) to third-party large language models —
            currently <strong>Groq</strong> (Llama family) and <strong>Google Gemini</strong>. We do
            not train these models on your data, and our prompts ask the providers to treat the
            interaction as ephemeral, but their privacy policies and retention rules apply on top
            of ours. By using the service you accept the providers' processing of your inputs for
            the purpose of generating your output.
          </p>
          <p>
            <strong>AI output is a draft, not a finished application.</strong> We optimize for ATS
            keyword density and tone, but we cannot guarantee accuracy, employment outcomes, or
            interview success. You are responsible for reviewing every piece of generated content
            before sending it to an employer.
          </p>
          <p>
            We make a best effort to refuse fabricated claims (vendor tools you don't know,
            employers you haven't worked at, certifications you don't hold) — but the underlying
            models are stochastic and edge cases may slip through. Treat anything the AI emits as
            a starting point you must verify, not a fact.
          </p>
        </Section>

        <Section number="4" title="Payments, credits, and refunds">
          <p>
            Tailored application packages (résumé + cover letter + outreach + LinkedIn note +
            interview prep) are sold as <strong>credit packs</strong> denominated in Bangladeshi
            Taka (BDT). Credits do not expire. Each tailored generation consumes one credit. The
            free <em>General Résumé</em> path does not consume credits.
          </p>
          <p>
            Payment is collected via <strong>bKash Personal / Agent Send Money</strong> to the
            number displayed in the purchase modal. You enter your bKash Transaction ID into the
            app; our operator's payment-watcher app verifies the payment against the bKash SMS
            receipt and credits your account within a few minutes. If the watcher cannot match
            your transaction within 24 hours, the pending purchase expires and you should file a
            dispute via the in-app banner.
          </p>
          <p>
            <strong>Refunds:</strong> all credit purchases are final. We will issue a refund only
            in the following cases:
          </p>
          <List>
            <li>The system received your payment but failed to grant the credits, and we cannot resolve the discrepancy within 7 days of your dispute.</li>
            <li>The bKash transaction was reversed by bKash, in which case your credits are
              decremented to reflect the reversal (this may result in a negative balance until
              you pay a new transaction).</li>
            <li>Operator-discretion goodwill refunds, granted case-by-case and not as a right.</li>
          </List>
          <p>
            Refunds, when issued, are processed via bKash to the sender number, less any bKash
            transfer fees borne by us. We are not responsible for bKash's processing time.
          </p>
          <p>
            We reserve the right to change credit-pack pricing at any time. Pricing changes apply
            to new purchases only; credits you've already bought retain their generation count.
          </p>
        </Section>

        <Section number="5" title="Intellectual property">
          <p>
            <strong>Your data, your output.</strong> You retain ownership of the personal information
            you provide and of the final generated résumé / cover letter / outreach package, to the
            extent that ownership is granted by the underlying AI provider's terms (Groq and Google
            both grant generation output to the calling user). You grant us a limited, non-exclusive
            licence to store, process, and display this content as needed to operate the service.
          </p>
          <p>
            <strong>Our brand, our code.</strong> The TOP CANDIDATE name, wordmark, UI design,
            ATS optimization prompts, fit-mode dispatch logic, and fabrication dictionaries are
            our intellectual property. You may not copy, redistribute, or sublicence them.
          </p>
          <p>
            <strong>Templates.</strong> Our four résumé templates ("ats-classic", "ats-modern",
            "ats-serif", "ats-compact") are provided for you to use in your own job search. You
            may not redistribute the templates as part of a competing résumé service.
          </p>
        </Section>

        <Section number="6" title="Privacy">
          <p>
            Personal data you provide (name, email, phone, career history, target job descriptions)
            is stored in our database (Supabase / PostgreSQL, hosted by Supabase in their default
            region). Access is gated by row-level security so that only your authenticated session
            can read or modify your own rows. Operator access is logged in an append-only audit
            trail.
          </p>
          <p>
            We share your résumé inputs with the AI provider that generates your output, as
            described in §3. We share your bKash transaction ID with no third party; it stays
            inside the purchase confirmation flow between our server and the operator's
            payment-watcher app.
          </p>
          <p>
            You may request deletion of your account at any time from the Profile page. Deletion
            removes your profile, generated résumés, and audit trail entries scoped to you, in
            accordance with Bangladesh's <em>Personal Data Protection Act</em> when in force, and
            our reasonable record-keeping obligations.
          </p>
        </Section>

        <Section number="7" title="Suspension & termination">
          <p>
            You may delete your account at any time. We may suspend or terminate your account
            without prior notice if we reasonably believe you have violated these Terms,
            attempted to defraud the payment flow, or used the service in a way that creates a
            security or reputational risk for us or other users.
          </p>
          <p>
            On termination: your access ends immediately, your credit balance is forfeited (no
            refund), your data is retained for up to 90 days for dispute-resolution purposes and
            then deleted, and any disputes you've filed remain in our audit log permanently.
          </p>
        </Section>

        <Section number="8" title="Disclaimer of warranties">
          <p>
            The service is provided <strong>"as is"</strong> and <strong>"as available"</strong>,
            without warranty of any kind. We do not warrant that the service will be uninterrupted,
            error-free, or free of security vulnerabilities. We do not warrant that AI-generated
            output will result in interview invitations or job offers.
          </p>
          <p>
            Third-party providers (Supabase, Vercel, Google, Groq, bKash) operate their own
            services under their own terms; outages or policy changes on their end may affect the
            service, and we are not liable for those.
          </p>
        </Section>

        <Section number="9" title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, our total aggregate liability to you for any
            claim arising out of or related to the service — whether in contract, tort, or
            otherwise — is limited to the greater of (a) the amount you paid us in credit-pack
            purchases in the 12 months preceding the claim, or (b) BDT 1,000.
          </p>
          <p>
            We are not liable for indirect, incidental, special, or consequential damages,
            including lost employment opportunities, lost wages, or damage to your professional
            reputation, even if we have been advised of the possibility of such damages.
          </p>
        </Section>

        <Section number="10" title="Governing law">
          <p>
            These Terms are governed by the laws of the People's Republic of Bangladesh.
            Disputes will be heard exclusively in the courts of Dhaka, Bangladesh. If you reside
            outside Bangladesh and your local law grants you additional consumer protections, you
            retain those protections in addition to these Terms.
          </p>
        </Section>

        <Section number="11" title="Changes to these Terms">
          <p>
            We may revise these Terms from time to time. Material changes will be surfaced
            in-app on next sign-in. The <em>Last updated</em> date at the top of this page always
            reflects the current version. Continued use of the service after a revision
            constitutes acceptance of the new Terms.
          </p>
        </Section>

        <Section number="12" title="Contact">
          <p>
            Questions about these Terms, requests for data access or deletion, or disputes about
            credits or payments: <Mail />.
          </p>
        </Section>

        <div className="mt-12 pt-8 border-t border-charcoal-200 text-[12px] text-charcoal-500 text-center">
          © {new Date().getFullYear()} TOP CANDIDATE · Dhaka, Bangladesh
        </div>
      </main>
    </div>
  );
};

const Section: React.FC<{ number: string; title: string; children: React.ReactNode }> = ({ number, title, children }) => (
  <section className="mt-10">
    <h2 className="font-display text-xl font-semibold text-brand-700 flex items-baseline gap-3">
      <span className="text-accent-500 font-mono text-base">{number}.</span>
      {title}
    </h2>
    <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-brand-700">{children}</div>
  </section>
);

const List: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="list-disc pl-6 space-y-2 marker:text-accent-500">{children}</ul>
);

const Mail: React.FC = () => (
  <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono text-brand-700 hover:text-accent-600 underline underline-offset-2">
    {CONTACT_EMAIL}
  </a>
);
