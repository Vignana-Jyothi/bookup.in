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
import './SubscriptionReceipt.css';

const currencyFormatter = currency => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: currency || 'INR',
  minimumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

function money(value, currency) {
  return currencyFormatter(currency).format((Number(value) || 0) / 100);
}

function billingAddress(snapshot = {}) {
  return [
    snapshot.addressLine1,
    snapshot.addressLine2,
    snapshot.city,
    snapshot.state,
    snapshot.postalCode,
  ].filter(Boolean).join(', ');
}

export default function SubscriptionReceipt({ receipt }) {
  const [stage, setStage] = useState('printing');

  useEffect(() => {
    const timer = window.setTimeout(() => setStage('complete'), 1850);
    return () => window.clearTimeout(timer);
  }, [receipt.id]);

  const details = useMemo(() => {
    const isCreditNote = receipt.type === 'credit_note';
    return {
      isCreditNote,
      issued: dateFormatter.format(new Date(receipt.issuedAt)),
      paid: receipt.paidAt ? dateFormatter.format(new Date(receipt.paidAt)) : null,
      total: money(receipt.totalAmountPaise ?? receipt.amountPaise, receipt.currency),
      base: money(receipt.baseAmountPaise, receipt.currency),
      tax: money(receipt.taxAmountPaise, receipt.currency),
      address: billingAddress(receipt.billingSnapshot),
    };
  }, [receipt]);

  return (
    <div className="subscription-receipt-print-area">
      <ReceiptPrinter stage={stage} aria-label="Subscription receipt printer">
        <ReceiptPrinterMachine>
          <ReceiptPrinterScreen>
            <ReceiptPrinterStatus label={stage === 'complete' ? 'Receipt ready' : 'Printing subscription receipt'} />
          </ReceiptPrinterScreen>
        </ReceiptPrinterMachine>
        <ReceiptPrinterOutput tabIndex={0} aria-label="Scrollable subscription receipt">
          <ReceiptPrinterPaper>
            <header className="subscription-receipt__header">
              <span className="subscription-receipt__brand">calup.</span>
              <span className={`subscription-receipt__status ${details.isCreditNote ? 'is-credit' : ''}`}>
                {details.isCreditNote ? 'CREDIT NOTE' : 'PAID'}
              </span>
            </header>

            <div className="subscription-receipt__title">
              <p>{details.isCreditNote ? 'SUBSCRIPTION CREDIT' : 'SUBSCRIPTION RECEIPT'}</p>
              <strong>{receipt.planSnapshot?.name || 'Calup access'}</strong>
              {receipt.planSnapshot?.durationDays && <span>{receipt.planSnapshot.durationDays} days of access</span>}
              {receipt.isTest && <span className="subscription-receipt__sandbox">SANDBOX</span>}
            </div>

            <dl className="subscription-receipt__details">
              <div><dt>{details.isCreditNote ? 'Credit note' : 'Invoice'}</dt><dd>{receipt.number}</dd></div>
              <div><dt>Issued</dt><dd>{details.issued}</dd></div>
              {details.paid && <div><dt>Paid</dt><dd>{details.paid}</dd></div>}
              {receipt.billingSnapshot?.legalName && <div><dt>Billed to</dt><dd>{receipt.billingSnapshot.legalName}</dd></div>}
              {details.address && <div><dt>Address</dt><dd>{details.address}</dd></div>}
              {receipt.billingSnapshot?.gstin && <div><dt>GSTIN</dt><dd>{receipt.billingSnapshot.gstin}</dd></div>}
            </dl>

            {!details.isCreditNote && (
              <dl className="subscription-receipt__amounts">
                <div><dt>Plan price</dt><dd>{details.base}</dd></div>
                <div><dt>Tax</dt><dd>{details.tax}</dd></div>
              </dl>
            )}

            <div className="subscription-receipt__total">
              <span>{details.isCreditNote ? 'Credit amount' : 'Amount paid'}</span>
              <strong>{details.total}</strong>
            </div>

            <dl className="subscription-receipt__references">
              {receipt.cashfreeOrderId && <div><dt>Cashfree order</dt><dd>{receipt.cashfreeOrderId}</dd></div>}
              {receipt.cashfreePaymentId && <div><dt>Payment ID</dt><dd>{receipt.cashfreePaymentId}</dd></div>}
              {receipt.subscriptionOrderId && <div><dt>Calup order</dt><dd>{receipt.subscriptionOrderId}</dd></div>}
              {details.isCreditNote && receipt.reason && <div><dt>Reason</dt><dd>{receipt.reason}</dd></div>}
            </dl>

            <footer className="subscription-receipt__footer">
              Keep this receipt for billing support.<br />Payment verified securely through Cashfree.
            </footer>
          </ReceiptPrinterPaper>
        </ReceiptPrinterOutput>
      </ReceiptPrinter>
    </div>
  );
}
