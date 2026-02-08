/**
 * ═══════════════════════════════════════════════════════════════════════
 * ENCRYPTION SERVICE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Handles all encryption for the SaaS application:
 * 1. Encrypt source code at rest in HANA DB (per-tenant keys)
 * 2. Encrypt reversal maps (never stored in plain text)
 * 3. Encrypt API payloads before logging
 * 4. Key management via BTP Credential Store
 *
 * Encryption: AES-256-GCM (authenticated encryption)
 * Key Derivation: PBKDF2 with tenant-specific salt
 */

const crypto = require('crypto');
const cds = require('@sap/cds');
const LOG = cds.log('encryption');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;     // 256 bits
const IV_LENGTH = 16;      // 128 bits
const TAG_LENGTH = 16;     // 128 bits auth tag
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

class EncryptionService {

    constructor() {
        // Master key from BTP Credential Store or environment
        this._masterKey = process.env.ENCRYPTION_MASTER_KEY;
        this._tenantKeys = new Map();
    }

    /**
     * Initialize with master key from BTP Credential Store
     */
    async initialize() {
        if (!this._masterKey) {
            try {
                // Try BTP Credential Store
                const xsenv = require('@sap/xsenv');
                const credStore = xsenv.getServices({ credstore: { tag: 'credstore' } });
                if (credStore?.credstore) {
                    this._masterKey = await this._fetchFromCredStore(
                        credStore.credstore, 'encryption-master-key'
                    );
                }
            } catch (e) {
                LOG.warn('Credential Store not available, using env variable');
            }
        }

        if (!this._masterKey) {
            // Generate and log warning - in production this MUST come from Credential Store
            this._masterKey = crypto.randomBytes(KEY_LENGTH).toString('hex');
            LOG.error('SECURITY WARNING: Using generated master key. Configure ENCRYPTION_MASTER_KEY in Credential Store!');
        }
    }

    /**
     * Derive a tenant-specific encryption key
     * Each tenant gets a unique key derived from master key + tenant ID
     */
    _deriveTenantKey(tenantId) {
        if (this._tenantKeys.has(tenantId)) {
            return this._tenantKeys.get(tenantId);
        }

        const salt = crypto.createHash('sha256')
            .update(`tenant:${tenantId}:salt`)
            .digest();

        const key = crypto.pbkdf2Sync(
            this._masterKey,
            salt,
            PBKDF2_ITERATIONS,
            KEY_LENGTH,
            'sha512'
        );

        this._tenantKeys.set(tenantId, key);
        return key;
    }

    /**
     * Encrypt data with tenant-specific key
     * Returns: { encrypted: base64, iv: base64, tag: base64 }
     */
    encrypt(plaintext, tenantId) {
        if (!plaintext) return null;

        const key = this._deriveTenantKey(tenantId);
        const iv = crypto.randomBytes(IV_LENGTH);

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag();

        return {
            encrypted: encrypted,
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            algorithm: ALGORITHM
        };
    }

    /**
     * Decrypt data with tenant-specific key
     */
    decrypt(encryptedData, tenantId) {
        if (!encryptedData?.encrypted) return null;

        const key = this._deriveTenantKey(tenantId);
        const iv = Buffer.from(encryptedData.iv, 'base64');
        const tag = Buffer.from(encryptedData.tag, 'base64');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Encrypt source code for database storage
     * Adds compression for large code blocks
     */
    encryptSourceCode(sourceCode, tenantId) {
        const zlib = require('zlib');

        // Compress first (ABAP code compresses well - ~60-70% reduction)
        const compressed = zlib.gzipSync(Buffer.from(sourceCode, 'utf8'));
        const compressedBase64 = compressed.toString('base64');

        // Then encrypt
        const result = this.encrypt(compressedBase64, tenantId);
        result.compressed = true;
        result.originalSize = sourceCode.length;

        return result;
    }

    /**
     * Decrypt source code from database
     */
    decryptSourceCode(encryptedData, tenantId) {
        const zlib = require('zlib');

        const decryptedBase64 = this.decrypt(encryptedData, tenantId);

        if (encryptedData.compressed) {
            const compressed = Buffer.from(decryptedBase64, 'base64');
            return zlib.gunzipSync(compressed).toString('utf8');
        }

        return decryptedBase64;
    }

    /**
     * Hash sensitive data for logging (one-way, non-reversible)
     * Use this when you need to log that something happened without exposing the data
     */
    hashForAudit(data) {
        return crypto.createHash('sha256')
            .update(data)
            .digest('hex')
            .substring(0, 16); // Truncated hash for logs
    }

    /**
     * Generate a secure random token
     */
    generateToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    /**
     * Fetch key from BTP Credential Store
     */
    async _fetchFromCredStore(credentials, keyName) {
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

        const response = await executeHttpRequest(
            { url: credentials.url },
            {
                method: 'GET',
                url: `/api/v1/credentials/${keyName}`,
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${credentials.username}:${credentials.password}`
                    ).toString('base64')}`
                }
            }
        );

        return response.data?.value;
    }
}

module.exports = EncryptionService;

