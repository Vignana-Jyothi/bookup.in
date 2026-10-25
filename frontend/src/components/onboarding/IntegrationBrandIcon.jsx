import { Mail, MessageCircle, Smartphone, Video } from 'lucide-react';
import './IntegrationBrandIcon.css';

export default function IntegrationBrandIcon({ id, small = false }) {
  return (
    <span className={`brand-integration-icon brand-integration-icon--${id}${small ? ' is-small' : ''}`} aria-hidden="true">
      {id === 'calendar' && (
        <svg viewBox="0 0 48 48">
          <rect x="5" y="5" width="38" height="38" rx="7" fill="#4285f4" />
          <path fill="#fff" d="M12 14h24v22H12z" />
          <path fill="#34a853" d="M5 35h8v8H5z" />
          <path fill="#fbbc05" d="M35 35h8l-8 8z" />
          <path fill="#ea4335" d="M35 5h8v9h-8z" />
          <text x="24" y="30" textAnchor="middle" fontSize="18" fontFamily="Arial" fill="#4285f4">31</text>
        </svg>
      )}
      {id === 'meet' && (
        <svg viewBox="0 0 48 48">
          <path fill="#00832d" d="m30 17 13-9v32l-13-9z" />
          <path fill="#00ac47" d="M10 8h20v32H10z" />
          <path fill="#4285f4" d="M5 15 12 8v32l-7-7z" />
          <path fill="#fbbc04" d="M12 8h18v9H12z" />
          <path fill="#ea4335" d="m5 15 7-7v9H5z" />
        </svg>
      )}
      {id === 'cashfree' && <span className="brand-cashfree">cf<span>↗</span></span>}
      {id === 'whatsapp' && <MessageCircle size={small ? 20 : 27} />}
      {id === 'sms' && <Smartphone size={small ? 20 : 27} />}
      {id === 'email' && <Mail size={small ? 20 : 27} />}
      {(id === 'zoom' || id === 'webex') && <Video size={small ? 20 : 27} />}
    </span>
  );
}
