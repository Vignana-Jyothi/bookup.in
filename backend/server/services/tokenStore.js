/**
 * Calup Multi-Tenant Token Store
 * Securely stores encrypted Google OAuth tokens per provider in Supabase
 * with an in-memory process cache.
 *
 * Tokens are encrypted at rest with AES-256-GCM using TOKEN_ENCRYPTION_KEY.
 * Ephemeral Render redeployments and restarts recover tokens from Supabase seamlessly.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { serviceRoleClient } from '../middleware/auth.js';

const tokenCache = {};
const memoryOnlyTestMode = () => process.env.NODE_ENV === 'test' && process.env.TOKEN_STORE_MEMORY_ONLY === 'true';

// Backend Supabase client
function getSupabaseClient() {
  if (serviceRoleClient) return serviceRoleClient;
  const key = config.supabaseServiceRoleKey || config.supabaseKey;
  if (!config.supabaseUrl || !key) return null;
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function readLocalTokens() {
  return { ...tokenCache };
}

function writeLocalTokens(data) {
  for (const key of Object.keys(tokenCache)) delete tokenCache[key];
  Object.assign(tokenCache, data || {});
}

export const tokenStore = {
  /**
   * Save newly authorized tokens for a provider.
   * Persists to Supabase (encrypted with TOKEN_ENCRYPTION_KEY) and syncs local cache.
   */
  async saveTokens(providerId, { email, accessToken, refreshToken, expiresAt, scope }) {
    if (!providerId) throw new Error('providerId is required');

    const all = readLocalTokens();
    if (memoryOnlyTestMode()) {
      const existing = all[providerId] || {};
      all[providerId] = {
        providerId,
        email: email || existing.email || '',
        encryptedAccessToken: accessToken ? encryptToken(accessToken) : existing.encryptedAccessToken,
        encryptedRefreshToken: refreshToken ? encryptToken(refreshToken) : existing.encryptedRefreshToken,
        expiresAt: expiresAt || existing.expiresAt || 0,
        scope: scope || existing.scope || '',
        connectedAt: existing.connectedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeLocalTokens(all);
      return true;
    }
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Google token storage is unavailable');
    let existing = all[providerId] || {};
    if (!existing.encryptedRefreshToken) {
      const { data: stored, error: readError } = await supabase
        .from('google_tokens')
        .select('email, encrypted_access_token, encrypted_refresh_token, expires_at, scope, connected_at')
        .eq('provider_id', providerId)
        .maybeSingle();
      if (readError) throw new Error(`Could not read existing Google credentials: ${readError.message}`);
      if (stored) {
        existing = {
          email: stored.email || '',
          encryptedAccessToken: stored.encrypted_access_token || null,
          encryptedRefreshToken: stored.encrypted_refresh_token || null,
          expiresAt: Number(stored.expires_at) || 0,
          scope: stored.scope || '',
          connectedAt: stored.connected_at || null,
        };
      }
    }

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

    // Persist before caching so OAuth is never reported as connected when the
    // durable encrypted record could not be saved.
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
    if (gtErr) throw new Error(`Could not persist Google credentials: ${gtErr.message}`);

    all[providerId] = record;
    writeLocalTokens(all);

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

    if (memoryOnlyTestMode()) {
      all[providerId] = existing;
      writeLocalTokens(all);
      return true;
    }

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Google token storage is unavailable');
    const { data, error: gtErr } = await supabase
      .from('google_tokens')
      .update({
        encrypted_access_token: encAccessToken,
        expires_at: newExpiresAt,
        updated_at: updatedAt,
      })
      .eq('provider_id', providerId)
      .select('provider_id')
      .maybeSingle();
    if (gtErr || !data) throw new Error(`Could not persist refreshed Google credentials: ${gtErr?.message || 'connection record not found'}`);

    all[providerId] = existing;
    writeLocalTokens(all);

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
      if (memoryOnlyTestMode()) return null;
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: gtData, error: gtErr } = await supabase
          .from('google_tokens')
          .select('*')
          .eq('provider_id', providerId)
          .maybeSingle();

        if (gtErr) throw new Error(`Could not read Google credentials: ${gtErr.message}`);
        if (gtData?.encrypted_access_token) {
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
      scope: record.scope || '',
      connectedAt: record.connectedAt || null,
    };
  },

  /**
   * Remove tokens on disconnect from local cache and Supabase.
   */
  async deleteTokens(providerId) {
    if (!providerId) return false;

    if (memoryOnlyTestMode()) {
      const all = readLocalTokens();
      delete all[providerId];
      writeLocalTokens(all);
      return true;
    }

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Google token storage is unavailable');
    const { error } = await supabase.from('google_tokens').delete().eq('provider_id', providerId);
    if (error) throw new Error(`Could not remove Google credentials: ${error.message}`);

    const all = readLocalTokens();
    delete all[providerId];
    writeLocalTokens(all);

    return true;
  }
};
