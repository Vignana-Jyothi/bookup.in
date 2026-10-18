export default function PillButton({
  children,
  variant = 'primary',
  size = 'md',
  arrow = false,
  step,
  totalSteps = 3,
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  style = {},
  href,
  target,
  rel,
  ...props
}) {
  const Component = href ? 'a' : 'button';
  const variantClass =
    variant === 'lime'
      ? 'btn-lime'
      : variant === 'secondary'
      ? 'btn-secondary'
      : variant === 'ghost'
      ? 'btn-ghost'
      : variant === 'danger'
      ? 'btn-danger'
      : 'btn-primary';

  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';

  return (
    <Component
      type={href ? undefined : type}
      href={href}
      target={target}
      rel={rel}
      disabled={href ? undefined : (disabled || loading)}
      onClick={onClick}
      className={`btn ${variantClass} ${sizeClass} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        borderRadius: 'var(--radius-pill)',
        textDecoration: 'none',
        ...style,
      }}
      {...props}
    >
      {/* 3-Dot Progress Indicator if step is provided */}
      {step && (
        <span className="progress-dots" style={{ marginRight: '4px' }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`progress-dot ${i + 1 === step ? 'active' : ''}`}
              style={{
                background:
                  variant === 'lime' || variant === 'secondary' || variant === 'ghost'
                    ? i + 1 === step
                      ? 'var(--color-black)'
                      : 'rgba(14, 14, 14, 0.25)'
                    : i + 1 === step
                    ? '#FFFFFF'
                    : 'rgba(255, 255, 255, 0.35)',
              }}
            />
          ))}
        </span>
      )}

      {loading ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Loading...
        </span>
      ) : (
        <span>{children}</span>
      )}

      {arrow && !loading && (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: 'transform 0.15s ease', display: 'inline-block', verticalAlign: 'middle' }}
          className="pill-btn-arrow"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      )}
    </Component>
  );
}
