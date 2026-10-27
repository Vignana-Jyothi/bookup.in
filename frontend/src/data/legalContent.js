import { SUPPORT_EMAIL } from './landingContent';

const env = import.meta.env || {};
export const LEGAL_DETAILS = {
  name: env.VITE_LEGAL_NAME || 'Calup',
  address: env.VITE_BUSINESS_ADDRESS || '',
  supportEmail: SUPPORT_EMAIL || 'support@calup.app',
  supportPhone: '+91 9381325063',
  grievanceName: env.VITE_GRIEVANCE_CONTACT_NAME || '',
  grievanceEmail: env.VITE_GRIEVANCE_EMAIL || SUPPORT_EMAIL || 'support@calup.app',
};
export const LEGAL_UPDATED = '16 October 2026';

export const LEGAL_PAGES = [
  {
    slug: 'terms-and-conditions', title: 'Terms and Conditions',
    summary: 'The terms for using Calup, managing a business account, and booking services with a merchant.',
    sections: [
      { title: 'Who we are', paragraphs: [
        `Calup is operated by ${LEGAL_DETAILS.name}. We provide scheduling, booking administration, payment coordination, and subscription software for service businesses in India. Merchants provide the services listed on their booking pages and are responsible for their qualifications, descriptions, delivery, and applicable licences.`,
        'These terms govern your use of Calup. A merchant’s service-specific conditions are shown before booking. Applicable consumer rights and legal remedies continue to apply.',
      ] },
      { title: 'Accounts and responsible use', bullets: [
        'Provide accurate identity, contact, and billing details; complete required verification and protect your credentials.',
        'Merchant account holders must be at least 18 and have authority to represent their business. A parent or guardian must arrange any booking that requires adult consent.',
        'Do not impersonate others, manipulate availability or payment evidence, bypass access controls, abuse support, or offer unlawful services. Calup may restrict access to investigate misuse or meet legal obligations.',
      ] },
      { title: 'Bookings and payments', paragraphs: [
        'Displayed availability is provisional until the server acquires your slot. A payment hold begins when you submit your details and continue to pay and normally lasts 15 minutes. Confirmation requires verified payment and allocation of the appointment; a gateway popup alone is not proof of confirmation.',
        'Payment collection depends on the merchant’s enabled payment arrangement and provider approvals. Calup subscription payments are separate from payments for merchant services. Sandbox transactions are tests and do not represent live collection or settlement.',
        'The final amount and applicable tax must be displayed before payment. Calup does not add a customer convenience or transaction surcharge to the merchant’s displayed service price.',
      ] },
      { title: 'Subscription access', paragraphs: [
        'The current offering is a 30-day access plan, renewed by the merchant; automatic recurring debit is not enabled. Account pricing, tax, and access dates are displayed before payment. Calup-issued access codes follow their stated expiry and conditions.',
        'A five-day grace period follows access expiry. Without renewal, the account is frozen and cannot accept new bookings. Existing obligations and retained records remain subject to the access and retention rules in our Privacy and Cancellation policies.',
      ] },
      { title: 'Availability, changes, and responsibility', paragraphs: [
        'Third-party payment, communication, and meeting providers may experience interruptions. Calup investigates reported integration failures; verified eligible disruption credits are assessed under the applicable account policy, rather than guaranteed for every outage.',
        'Merchants retain rights in their uploaded content and grant Calup permission to process it to provide the service. Calup retains rights in its software and branding. You must have permission to upload or share material belonging to others.',
        'We may update these terms prospectively and identify the revised date. Changes to a merchant’s policy do not alter the policy accepted for an existing booking. Nothing here excludes liability or remedies that cannot legally be excluded.',
      ] },
      { title: 'Disputes and applicable law', paragraphs: [
        'Contact the merchant first about service delivery, and Calup about platform or payment problems. Our Contact and Grievances page describes escalation. Calup’s internal payment decisions and merchant service decisions remain subject to consumer, banking, regulatory, and court remedies.',
        'Indian law applies, subject to mandatory protections. These terms do not restrict your right to approach a competent consumer forum or other legally available authority.',
      ] },
    ],
  },
  {
    slug: 'privacy-policy', title: 'Privacy Policy',
    summary: 'What information is used to run Calup, who receives it, and how to request help with your data.',
    sections: [
      { title: 'Information we process', bullets: [
        'Account and verification details: name, business name/type, phone, email, authentication records, and billing address or GSTIN where supplied.',
        'Booking and financial records: service, instructor, date/time, customer contact details, price, payment/refund status, provider references, receipts, and invoices.',
        'Integration information: connected Google account details and permissions, calendar availability, meeting/event metadata, and credentials needed to maintain the connection.',
        'Support information and technical records: messages, evidence you submit, device/request information, security logs, and essential session or browser-storage data.',
      ] },
      { title: 'Why we use it', paragraphs: [
        'We use information to verify access, operate bookings, reserve availability, verify payments, issue billing documents, generate meetings, send transactional updates, investigate fraud and complaints, and meet applicable legal duties. A merchant receives information necessary to deliver the service you book.',
        'Where consent is required, we request it for the relevant purpose. Contact us to withdraw optional consent or change communication preferences. Required service processing may be necessary to continue the relevant feature. Marketing, if introduced, requires its own appropriate choices.',
      ] },
      { title: 'Sharing and connected providers', paragraphs: [
        'Service providers include Supabase for authentication/database services, Cashfree for enabled payments, Google for connected Calendar/Meet functions, and configured email, WhatsApp/Meta, and SMS providers (including 2Factor for enabled OTP delivery). We share information needed for the relevant function, not unrestricted access to your account.',
        'Connected Google information is used to check availability, create or manage appointment events and meeting links, and maintain your chosen integration. We do not use Google user data for advertising. You can disconnect through settings or revoke access in your Google account; already-created events or legally required records may remain.',
        'Providers may process information outside India depending on configured regions and contracts. We may disclose necessary information to authorities when lawfully required. The merchant and external providers also have their own applicable privacy notices.',
      ] },
      { title: 'Retention and deletion', paragraphs: [
        'Account inactivity for retention purposes starts after the five-day subscription grace period ends and the account is frozen, rather than after your last login. Our operational-retention policy is 90 days from freezing; renewal within that period can restore retained operational access.',
        'After that window, operational information no longer required may be deleted or anonymised. Financial, tax, refund, dispute, fraud, and legal-hold records follow separate applicable retention duties; an account deletion request does not automatically erase them. Only the information necessary for an unresolved case needs to be preserved.',
        'Returning after operational deletion requires setup again. Financial-history restoration requires ownership verification and does not recreate deleted operational data. Contact us for a deletion request or information about the retention schedule applicable to your records.',
      ] },
      { title: 'Your requests and safety', paragraphs: [
        'Contact Calup to request access, correction, deletion where permitted, consent changes, or grievance review. We verify identity before releasing or changing records. For a merchant-controlled service record, we may coordinate with that merchant.',
        'Access controls, verification, and payment reconciliation help protect records; no service can promise absolute security. Never send passwords, OTPs, CVVs, or full card details to support. Our Cookies and Browser Storage page explains session and device storage.',
        'Calup merchant accounts are intended for adults. Do not knowingly submit a child’s personal data without the required authority and consent; contact us about any inappropriate collection.',
      ] },
    ],
  },
  {
    slug: 'refund-policy', title: 'Refund Policy',
    summary: 'How service-payment refunds differ from Calup subscription refunds.',
    sections: [
      { title: 'Merchant service payments', paragraphs: [
        'The merchant’s cancellation/refund terms shown and accepted at booking apply to that booking; later policy changes do not replace them. The booking record and verified payment result are used to assess a request. Mandatory consumer rights remain available.',
        'A merchant cancellation, merchant no-show, or a merchant-requested reschedule you reject is eligible for a full refund under the agreed service rules. Customer cancellations and attendance issues are assessed under the accepted policy; a timely request is not itself an automatic approval.',
      ] },
      { title: 'Paid but not booked, duplicate, or disputed payments', paragraphs: [
        'If a verified payment arrives after the 15-minute hold expires and your appointment cannot be fulfilled, it enters payment-resolution/refund review. If another customer has acquired the slot, their booking stays in place; your earlier payment timestamp does not give ownership of it.',
        'Report duplicate charges, suspected unauthorised payments, or an amount mismatch with the payment and booking reference. Calup verifies provider records before deciding the next step. Do not pay repeatedly while a payment is still being reconciled.',
      ] },
      { title: 'Calup subscription payments', paragraphs: [
        'Cancellation of a current subscription stops future continuation but normally leaves the paid current period active until its expiry; it does not itself create a refund of that current period. Unused future prepaid periods can be cancelled individually, subject to their eligibility and the displayed refund review.',
        'Access codes and service-credit extensions are not cash payments and cannot be refunded as money. Payment errors, duplicate subscription charges, or access-application failures should be raised with Calup for reconciliation. Statutory remedies remain unaffected.',
      ] },
      { title: 'Processing and tracking', paragraphs: [
        'Approved monetary refunds are sent through the applicable original payment arrangement wherever supported. Refund progress and the provider’s expected processing information should be checked in the relevant booking/account record; bank and provider processing can vary. A refund is not complete merely because it was requested.',
        'Calup does not deduct a platform refund fee from the customer’s eligible refund. Approved full-refund cases return the full eligible amount; other eligible amounts follow the snapshotted policy. Contact support if the stated processing time passes or no refund status is available.',
      ] },
    ],
  },
  {
    slug: 'cancellation-policy', title: 'Cancellation and Rescheduling',
    summary: 'Rules for changing appointments and cancelling current or future subscription access.',
    sections: [
      { title: 'Customer appointment changes', paragraphs: [
        'Review the merchant’s displayed policy before paying. Use verified booking-management access to request a cancellation or reschedule. A failed or abandoned checkout does not create a confirmed appointment; its unpaid temporary hold expires at the original deadline.',
        'Under the agreed rescheduling policy, a customer may reschedule at most twice, subject to availability, to a date no later than three calendar days after the appointment date being rescheduled. Merchant-requested changes do not consume the customer’s two changes. Do not assume a change is accepted until the updated booking is confirmed.',
      ] },
      { title: 'Merchant changes and attendance', paragraphs: [
        'A merchant-requested change must be communicated for your acceptance. Rejecting that proposal makes you eligible for a full refund; accepting it changes the agreed appointment. A scheduling buffer or overrun does not silently move an already-confirmed booking.',
        'Merchant no-shows are eligible for refund review. A customer no-show normally receives no refund. To have a customer cancellation/refund request assessed before the session, notify the merchant at least 15 minutes before the scheduled start; approval still depends on the accepted policy and verified facts.',
      ] },
      { title: 'Subscription cancellation', paragraphs: [
        'The current paid period normally continues until its stated expiry. You can cancel an eligible single future prepaid period without cancelling every future period. Review the access-date changes and refund information before confirming.',
        'Renewal is manual; there is no enabled automatic recurring debit to cancel. Five-day grace and frozen-account rules apply after access expiry. The Refund and Privacy policies explain payment treatment and retained records.',
      ] },
      { title: 'Unavailable controls or exceptional cases', paragraphs: [
        'If a cancellation, ticket, or rescheduling control is unavailable, contact the merchant or Calup with the booking/subscription reference and the time of your request. Preserve evidence of a timely request. This page describes the service rules and does not guarantee that every workflow is automated in the current release.',
      ] },
    ],
  },
  {
    slug: 'service-delivery-policy', title: 'Service Delivery Policy',
    summary: 'How digital access, booking confirmation, and online sessions are delivered.',
    sections: [
      { title: 'Digital service, no physical shipping', paragraphs: [
        'Calup supplies software access and booking administration digitally. We do not ship physical goods. The merchant is responsible for delivering the booked consultation, class, or other service at the agreed date, time, and format.',
      ] },
      { title: 'Booking confirmation and meeting access', paragraphs: [
        'A confirmed paid booking requires server verification of payment and successful allocation. Keep your booking ID and receipt. Use verified booking-management access to view the authoritative status if a popup closes, an update is delayed, or a message is not received.',
        'Online meeting access is delivered through the merchant’s enabled meeting integration or an authorised manual link. The merchant’s connected account hosts the session; instructors may use that merchant account. Contact the merchant if the link is missing or cannot be used.',
        'Transactional updates use enabled WhatsApp delivery with SMS fallback where needed; verification OTPs may use SMS or the available email verification flow. Message delivery is not a substitute for checking the actual booking status.',
      ] },
      { title: 'Subscription access and interruptions', paragraphs: [
        'Subscription access starts or extends only after verified payment and successful entitlement application, or a valid Calup-issued code. A pending, late, or disputed payment may need review before access is changed. Check exact access dates in the subscription dashboard.',
        'Internet, calendar, meeting, and payment-provider interruptions can affect delivery. Contact Calup about integration failures and the merchant about the service itself. Any manually verified alternative payment arrangement must be explicitly offered and confirmed; an uploaded receipt alone is not payment approval.',
      ] },
    ],
  },
  {
    slug: 'cookie-policy', title: 'Cookies and Browser Storage',
    summary: 'Essential sessions, saved preferences, and storage used by connected services.',
    sections: [
      { title: 'Essential cookies and sessions', paragraphs: [
        'Calup uses session mechanisms for authentication, booking access, and payment verification. Some access cookies are HttpOnly and are not readable by page scripts. Blocking essential cookies may prevent sign-in, tracking, or payment confirmation.',
      ] },
      { title: 'Other browser storage', paragraphs: [
        'Local storage can hold authentication session information and a non-secret returning-customer booking hint. Session storage can remember checkout restart navigation. These functions help restore the relevant workflow; they are not evidence that a payment succeeded.',
        'Clearing browser storage can sign you out or remove saved navigation hints. Do not share a device session with someone who should not access your booking or merchant account.',
      ] },
      { title: 'Third-party services and choices', paragraphs: [
        'Cashfree, Google, authentication, and communication providers may use their own cookies or storage during their flows. Their applicable notices explain their practices. Browser settings let you inspect and delete stored data.',
        'No advertising-cookie or marketing-tracker consent system is enabled by this policy page. Any future non-essential tracking must be disclosed and have appropriate controls before activation. Contact Calup with questions about storage or data choices.',
      ] },
    ],
  },
  {
    slug: 'contact', title: 'Contact and Grievances',
    summary: 'Business identity, support contacts, and how to raise a booking, payment, or privacy concern.',
    sections: [
      { title: 'Business and contact details', paragraphs: [
        `Operator: ${LEGAL_DETAILS.name}.`,
        ...(LEGAL_DETAILS.address ? [`Business address: ${LEGAL_DETAILS.address}`] : []),
        `Support email: ${LEGAL_DETAILS.supportEmail || 'Pending confirmation before commercial launch.'}`,
        `Contact number: ${LEGAL_DETAILS.supportPhone}`,
        `Grievance contact: ${LEGAL_DETAILS.grievanceName || 'Pending appointment before commercial launch.'}`,
        `Grievance email: ${LEGAL_DETAILS.grievanceEmail || 'Pending confirmation before commercial launch.'}`,
      ] },
      { title: 'Booking and service concerns', paragraphs: [
        'Contact your merchant about service quality, attendance, or appointment changes. Where available, raise a ticket from your verified booking page so the request is tied to the right booking. If that control is unavailable, use support directly; the absence of a control does not prevent raising a concern.',
        'The ordinary ticket window is 15 calendar days after the relevant service end, payment attempt, or latest refund update. Merchants have 48 hours to acknowledge a ticket; contact Calup if it is unanswered. The customer reopening window is three calendar days after closure; Calup may review exceptional reopening requests up to seven days after closure.',
      ] },
      { title: 'Escalations and urgent payment issues', paragraphs: [
        'For an unresolved closed ticket, request Calup escalation within seven calendar days of closure. Include the booking/payment reference, merchant, issue, prior ticket details, and relevant images or PDFs. Ask for a secure upload route before sending large videos or sensitive evidence.',
        'Urgent duplicate-charge, unauthorised-payment, or paid-but-unfulfilled issues can be escalated after the initial ticket is raised without waiting for merchant closure. If ticket creation is unavailable, contact Calup directly. Never include passwords, OTPs, CVVs, or full card details.',
        'Calup reviews platform/payment issues and the merchant assesses service-related issues. These internal decisions do not remove consumer, regulatory, banking-dispute, or court remedies. We aim to acknowledge formal grievances within 48 hours and work toward resolution within one month, subject to applicable legal requirements and the case facts.',
      ] },
      { title: 'Privacy requests', paragraphs: [
        'Use the grievance/support contact for access, correction, permitted deletion, or consent-related requests. Tell us what you need and the account/booking involved; we will verify ownership before releasing or changing personal information.',
      ] },
    ],
  },
];
