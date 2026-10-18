import { useEffect, useMemo, useState } from 'react';
import {
  ReceiptPrinter,
  ReceiptPrinterMachine,
  ReceiptPrinterOutput,
  ReceiptPrinterPaper,
  ReceiptPrinterScreen,
  ReceiptPrinterStatus,
} from './index.js';
import './ReceiptPrinter.css';
import './BookingReceipt.css';

const dateFormatter = (timezone) => new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: timezone,
});

const timeFormatter = (timezone) => new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: timezone,
});

const currencyFormatter = (currency) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: currency || 'INR',
  minimumFractionDigits: 2,
});

export default function BookingReceipt({ receipt }) {
  const [stage, setStage] = useState('printing');

  useEffect(() => {
    const timer = window.setTimeout(() => setStage('complete'), 1850);
    return () => window.clearTimeout(timer);
  }, [receipt.bookingId]);

  const formatted = useMemo(() => {
    const timezone = receipt.timezone || 'Asia/Kolkata';
    return {
      date: dateFormatter(timezone).format(new Date(receipt.startsAt)),
      start: timeFormatter(timezone).format(new Date(receipt.startsAt)),
      end: timeFormatter(timezone).format(new Date(receipt.endsAt)),
      paid: receipt.paidAt ? dateFormatter(timezone).format(new Date(receipt.paidAt)) : 'Confirmed',
      amount: currencyFormatter(receipt.currency).format((Number(receipt.amountPaise) || 0) / 100),
    };
  }, [receipt]);

  return (
    <div className="booking-receipt-print-area">
      <ReceiptPrinter stage={stage} aria-label="Booking receipt printer">
        <ReceiptPrinterMachine>
          <ReceiptPrinterScreen>
            <ReceiptPrinterStatus label={stage === 'complete' ? 'Receipt ready' : 'Printing booking receipt'} />
          </ReceiptPrinterScreen>
        </ReceiptPrinterMachine>
        <ReceiptPrinterOutput tabIndex={0} aria-label="Scrollable booking receipt">
          <ReceiptPrinterPaper>
            <header className="booking-receipt__header">
              <span className="booking-receipt__brand">calup.</span>
              <span className="booking-receipt__paid">PAID</span>
            </header>

            <div className="booking-receipt__title">
              <p>BOOKING CONFIRMED</p>
              <strong>{receipt.serviceName}</strong>
              <span>{receipt.merchantName}</span>
            </div>

            <dl className="booking-receipt__details">
              <div><dt>Date</dt><dd>{formatted.date}</dd></div>
              <div><dt>Time</dt><dd>{formatted.start}–{formatted.end}</dd></div>
              <div><dt>For</dt><dd>{receipt.customerName}</dd></div>
              <div><dt>Mode</dt><dd>{receipt.meetingType === 'in-person' ? 'In person' : 'Online'}</dd></div>
            </dl>

            <div className="booking-receipt__total">
              <span>Amount paid</span>
              <strong>{formatted.amount}</strong>
            </div>

            <dl className="booking-receipt__references">
              <div><dt>Booking ID</dt><dd>{receipt.bookingId}</dd></div>
              <div><dt>Cashfree order</dt><dd>{receipt.cashfreeOrderId || 'Recorded'}</dd></div>
              {receipt.cashfreePaymentId && <div><dt>Payment ID</dt><dd>{receipt.cashfreePaymentId}</dd></div>}
              <div><dt>Paid on</dt><dd>{formatted.paid}</dd></div>
            </dl>

            <footer className="booking-receipt__footer">
              Keep this receipt for booking support.<br />Payment verified securely through Cashfree.
            </footer>
          </ReceiptPrinterPaper>
        </ReceiptPrinterOutput>
      </ReceiptPrinter>
    </div>
  );
}
