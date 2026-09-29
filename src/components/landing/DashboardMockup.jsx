import React, { useState } from 'react';
import { Lock, Zap, Check } from 'lucide-react';

export default function DashboardMockup({ imageSrc = '/assets/coach-dashboard-preview.png' }) {
  const [imageError, setImageError] = useState(false);

  return (
    <div className="laptop-mockup-frame dashboard-browser-frame">
      <div className="laptop-screen">
        {/* Browser Chrome Header */}
        <div className="laptop-chrome">
          <div className="chrome-dots">
            <span className="dot dot-red" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <div className="chrome-address">
            <Lock size={11} strokeWidth={2} style={{ marginRight: 4, verticalAlign: 'middle', opacity: 0.7 }} />
            <span>calup.in/dashboard</span>
          </div>
        </div>

        {/* Real Screenshot with Fallback to Crisp SVG/HTML Mockup */}
        {!imageError && imageSrc ? (
          <div className="dash-screenshot-container" style={{ position: 'relative' }}>
            <img
              src={imageSrc}
              alt="Calup Coach Dashboard"
              className="dash-screenshot-img"
              onError={() => setImageError(true)}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>
        ) : null}

        {/* Dashboard Viewport (renders when no image screenshot or fallback) */}
        {imageError && (
          <div className="dash-content">
            {/* Top Bar */}
            <div className="dash-topbar">
              <div className="dash-topbar-left">
                <div className="dash-logo-sm">
                  <span className="dash-logo-symbol" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <Zap size={14} strokeWidth={2.5} fill="#D4F933" />
                  </span>
                  <span className="dash-logo-brand">CalUp</span>
                </div>
                <div className="dash-nav-items">
                  <span className="dash-nav-active">Overview</span>
                  <span>Appointments</span>
                  <span>Services</span>
                  <span>Availability</span>
                </div>
              </div>
              <div className="dash-avatar-badge">AP</div>
            </div>

            {/* Quick Metrics */}
            <div className="dash-stats-row">
              <div className="dash-stat-card">
                <div className="dash-stat-label">Confirmed Sessions</div>
                <div className="dash-stat-number">18</div>
                <div className="dash-stat-change positive">100% direct UPI</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-stat-label">Active Clients</div>
                <div className="dash-stat-number">14</div>
                <div className="dash-stat-change positive">No login needed</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-stat-label">Platform Commission</div>
                <div className="dash-stat-number" style={{ color: 'var(--color-lime-hover, #B3E323)' }}>0%</div>
                <div className="dash-stat-change positive">Direct to bank</div>
              </div>
            </div>

            {/* Upcoming Schedule Table */}
            <div className="dash-appointments">
              <div className="appt-header">
                <span className="appt-title">Today's Schedule</span>
                <span className="appt-view-all" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span>Synced to Google Meet</span>
                  <Check size={12} strokeWidth={2.5} style={{ color: '#16A34A' }} />
                </span>
              </div>
              <div className="appt-table">
                <div className="appt-row">
                  <span className="appt-time">10:00 AM</span>
                  <span className="appt-service">1-on-1 Coaching</span>
                  <span className="appt-client">Aarav Sharma</span>
                  <span className="appt-status confirmed">Confirmed · Paid</span>
                </div>
                <div className="appt-row">
                  <span className="appt-time">11:30 AM</span>
                  <span className="appt-service">Strategy Session</span>
                  <span className="appt-client">Priya Mehta</span>
                  <span className="appt-status confirmed">Confirmed · Paid</span>
                </div>
                <div className="appt-row">
                  <span className="appt-time">02:30 PM</span>
                  <span className="appt-service">Consultation</span>
                  <span className="appt-client">Rohan Verma</span>
                  <span className="appt-status pending">Verification Pending</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="laptop-base" />
    </div>
  );
}
