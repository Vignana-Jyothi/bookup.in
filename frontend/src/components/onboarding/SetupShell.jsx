import BrandLogo from '../ui/BrandLogo';
import IntegrationBrandIcon from './IntegrationBrandIcon';
import './SetupShell.css';

const toolIcons = ['calendar', 'meet', 'whatsapp', 'cashfree', 'email', 'calendar', 'zoom', 'sms'];

export default function SetupShell({ step, totalSteps, title, description, headerAction, children, footer, loading = false }) {
  return (
    <div className="setup-page">
      <section className="setup-shell" aria-label="Calup account setup">
        <aside className="setup-sidebar">
          <BrandLogo size="md" />
          <div className="setup-tool-art" aria-hidden="true">
            <span className="setup-art-label">A little more connected.</span>
            <div className="setup-tool-grid">
              {toolIcons.map((tool, index) => (
                <span key={`${tool}-${index}`}><IntegrationBrandIcon id={tool} /></span>
              ))}
            </div>
          </div>
          <div className="setup-sidebar-copy">
            <span className="setup-step-number">Step {step + 1} <span>/ {String(totalSteps).padStart(2, '0')}</span></span>
            <h2>{title}</h2>
            <p>{description}</p>
            <ol className="setup-progress" aria-label="Setup progress">
              {Array.from({ length: totalSteps }, (_, index) => (
                <li key={index} className={index <= step ? 'is-complete' : ''} aria-current={index === step ? 'step' : undefined}>
                  <span className="setup-sr-only">Step {index + 1}{index < step ? ', completed' : ''}</span>
                </li>
              ))}
            </ol>
          </div>
          <span className="setup-sidebar-footer">A little setup. A lot of possibility.</span>
        </aside>

        <div className="setup-main">
          <header className="setup-main-header">
            <span>Your business starts here</span>
            {headerAction}
          </header>
          <div className="setup-content" aria-busy={loading}>
            {loading ? <div className="spinner" aria-label="Loading setup" /> : children}
          </div>
          {footer && <footer className="setup-main-footer">{footer}</footer>}
        </div>
      </section>
    </div>
  );
}
