import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Native modal boundary for the existing .modal content and layout. */
export default function AccessibleModal({ label, onClose, returnFocusRef, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = returnFocusRef?.current || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [returnFocusRef]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal-overlay accessible-modal"
      aria-label={label}
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const dialog = event.currentTarget;
        const controls = [...dialog.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]')]
          .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
            !element.closest('[inert]') && element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={event => {
        event.preventDefault();
        onClose?.();
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
