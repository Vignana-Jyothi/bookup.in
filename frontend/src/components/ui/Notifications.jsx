import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Notifications.css';

const TITLES = { info: 'Information', warning: 'Warning', success: 'Success', alert: 'Attention' };
const variantName = value => Object.hasOwn(TITLES, value) ? value : 'info';

export function NotificationIcon({ variant = 'info' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {variant === 'alert' ? <><path d="m10.3 3.8-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.2l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v5m0 3h.01" /></> : <><circle cx="12" cy="12" r="9" />{variant === 'success' ? <path d="m7 12 3 3 7-7" /> : variant === 'warning' ? <path d="M12 7v6m0 4h.01" /> : <path d="M12 11v6m0-10h.01" />}</>}
  </svg>;
}

function CloseButton({ onClick, label = 'Dismiss notification', disabled }) {
  return <button type="button" className="pn-close" aria-label={label} onClick={onClick} disabled={disabled}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>;
}

/** Static popup card; use NotificationDialog for a modal with focus management. */
export function NotificationCard({ variant = 'info', title, message, confirmLabel = 'Got it', cancelLabel, onConfirm, onCancel, onDismiss, pending = false, children, className = '' }) {
  const kind = variantName(variant);
  return <article className={`pn-card pn-${kind} ${className}`} aria-label={title || TITLES[kind]}>
    <div className="pn-card-band">{onDismiss && <CloseButton onClick={onDismiss} disabled={pending} />}</div>
    <span className="pn-card-icon"><NotificationIcon variant={kind} /></span>
    <div className="pn-card-content"><h2>{title || TITLES[kind]}</h2><p>{message}</p>{children}</div>
    <div className="pn-card-actions">{cancelLabel && <button type="button" className="pn-button pn-button-quiet" onClick={onCancel} disabled={pending}>{cancelLabel}</button>}{confirmLabel && <button type="button" className="pn-button pn-button-accent" onClick={onConfirm} disabled={pending}>{pending ? 'Please wait…' : confirmLabel}</button>}</div>
  </article>;
}

export function NotificationDialog({ open, onClose, onConfirm, ...props }) {
  const dialog = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (!open) return undefined;
    setError('');
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  const close = () => { if (!pendingRef.current) onClose?.(); };
  const confirm = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError('');
    try { await onConfirm?.(); onClose?.(); }
    catch (failure) { setError(failure?.message || 'Could not complete this action. Please try again.'); }
    finally { pendingRef.current = false; setPending(false); }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(<dialog ref={dialog} className="pn-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target !== dialog.current) return;
    const bounds = dialog.current.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }}>
    <span id={titleId} className="pn-sr-only">{props.title || TITLES[variantName(props.variant)]}</span><span id={descriptionId} className="pn-sr-only">{props.message}</span>
    <NotificationCard {...props} pending={pending} onConfirm={confirm} onCancel={close} onDismiss={close}>{props.children}{error && <p className="pn-inline-error" role="alert">{error}</p>}</NotificationCard>
  </dialog>, document.body);
}

/** Toast timer pauses on pointer hover, keyboard focus, and hidden browser tabs. */
export function ToastNotification({ variant = 'info', title, message, duration = 0, onDismiss, announce = true }) {
  const kind = variantName(variant);
  const [remaining, setRemaining] = useState(duration);
  const remainingTime = useRef(duration);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => { remainingTime.current = duration; setRemaining(duration); }, [duration]);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (duration <= 0 || hovered || focused || hidden) return undefined;
    const started = performance.now();
    const timer = setInterval(() => {
      const left = Math.max(0, remainingTime.current - (performance.now() - started));
      if (left === 0) { clearInterval(timer); dismiss.current?.(); }
      setRemaining(left);
    }, 50);
    return () => {
      clearInterval(timer);
      remainingTime.current = Math.max(0, remainingTime.current - (performance.now() - started));
    };
  }, [duration, hovered, focused, hidden]);
  return <article className={`pn-toast pn-${kind}`} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="pn-toast-band"><span><NotificationIcon variant={kind} /></span></div>
    <div className="pn-toast-content" role={announce ? (kind === 'alert' ? 'alert' : 'status') : undefined} aria-atomic={announce ? true : undefined}><h3>{title || TITLES[kind]}</h3><p>{message}</p></div>
    {onDismiss && <CloseButton onClick={onDismiss} />}
    {duration > 0 && <div className="pn-toast-timer" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, remaining / duration)})` }} /></div>}
  </article>;
}

