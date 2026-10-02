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
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
  supportEmail: process.env.SUPPORT_EMAIL || process.env.VITE_SUPPORT_EMAIL || '',
  appDomain: process.env.APP_DOMAIN || '',

  isGoogleConfigured() {
    return Boolean(this.googleClientId && this.googleClientSecret && this.googleRedirectUri);
  },
  isRichAutomateConfigured() {
    return Boolean(this.richAutomateApiKey && this.richAutomateApiKey.trim().length > 0);
  },
  isEmailConfigured() {
    return Boolean(this.resendApiKey && this.resendApiKey.trim().length > 0 && this.resendFromEmail);
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
  if (!config.supabaseKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY)');
  }
  if (!config.frontendUrl) {
    missing.push('FRONTEND_URL (or VITE_APP_URL)');
  }
  if (!config.tokenEncryptionKey) {
    missing.push('TOKEN_ENCRYPTION_KEY');
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

  if (missing.length > 0) {
    const errorDetails = `\n======================================================\n❌ FATAL STARTUP ERROR: Missing required environment variable(s):\n${missing.map(m => `  • ${m}`).join('\n')}\n\nPlease define these variables in your .env file or host environment.\nSee .env.example and DEPLOY.md for details.\n======================================================\n`;
    console.error(errorDetails);
    throw new Error(`Startup failed due to missing required environment variables: ${missing.join(', ')}`);
  }
}
