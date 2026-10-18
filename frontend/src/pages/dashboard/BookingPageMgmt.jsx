/**
 * CalUp — Booking Page Management
 */

import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from '../../data/store';
import { getBookingUrl } from '../../utils/url';
import PillButton from '../../components/ui/PillButton';
import { CalendarRange, LockKeyhole, ShoppingBag } from 'lucide-react';
import './BookingPageMgmt.css';
import CommerceManager from '../../components/dashboard/CommerceManager.jsx';

export default function BookingPageManagement() {
  const { state, addToast } = useStore();
  const navigate = useNavigate();
  const provider = state.provider;
  const [commerce,setCommerce] = useState(null);
  const slug = provider?.slug || 'my-page';
  const bookingUrl = getBookingUrl(slug);

  const copyLink = () => {
    navigator.clipboard?.writeText(bookingUrl).catch(() => {});
    addToast('Booking link copied! ');
  };

  const shareWhatsApp = () => {
    const pitch = `Hi! You can now book time with me directly without any back-and-forth. Pick a service and your preferred time slot here: ${bookingUrl}`;
    const text = encodeURIComponent(pitch);
    window.open(`https://wa.me/?text=${text}`, '_blank');
    addToast('Opening WhatsApp with pre-filled booking link! ');
  };

  const activeServices = (state.services || []).filter(s => s.isActive);
  const hasActiveServices = activeServices.length > 0;

  // Shared disabled-button style when no active services
  const disabledBtnStyle = {
    opacity: 0.45,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  };

  return (
    <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* No-services warning banner */}
      {!hasActiveServices && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: 'var(--radius-card)',
            background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
            border: '1px solid #F59E0B',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.15)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <span style={{ fontSize: '1.4rem', flexShrink: 0 }}></span>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '14px', color: '#92400E', marginBottom: '2px' }}>
                Sharing disabled — no active services
              </div>
              <div style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.4 }}>
                Add at least one service before sharing your booking link. Without services, clients see an empty page.
              </div>
            </div>
          </div>
          <PillButton variant="primary" size="sm" onClick={() => navigate('/dashboard/services')}>
            + Add a Service
          </PillButton>
        </div>
      )}

      {/* Link Section Card */}
      <div
        className="card"
        style={{
          borderRadius: 'var(--radius-card)',
          background: 'var(--theme-bg-card)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-card)',
          padding: '24px 28px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <span style={{ fontSize: '11px', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              Your Booking Link
            </span>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginTop: '8px',
              padding: '12px 18px',
              background: 'var(--theme-bg-card-subtle)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--theme-border)',
              flexWrap: 'wrap',
            }}>
              <span style={{
                fontFamily: 'var(--font-family-mono)',
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--color-text)',
                wordBreak: 'break-all',
                ...(!hasActiveServices ? { opacity: 0.5 } : {}),
              }}>
                {bookingUrl}
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={!hasActiveServices ? disabledBtnStyle : {}}>
                  <PillButton variant="primary" size="sm" onClick={hasActiveServices ? copyLink : undefined}>
                     Copy Link
                  </PillButton>
                </span>
                {hasActiveServices ? (
                  <a
                    href={bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <PillButton variant="secondary" size="sm">
                       Open Page
                    </PillButton>
                  </a>
                ) : (
                  <span style={disabledBtnStyle}>
                    <PillButton variant="secondary" size="sm">
                       Open Page
                    </PillButton>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', paddingTop: '6px' }}>
            <button
              type="button"
              onClick={hasActiveServices ? shareWhatsApp : undefined}
              disabled={!hasActiveServices}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: 'var(--radius-pill)',
                background: '#25D366',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: hasActiveServices ? 'pointer' : 'not-allowed',
                transition: 'transform var(--transition-fast)',
                ...(!hasActiveServices ? { opacity: 0.45 } : {}),
              }}
            >
              <span></span> Share to WhatsApp
            </button>
            <button
              type="button"
              onClick={hasActiveServices ? () => {
                copyLink();
                addToast('Booking link copied! Paste it in your Instagram bio ');
              } : undefined}
              disabled={!hasActiveServices}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--theme-input-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--theme-border)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: hasActiveServices ? 'pointer' : 'not-allowed',
                ...(!hasActiveServices ? { opacity: 0.45 } : {}),
              }}
            >
              <span></span> Instagram Bio Link
            </button>
          </div>
        </div>
      </div>

      <section className="booking-commerce-grid" aria-label="Marketplace and customer memberships">
        <article className="booking-commerce-card" aria-labelledby="booking-marketplace-title">
          <div className="booking-commerce-heading"><span className="booking-commerce-icon"><ShoppingBag size={24} aria-hidden="true" /></span><span className="booking-commerce-state">Merchant setup</span></div>
          <div><p className="booking-commerce-eyebrow">DIGITAL PRODUCTS</p><h2 id="booking-marketplace-title">Marketplace</h2><p className="booking-commerce-description">Give your event customers a place to buy your guides, resources and digital products.</p></div>
          <ul>
            <li>Offer a product file or a private product link.</li>
            <li>Customers enter their booking ID and phone number, then verify by SMS.</li>
            <li>Review access requests before customers can purchase.</li>
            <li>Set a purchase limit for each customer, per product.</li>
          </ul>
          <div className="booking-commerce-note"><LockKeyhole size={18} aria-hidden="true" /><p>Create a private vault to encrypt files and links in your browser. Products can be free or paid.</p></div>
          <PillButton onClick={() => setCommerce('product')} disabled={!provider?.id}>Manage products</PillButton>
          <p className="booking-commerce-footer">Guided setup, encrypted uploads and customer access requests. Purchasing and delivery are not enabled yet.</p>
        </article>
        <article className="booking-commerce-card" aria-labelledby="booking-memberships-title">
          <div className="booking-commerce-heading"><span className="booking-commerce-icon"><CalendarRange size={24} aria-hidden="true" /></span><span className="booking-commerce-state">Merchant setup</span></div>
          <div><p className="booking-commerce-eyebrow">ONGOING CUSTOMER ACCESS</p><h2 id="booking-memberships-title">Customer memberships</h2><p className="booking-commerce-description">Offer access for a set period, from a week-long programme to a monthly gym membership.</p></div>
          <ul>
            <li>Set the membership price and access duration.</li>
            <li>Track each customer’s start date, expiry and renewal status.</li>
            <li>Send a WhatsApp reminder before access expires.</li>
            <li>Customers choose whether to renew with a new payment.</li>
          </ul>
          <div className="booking-commerce-note"><CalendarRange size={18} aria-hidden="true" /><p>No automatic charges or slot reservations. These memberships are separate from your Calup subscription.</p></div>
          <PillButton onClick={() => setCommerce('membership')} disabled={!provider?.id}>Manage customer memberships</PillButton>
          <p className="booking-commerce-footer">Save membership plans now. Customer checkout, access periods and reminders are being connected.</p>
        </article>
      </section>

      {commerce && <CommerceManager key={commerce} kind={commerce} onClose={() => setCommerce(null)} />}

    </div>
  );
}
