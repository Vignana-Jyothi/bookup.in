export function safeRecoveryPath(path) {
  return path === '/payment-status' || path === '/dashboard/subscription'
    || /^\/book\/[A-Za-z0-9._~-]+\/(marketplace|memberships)$/.test(path || '')
    ? path : '/payment-status';
}

// Reloading disposes the stalled SDK without inferring an unpaid order.
export function installCheckoutRecovery(path) {
  let panel;
  const timer = setTimeout(() => {
    panel = document.createElement('aside');
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-label', 'Payment checkout help');
    Object.assign(panel.style, {
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', width: 'min(440px, calc(100vw - 32px))',
      boxSizing: 'border-box', padding: '20px', borderRadius: '16px',
      background: '#fff', color: '#171a14', border: '1px solid #d8ddd1',
      boxShadow: '0 8px 32px #0003', font: '14px/1.5 var(--font-body, sans-serif)',
    });
    const message = document.createElement('p');
    message.textContent = 'Payment not moving? Check for a blocked bank window. In sandbox, use Cashfree test details. If you have already paid, check the status before retrying.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Check payment status';
    Object.assign(button.style, {
      background: '#182110', color: '#fff', padding: '12px 16px',
      border: '0', borderRadius: '8px', cursor: 'pointer', font: 'inherit',
    });
    button.addEventListener('click', () => window.location.assign(safeRecoveryPath(path)));
    panel.append(message, button);
    document.body.appendChild(panel);
  }, 60000);
  return () => {
    clearTimeout(timer);
    panel?.remove();
  };
}
