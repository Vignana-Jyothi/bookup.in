/**
 * Calup Multi-Tenant Token Store
 * Securely stores encrypted Google OAuth tokens per provider in Supabase
 * with local file caching in server/data/tokens.json.
 *
 * Tokens are encrypted at rest with AES-256-GCM using TOKEN_ENCRYPTION_KEY.
 * Ephemeral Render redeployments and restarts recover tokens from Supabase seamlessly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { serviceRoleClient } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

// Backend Supabase client
function getSupabaseClient() {
  if (serviceRoleClient) return serviceRoleClient;
  const key = config.supabaseServiceRoleKey || config.supabaseKey;
  if (!config.supabaseUrl || !key) return null;
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Local cache helpers
function ensureStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(TOKENS_FILE)) {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify({}, null, 2), 'utf8');
    }
  } catch (_e) {}
}

function readLocalTokens() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return {};
  }
}

function writeLocalTokens(data) {
  ensureStorage();
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (_e) {}
}

export const tokenStore = {
  /**
   * Save newly authorized tokens for a provider.
   * Persists to Supabase (encrypted with TOKEN_ENCRYPTION_KEY) and syncs local cache.
   */
  async saveTokens(providerId, { email, accessToken, refreshToken, expiresAt, scope }) {
    if (!providerId) throw new Error('providerId is required');

    const all = readLocalTokens();
    const existing = all[providerId] || {};

    const encAccessToken = accessToken ? encryptToken(accessToken) : existing.encryptedAccessToken;
    const encRefreshToken = refreshToken ? encryptToken(refreshToken) : existing.encryptedRefreshToken;
    const effectiveExpiresAt = expiresAt || existing.expiresAt || 0;
    const effectiveScope = scope || existing.scope || '';
    const effectiveEmail = email || existing.email || '';
    const connectedAt = existing.connectedAt || new Date().toISOString();
    const updatedAt = new Date().toISOString();

    const record = {
      providerId,
      email: effectiveEmail,
      encryptedAccessToken: encAccessToken,
      encryptedRefreshToken: encRefreshToken,
      expiresAt: effectiveExpiresAt,
      scope: effectiveScope,
      connectedAt,
      updatedAt,
    };

    // 1. Sync to local file cache
    all[providerId] = record;
    writeLocalTokens(all);

    // 2. Persist to Supabase so tokens survive Render container restarts & redeploys
    // Writes strictly to the dedicated google_tokens table (no providers.bio fallback)
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error: gtErr } = await supabase
          .from('google_tokens')
          .upsert(
            {
              provider_id: providerId,
              email: effectiveEmail,
              encrypted_access_token: encAccessToken,
              encrypted_refresh_token: encRefreshToken || null,
              expires_at: effectiveExpiresAt,
              scope: effectiveScope,
              connected_at: connectedAt,
              updated_at: updatedAt,
            },
            { onConflict: 'provider_id' }
          );

        if (gtErr) {
          console.warn(`[TokenStore] Could not upsert to google_tokens: ${gtErr.message}`);
        }
      } catch (err) {
        console.warn(`[TokenStore] Supabase error: ${err.message}`);
      }
    }

    return true;
  },

  /**
   * Update access token after refresh.
   */
  async updateAccessToken(providerId, newAccessToken, newExpiresAt) {
    if (!providerId || !newAccessToken) return false;

    const all = readLocalTokens();
    const existing = all[providerId] || {};

    const encAccessToken = encryptToken(newAccessToken);
    const updatedAt = new Date().toISOString();

    existing.encryptedAccessToken = encAccessToken;
    existing.expiresAt = newExpiresAt;
    existing.updatedAt = updatedAt;

    all[providerId] = existing;
    writeLocalTokens(all);

    // Sync to Supabase google_tokens table
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error: gtErr } = await supabase
          .from('google_tokens')
          .update({
            encrypted_access_token: encAccessToken,
            expires_at: newExpiresAt,
            updated_at: updatedAt,
          })
          .eq('provider_id', providerId);

        if (gtErr) {
          console.warn(`[TokenStore] Could not update access token in google_tokens for ${providerId}: ${gtErr.message}`);
        }
      } catch (err) {
        console.warn(`[TokenStore] Supabase error: ${err.message}`);
      }
    }

    return true;
  },

  /**
   * Get decrypted tokens for server-side Google Calendar operations.
   * Checks local cache first; if empty (after Render redeploy or cold start),
   * retrieves encrypted tokens from Supabase google_tokens table and restores them into local cache.
   */
  async getDecryptedTokens(providerId) {
    if (!providerId) return null;

    let record = null;
    const all = readLocalTokens();

    if (all[providerId]?.encryptedAccessToken || all[providerId]?.encryptedRefreshToken) {
      record = all[providerId];
    }

    // If not in local cache (or after Render container restart), recover from Supabase google_tokens
    if (!record) {
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const { data: gtData, error: gtErr } = await supabase
            .from('google_tokens')
            .select('*')
            .eq('provider_id', providerId)
            .maybeSingle();

          if (!gtErr && gtData?.encrypted_access_token) {
            record = {
              providerId,
              email: gtData.email || '',
              encryptedAccessToken: gtData.encrypted_access_token,
              encryptedRefreshToken: gtData.encrypted_refresh_token || null,
              expiresAt: Number(gtData.expires_at) || 0,
              scope: gtData.scope || '',
              connectedAt: gtData.connected_at || gtData.created_at || null,
            };
          }
        } catch (_e) {}

        // Restore recovered record to local cache
        if (record) {
          all[providerId] = record;
          writeLocalTokens(all);
        }
      }
    }

    if (!record) return null;

    try {
      return {
        providerId: record.providerId,
        email: record.email,
        accessToken: record.encryptedAccessToken ? decryptToken(record.encryptedAccessToken) : null,
        refreshToken: record.encryptedRefreshToken ? decryptToken(record.encryptedRefreshToken) : null,
        expiresAt: record.expiresAt,
        scope: record.scope,
      };
    } catch (err) {
      console.error(`[TokenStore] Failed to decrypt tokens for ${providerId}:`, err.message);
      return null;
    }
  },

  /**
   * Safe status query for UI / client (never exposes tokens).
   */
  async getStatus(providerId) {
    if (!providerId) {
      return { isConnected: false, email: null, connectedAt: null };
    }

    const all = readLocalTokens();
    let record = all[providerId];

    if (!record || (!record.encryptedAccessToken && !record.encryptedRefreshToken)) {
      // Check Supabase
      const recovered = await this.getDecryptedTokens(providerId);
      if (recovered) {
        const cached = readLocalTokens()[providerId];
        record = cached;
      }
    }

    if (!record || (!record.encryptedAccessToken && !record.encryptedRefreshToken)) {
      return { isConnected: false, email: null, connectedAt: null };
    }

    return {
      isConnected: true,
      email: record.email || null,
      connectedAt: record.connectedAt || null,
    };
  },

  /**
   * Remove tokens on disconnect from local cache and Supabase.
   */
  async deleteTokens(providerId) {
    if (!providerId) return false;

    // 1. Delete from local cache
    const all = readLocalTokens();
    if (all[providerId]) {
      delete all[providerId];
      writeLocalTokens(all);
    }

    // 2. Delete from Supabase google_tokens table
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('google_tokens').delete().eq('provider_id', providerId);
      } catch (_e) {}
    }

    return true;
  }
};
