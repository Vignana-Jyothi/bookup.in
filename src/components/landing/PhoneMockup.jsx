import React from 'react';

export default function PhoneMockup({ className = '', style = {} }) {
  return (
    <div className={`phone-mockup-wrapper ${className}`} style={style}>
      <div className="phone-mockup-frame">
        <div className="phone-notch" />
        <div className="phone-url-bar">
          <span className="phone-url-lock">🔒</span> calup.in/book/arjun-patel
        </div>
        <div className="phone-screen-content">
          {/* Coach Header */}
          <div className="phone-coach-bar">
            <div className="phone-avatar-bubble">
              <span>AP</span>
            </div>
            <div className="phone-coach-meta">
              <div className="phone-coach-name">
                Dr. Arjun Patel <span className="phone-verified-tick" title="Verified coach">✓</span>
              </div>
              <div className="phone-coach-tag">Executive & Performance Coach</div>
            </div>
          </div>

          {/* Select Service */}
          <div className="phone-mini-section">
            <div className="phone-mini-title">Select Service</div>
            <div className="phone-service-item selected">
              <div className="phone-radio active" />
              <div className="phone-service-details">
                <span className="phone-service-title">1-on-1 Strategy Session</span>
                <span className="phone-service-pricing">60 min · ₹1,500</span>
              </div>
              <span className="phone-item-star">★</span>
            </div>
            <div className="phone-service-item">
              <div className="phone-radio" />
              <div className="phone-service-details">
                <span className="phone-service-title">Quick Advisory Call</span>
                <span className="phone-service-pricing">30 min · ₹800</span>
              </div>
            </div>
          </div>

          {/* Calendar Picker */}
          <div className="phone-mini-section">
            <div className="phone-mini-title">Select Date</div>
            <div className="phone-mini-calendar">
              <div className="phone-cal-header">October 2026</div>
              <div className="phone-cal-weekdays">
                <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
              </div>
              <div className="phone-cal-dates">
                <span className="phone-cal-d">12</span>
                <span className="phone-cal-d">13</span>
                <span className="phone-cal-d active">14</span>
                <span className="phone-cal-d">15</span>
                <span className="phone-cal-d">16</span>
                <span className="phone-cal-d">17</span>
                <span className="phone-cal-d off">18</span>
              </div>
            </div>
          </div>

          {/* Time Slots */}
          <div className="phone-mini-section">
            <div className="phone-mini-title">Available Slots (IST)</div>
            <div className="phone-slot-pills">
              <span className="phone-slot-pill">10:00 AM</span>
              <span className="phone-slot-pill selected">11:30 AM</span>
              <span className="phone-slot-pill">02:30 PM</span>
            </div>
          </div>

          {/* Direct UPI Callout */}
          <div className="phone-upi-badge">
            <span>⚡ Pay directly on UPI</span>
            <span className="phone-upi-zero">0% fee</span>
          </div>

          {/* Confirm Button */}
          <button type="button" className="phone-action-btn" tabIndex="-1">
            Book & Pay ₹1,500 →
          </button>
        </div>
      </div>
    </div>
  );
}
