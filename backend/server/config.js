/**
 * BookUp Server Configuration
 * Loads environment variables from project root .env and validates required configuration.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  frontendUrl: (process.env.FRONTEND_URL || process.env.VITE_APP_URL || process.env.APP_URL || '').replace(/\/+$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  richAutomateApiKey: process.env.RICH_AUTOMATE_API_KEY || '',
  internalCronSecret: process.env.INTERNAL_CRON_SECRET || '',
  resendApiKey: (
    process.env.RESEND_API_KEY ||
    process.env.resend_api_key ||
    process.env.RESEND_KEY ||
    process.env.RESEND_API_TOKEN ||
    ''
  ).trim(),
  resendFromEmail: (process.env.RESEND_FROM_EMAIL || process.env.resend_from_email || '').trim(),
  twoFactorApiKey: (process.env.TWO_FACTOR_API_KEY || '').trim(),
  twoFactorTemplateName: (process.env.TWO_FACTOR_TEMPLATE_NAME || '').trim(),
  supportEmail: process.env.SUPPORT_EMAIL || process.env.VITE_SUPPORT_EMAIL || '',
  appDomain: process.env.APP_DOMAIN || '',
  backendPublicUrl: (process.env.BACKEND_PUBLIC_URL || '').replace(/\/+$/, ''),
  cashfreeEnabled: process.env.CASHFREE_V1_ENABLED === 'true',
  cashfreeEnvironment: process.env.CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  cashfreeClientId: (process.env.CASHFREE_CLIENT_ID || '').trim(),
  cashfreeClientSecret: (process.env.CASHFREE_CLIENT_SECRET || '').trim(),
  cashfreeApiVersion: (process.env.CASHFREE_API_VERSION || '2023-08-01').trim(),
  cashfreeAllowUnverifiedContact: process.env.CASHFREE_SANDBOX_ALLOW_UNVERIFIED_CONTACT === 'true',

  isGoogleConfigured() {
    return Boolean(this.googleClientId && this.googleClientSecret && this.googleRedirectUri);
  },
  isRichAutomateConfigured() {
    return Boolean(this.richAutomateApiKey && this.richAutomateApiKey.trim().length > 0);
  },
  isEmailConfigured() {
    return Boolean(this.resendApiKey && this.resendApiKey.trim().length > 0 && this.resendFromEmail);
  },
  isTwoFactorConfigured() {
    return Boolean(this.twoFactorApiKey);
  },
  isCashfreeConfigured() {
    return Boolean(this.cashfreeEnabled && this.cashfreeClientId && this.cashfreeClientSecret && this.backendPublicUrl);
  },
};

/**
 * Validates that all required environment variables are present and well-formed.
 * Fails loudly at startup if any required environment variable is missing.
 * Never falls back to a hardcoded production value.
 */
export function validateConfig() {
  const missing = [];

  if (!config.supabaseUrl) {
    missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
  }
  if (!config.supabaseServiceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!config.frontendUrl) {
    missing.push('FRONTEND_URL (or VITE_APP_URL)');
  }
  if (!config.tokenEncryptionKey) {
    missing.push('TOKEN_ENCRYPTION_KEY');
  } else if (!/^[0-9a-fA-F]{64}$/.test(config.tokenEncryptionKey)) {
    missing.push('TOKEN_ENCRYPTION_KEY (must be exactly 64 hexadecimal characters)');
  }

  // Google OAuth conditional validation
  if (config.googleClientId || config.googleClientSecret) {
    if (!config.googleClientId) missing.push('GOOGLE_CLIENT_ID');
    if (!config.googleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    if (!config.googleRedirectUri) missing.push('GOOGLE_REDIRECT_URI (required when Google OAuth is configured)');
  }

  // Resend Email conditional validation
  if (config.resendApiKey && !config.resendFromEmail) {
    missing.push('RESEND_FROM_EMAIL (required when RESEND_API_KEY is configured)');
  }

  if (config.twoFactorTemplateName && !config.twoFactorApiKey) {
    missing.push('TWO_FACTOR_API_KEY (required when TWO_FACTOR_TEMPLATE_NAME is configured)');
  }

  if (config.cashfreeEnabled) {
    if (!config.cashfreeClientId) missing.push('CASHFREE_CLIENT_ID');
    if (!config.cashfreeClientSecret) missing.push('CASHFREE_CLIENT_SECRET');
    if (!config.backendPublicUrl) missing.push('BACKEND_PUBLIC_URL (required when Cashfree v1 is enabled)');
    if (config.cashfreeEnvironment === 'production' && config.cashfreeAllowUnverifiedContact) {
      missing.push('CASHFREE_SANDBOX_ALLOW_UNVERIFIED_CONTACT must be false in production');
    }
  }

  if (missing.length > 0) {
    const errorDetails = `\n======================================================\n❌ FATAL STARTUP ERROR: Missing required environment variable(s):\n${missing.map(m => `  • ${m}`).join('\n')}\n\nPlease define these variables in your .env file or host environment.\nSee .env.example and guides/project/DEPLOY.md for details.\n======================================================\n`;
    console.error(errorDetails);
    throw new Error(`Startup failed due to missing required environment variables: ${missing.join(', ')}`);
  }
}
