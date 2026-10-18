import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './TicketDetailDialog.css';

export default function TicketDetailDialog({ children, onClose }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(<dialog ref={dialog} className="calup-ticket-detail-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="calup-ticket-detail-header"><h2 id={titleId}>Ticket details</h2><button type="button" aria-label="Close ticket details" onClick={onClose}><X size={22} /></button></header>
    <div className="calup-ticket-detail-body support-panel">{children}</div>
  </dialog>, document.body);
}
