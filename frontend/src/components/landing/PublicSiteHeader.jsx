import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo';
import PillButton from '../ui/PillButton';
/* Disabled navigation enhancement (user request):
import { useStore } from '../../data/store';
*/
import useIsMobile from '../../hooks/useIsMobile';
import { LANDING_CONTENT } from '../../data/landingContent';
import '../../pages/Landing.css';

export default function PublicSiteHeader() {
  const isMobile = useIsMobile();
/* Disabled navigation enhancement (user request):
  const { state } = useStore();
*/
/* Disabled navigation enhancement (user request):
  const workspaceLink = state.auth.isAuthenticated && <Link to="/dashboard">{state.onboarding?.completed ? 'Dashboard' : 'Resume setup'}</Link>;
*/
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { nav } = LANDING_CONTENT;
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  return isMobile ? (<>
      <header className="mobile-nav-header">
        <BrandLogo size="md" />

        <div className="mobile-nav-actions">
          <Link to="/subscriptions" className="mobile-login-link mobile-subscriptions-link">Subscriptions</Link>
          <Link to="/login" className="mobile-login-link mobile-header-login">
            {nav.login}
          </Link>
          <button
            type="button"
            className="mobile-hamburger-btn"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
          </button>
        </div>
      </header>

      {/* ---------------- MOBILE HAMBURGER DRAWER ---------------- */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-overlay animate-fade-in-up" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-drawer-content" onClick={e => e.stopPropagation()}>
            <nav className="mobile-drawer-links">
{/* Disabled navigation enhancement (user request):
              <Link to="/booking-status" className="mobile-drawer-link" onClick={() => setMobileMenuOpen(false)}>Track booking</Link>
*/}
              <Link to="/subscriptions" className="mobile-drawer-link" onClick={() => setMobileMenuOpen(false)}>Subscriptions</Link>
              {nav.links.map(l => (
                <Link key={l.href} to={`/${l.href}`}
                  className="mobile-drawer-link"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            <div className="mobile-drawer-ctas">
{/* Disabled navigation enhancement (user request):
              {workspaceLink && <div onClick={() => setMobileMenuOpen(false)}>{workspaceLink}</div>}
*/}
              <Link
                to="/login"
                className="btn btn-secondary mobile-tap-target"
                onClick={() => setMobileMenuOpen(false)}
              >
                Log In
              </Link>
              <PillButton
                variant="primary"
                size="lg"
                arrow
                className="mobile-tap-target"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate('/signup');
                }}
              >
                {nav.cta}
              </PillButton>
            </div>
          </div>
        </div>
      )}


  </>) : (<div className="landing-desktop public-site-header">
      <header className={`landing-nav-wrap ${isScrolled ? 'is-scrolled' : ''}`}>
        <div className="landing-nav">
          <BrandLogo size="md" />

          <nav className="landing-nav-links">
{/* Disabled navigation enhancement (user request):
            <Link to="/booking-status">Track booking</Link>
*/}
            <Link to="/subscriptions" aria-current={pathname === '/subscriptions' ? 'page' : undefined}>Subscriptions</Link>
            {nav.links.map((link) => (
              <Link key={link.href} to={`/${link.href}`}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="landing-nav-actions">
{/* Disabled navigation enhancement (user request):
            {workspaceLink}
*/}
            <Link to="/login" className="btn btn-ghost" style={{ fontWeight: 600, fontSize: '14px' }}>
              {nav.login}
            </Link>
            <PillButton
              variant="primary"
              size="sm"
              arrow
              onClick={() => navigate('/signup')}
            >
              {nav.cta}
            </PillButton>
          </div>
        </div>
      </header>
  </div>);
}
