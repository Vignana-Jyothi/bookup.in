import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo';
import useIsMobile from '../../hooks/useIsMobile';
import { LANDING_CONTENT, SUPPORT_EMAIL } from '../../data/landingContent';
import '../../pages/Landing.css';
import { LEGAL_PAGES } from '../../data/legalContent';

export default function PublicSiteFooter() {
  const isMobile = useIsMobile();
  const { footer } = LANDING_CONTENT;
  const policies = <nav className="footer-links-col public-footer-policies" aria-label="Policies and regulatory information">
    <h4>Policies</h4>
    {LEGAL_PAGES.map(page => <Link key={page.slug} to={`/${page.slug}`}>{page.title}</Link>)}
  </nav>;
  return isMobile ? (
      <footer className="mobile-footer">
        <BrandLogo size="md" light />
        <p className="mobile-footer-tagline">{footer.tagline}</p>

        <div className="mobile-footer-links">
          {footer.links.map(l => (
            <Link key={l.label} to={l.href.startsWith('#') ? `/${l.href}` : l.href} className="mobile-footer-link">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="mobile-footer-contact">
          {SUPPORT_EMAIL ? (<a href={`mailto:${SUPPORT_EMAIL}`} className="mobile-contact-email" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Mail size={14} strokeWidth={1.75} />
            <span>{SUPPORT_EMAIL}</span>
          </a>) : <Link to="/contact">Contact Calup</Link>}
        </div>

        {policies}
        <p className="mobile-copyright">
          © {new Date().getFullYear()} Calup. All rights reserved.
        </p>
      </footer>
  ) : (
    <div className="landing-desktop">
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-top-row">
            <div className="footer-brand-col">
              <BrandLogo size="lg" light />
              <p className="footer-tagline">
                {footer.tagline}
              </p>
            </div>

            <div className="footer-links-col">
              <h4>Navigation</h4>
              {footer.links.map(l => (
                <Link key={l.label} to={l.href.startsWith('#') ? `/${l.href}` : l.href}>
                  {l.label}
                </Link>
              ))}
            </div>

            {policies}

            <div className="footer-links-col">
              <h4>Contact</h4>
              {SUPPORT_EMAIL ? (<a href={`mailto:${SUPPORT_EMAIL}`} className="footer-email-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Mail size={15} strokeWidth={1.75} />
                <span>{SUPPORT_EMAIL}</span>
              </a>) : <Link to="/contact">Contact Calup</Link>}
              <div className="footer-direct-note">
                Early access support for verified coaches & tutors.
              </div>
            </div>
          </div>

          <div className="footer-bottom-row">
            <p>© {new Date().getFullYear()} Calup. All rights reserved.</p>
            <div className="footer-legal">
              <span>0% Commission Booking</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}


/* Disabled navigation enhancement (user request):
[...footer.links, { label: 'Track booking', href: '/booking-status' }].map(l => (
*/

/* Disabled navigation enhancement (user request):
[...footer.links, { label: 'Track booking', href: '/booking-status' }].map(l => (
*/
