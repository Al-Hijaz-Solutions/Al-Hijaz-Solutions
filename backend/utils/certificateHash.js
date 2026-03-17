/**
 * Generate Certificate Hash
 * Step: After Compliance API returns binary security token
 *
 * 1. Take binary security token (base64) from Compliance API response
 * 2. Base64 decode → X509 certificate (DER format)
 * 3. SHA-256 hash the certificate
 * 4. Output: certificate hash in hex and base64 (for xades:CertDigest/DigestValue)
 */

const crypto = require('crypto');

/**
 * Generate certificate hash from binary security token
 *
 * @param {string} binarySecurityToken - Base64-encoded X509 certificate from Compliance API response
 * @returns {Object} {
 *   certificateHashHex: string,
 *   certificateHashBase64: string,  // base64(hex) per ZATCA xades:CertDigest
 *   X509Certificate_Base64, X509Certificate, X509Certificate_hashBuffer, X509Certificate_Hex
 * }
 */
function generateCertificateHash(binarySecurityToken) {
  const token = String(binarySecurityToken).trim().replace(/\s/g, '');

  if (!token) {
    throw new Error('Binary security token is required');
  }

  // Step 2: Base64 decode → X509 certificate (DER)
  const X509Certificate = Buffer.from(token, 'base64');

  if (X509Certificate.length === 0) {
    throw new Error('Invalid binary security token: base64 decode resulted in empty buffer');
  } 

  // Step 3: SHA-256 hash the certificate
  const X509Certificate_hashBuffer = crypto.createHash('sha256').update(X509Certificate).digest();

  // Step 4: Output hex and base64
  const X509Certificate_Hex = X509Certificate_hashBuffer.toString('hex');
  // ZATCA xades:CertDigest expects base64(hex_string), not base64(raw) - per SDK sample
  const X509Certificate_Base64 = Buffer.from(X509Certificate_Hex, 'utf8').toString('base64');

  return {
    certificateHashHex: X509Certificate_Hex,
    certificateHashBase64: X509Certificate_Base64,
    X509Certificate_Base64,
    X509Certificate,
    X509Certificate_hashBuffer,
    X509Certificate_Hex,
  };
}

/**
 * Extract binary security token from Compliance API response
 * Response structure may vary; common field names: binarySecurityToken, BinarySecurityToken
 *
 * @param {Object} complianceResponse - Parsed JSON response from Compliance API
 * @returns {string|null} Base64 binary security token or null
 */
function extractBinarySecurityToken(complianceResponse) {
  const data = complianceResponse?.data ?? complianceResponse;
  return (
    data?.binarySecurityToken ??
    data?.BinarySecurityToken ??
    data?.complianceCsid ??
    null
  );
}

module.exports = {
  generateCertificateHash,
  extractBinarySecurityToken,
};
