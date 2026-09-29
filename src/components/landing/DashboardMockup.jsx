import React from 'react';

export default function DashboardMockup() {
  return (
    <div className="laptop-mockup-frame">
      <div className="laptop-screen">
        {/* Browser Chrome Header */}
        <div className="laptop-chrome">
          <div className="chrome-dots">
            <span className="dot dot-red" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <div className="chrome-address">
            <span style={{ opacity: 0.6 }}>🔒</span> calup.in/dashboard
          </div>
        </div>

        {/* Dashboard Viewport */}
        <div className="dash-content">
          {/* Top Bar */}
          <div className="dash-topbar">
            <div className="dash-topbar-left">
              <div className="dash-logo-sm">
                <span className="dash-logo-symbol">⚡</span>
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
              <span className="appt-view-all">Synced to Google Meet ✓</span>
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
      </div>
      <div className="laptop-base" />
    </div>
  );
}
