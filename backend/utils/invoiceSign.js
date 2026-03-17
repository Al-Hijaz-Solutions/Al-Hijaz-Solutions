/**
 * Generate Digital Signature - Step 2 of ZATCA Invoice Signing Process
 *
 * Signs the invoice hash with ECDSA using the private key.
 * ZATCA uses ECDSA with P-256 (prime256v1) and SHA-256.
 *
 * We sign the canonical XML directly; Node's createSign will SHA-256 hash it
 * (producing the same hash as Step 1) then sign with ECDSA.
 *
 * Input: canonicalXml (from Step 1) or invoiceHashHex, plus private key
 * Output: Base64-encoded ECDSA signature (used in later steps)
 */

const crypto = require('crypto');
const EC = require('elliptic').ec;

/**
 * Format private key for Node.js crypto.
 * Accepts: PEM string, or base64-encoded DER (PKCS#8) without headers.
 */
function formatPrivateKey(privateKeyInput) {
  let key = String(privateKeyInput).trim();
  key = key.replace(/^['"]|['"]$/g, ''); // strip surrounding quotes from .env

  if (key.includes('-----BEGIN')) {
    return key;
  }

  // Assume base64 DER - wrap in PEM
  const base64 = key.replace(/\s/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

/**
 * Generate ECDSA digital signature for the invoice.
 *
 * Signs the canonical XML (from Step 1). createSign hashes it with SHA-256
 * (producing the invoice hash) then signs with ECDSA - equivalent to signing
 * the hash directly per ZATCA spec.
 *
 * @param {Object} options
 * @param {string} options.canonicalXml - Canonical XML from generateInvoiceHash (Step 1)
 * @param {string} options.privateKey - Private key (PEM or base64 DER from Fatoora)
 * @param {Buffer} [options.hashBuffer] - Optional: raw SHA-256 hash; when provided, signs it directly and logs result
 * @returns {string} Base64-encoded ECDSA signature (e.g. MEQCIGvLa1f3uMCe...)
 */
function generateDigitalSignature(options) {
  const { canonicalXml, privateKey, hashBuffer } = options;

  if (!canonicalXml || !privateKey) {
    throw new Error('Must provide canonicalXml and privateKey');
  }

  const pemKey = formatPrivateKey(privateKey);

  // Optional: sign using hashBuffer directly (raw SHA-256 bytes) - for verification
  if (hashBuffer && Buffer.isBuffer(hashBuffer)) {
    const ec = new EC('p256');
    const keyObj = crypto.createPrivateKey(pemKey);
    const jwk = keyObj.export({ format: 'jwk' });
    const privateKeyHex = Buffer.from(jwk.d, 'base64url').toString('hex');
    const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
    const msgHex = hashBuffer.toString('hex');
    const sig = keyPair.sign(msgHex, 'hex');
    const sigDer = Buffer.from(sig.toDER());
    console.log('signature (from hashBuffer):', sigDer.toString('base64'));
  }

  const sign = crypto.createSign('SHA256');
  sign.update(canonicalXml, 'utf8');
  sign.end();

  const signatureBuffer = sign.sign(pemKey);
  console.log('signatureBuffer',signatureBuffer)
  return signatureBuffer.toString('base64');
}

module.exports = { generateDigitalSignature, formatPrivateKey };
