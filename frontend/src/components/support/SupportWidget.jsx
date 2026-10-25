import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';
import TicketPanel from './TicketPanel.jsx';
import './SupportWidget.css';

export default function SupportWidget({ scope, open, onOpen, onClose, initialTicketId }) {
  const dialog = useRef(null);
  const launcher = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element.open) element.showModal();
    if (!open && element.open) { element.close(); launcher.current?.focus(); }
    return () => { if (element.open) element.close(); };
  }, [open]);
  return createPortal(<div className="calup-support-widget">
    <button ref={launcher} type="button" className="calup-support-launcher" aria-label="Open support tickets" aria-haspopup="dialog" aria-expanded={open} aria-controls="calup-support-dialog" onClick={onOpen}>
      <MessageCircle size={21} aria-hidden="true" /><span>Support</span>
    </button>
    <dialog ref={dialog} id="calup-support-dialog" className="calup-support-dialog" aria-labelledby="calup-support-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="calup-support-header"><div><strong id="calup-support-title">Calup support</strong><p>Tickets and conversations</p></div><button type="button" aria-label="Close support" onClick={onClose}><X size={20} /></button></header>
      <div className="calup-support-body">{open && <TicketPanel key={`${scope}:${initialTicketId || 'inbox'}`} scope={scope} initialTicketId={initialTicketId} />}</div>
    </dialog>
  </div>, document.body);
}
