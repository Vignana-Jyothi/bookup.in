import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicSiteHeader from '../components/landing/PublicSiteHeader';
import PublicSiteFooter from '../components/landing/PublicSiteFooter';
import { LEGAL_DETAILS, LEGAL_DETAILS_PENDING, LEGAL_PAGES, LEGAL_UPDATED } from '../data/legalContent';
import './LegalPage.css';

export default function LegalPage({ slug }) {
  const { hash } = useLocation();
  const page = LEGAL_PAGES.find(item => item.slug === slug);
  useEffect(() => {
    const previous = document.title;
    document.title = `${page?.title || 'Policy'} | Calup`;
    return () => { document.title = previous; };
  }, [page]);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [slug, hash]);
  if (!page) return null;
  return (
    <div className="legal-site">
      <a className="legal-skip" href="#policy-main">Skip to policy</a>
      <PublicSiteHeader />
      <main id="policy-main" className="legal-main">
        <div className="legal-intro">
          <Link to="/">Calup home</Link>
          <p className="legal-eyebrow">POLICIES &amp; CUSTOMER INFORMATION</p>
          <h1>{page.title}</h1>
          <p>{page.summary}</p>
          <p className="legal-updated">Last updated: {LEGAL_UPDATED}</p>
        </div>
        {LEGAL_DETAILS_PENDING && slug !== 'terms-and-conditions' && (
          <aside className="legal-review-note" aria-label="Policy review status">
            Draft for review before commercial launch. Business identity and grievance contact details are still being finalised.
          </aside>
        )}
        <div className="legal-layout">
          <nav className="legal-sidebar" aria-label="Policy navigation">
            <h2>Policies and help</h2>
            {LEGAL_PAGES.map(item => <Link key={item.slug} to={`/${item.slug}`} aria-current={item.slug === slug ? 'page' : undefined}>{item.title}</Link>)}
            <h2>On this page</h2>
            {page.sections.map((section, index) => <a key={section.title} href={`#policy-section-${index + 1}`}>{section.title}</a>)}
          </nav>
          <article className="legal-document" aria-label={page.title}>
            {page.sections.map((section, index) => (
              <section key={section.title} id={`policy-section-${index + 1}`}>
                <h2>{index + 1}. {section.title}</h2>
                {section.paragraphs?.map(text => <p key={text}>{text}</p>)}
                {section.bullets && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}
              </section>
            ))}
            <div className="legal-contact">
              <h2>Need help?</h2>
              <p>Include your booking or account reference and a short description of the issue.</p>
              {LEGAL_DETAILS.supportEmail ? <a href={`mailto:${LEGAL_DETAILS.supportEmail}`}>{LEGAL_DETAILS.supportEmail}</a> : <Link to="/contact">View contact and grievance information</Link>}
            </div>
          </article>
        </div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
