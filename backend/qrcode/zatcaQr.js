/**
 * ZATCA Phase 2 QR Code - TLV (Tag-Length-Value) Generator
 * Same format as Fatoora SDK output for cbc:EmbeddedDocumentBinaryObject
 *
 * Tags 1-5: Phase 1 (Generation)
 * Tags 6-9: Phase 2 (Integration)
 *   Tag 8: ECDSA Public Key (extracted from cert, SPKI format)
 *   Tag 9: ZATCA Stamp (compliance certificate)
 */

const crypto = require('crypto');
const { getCertDer } = require('../utils/signedProperties');

/**
 * Build a single TLV (Tag-Length-Value) block
 * @param {number} tag - Tag 1-9
 * @param {string|Buffer} value - UTF-8 string or raw Buffer (for Tag 8 use raw SPKI bytes)
 * @returns {Buffer}
 */
function buildTLV(tag, value) {
  const valueBuf = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  const tagBuf = Buffer.alloc(1);
  tagBuf.writeUInt8(tag);
  const lenBuf = Buffer.alloc(1);
  lenBuf.writeUInt8(Math.min(valueBuf.length, 255));
  return Buffer.concat([tagBuf, lenBuf, valueBuf]);
}

/**
 * Format timestamp for ZATCA (ISO 8601, no ms)
 * e.g. 2025-10-15T00:00:00
 */
function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

/**
 * Get certificate as base64 (handles single/double encoding from ZATCA)
 */
function getCertificateBase64(binarySecurityToken) {
  const certDer = getCertDer(binarySecurityToken);
  return certDer.toString('base64');
}

/**
 * Extract public key (SPKI) as raw DER bytes from certificate - for Tag 8
 * Fatoora/ZATCA stores raw SPKI bytes (88 bytes), NOT base64 string
 */
function getPublicKeyDer(binarySecurityToken) {
  const certDer = getCertDer(binarySecurityToken);
  const pem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64')}\n-----END CERTIFICATE-----`;
  const cert = new crypto.X509Certificate(pem);
  return cert.publicKey.export({ format: 'der', type: 'spki' });
}

/**
 * Generate ZATCA Phase 2 QR TLV and return base64 string for cbc:EmbeddedDocumentBinaryObject
 *
 * @param {Object} params
 * @param {Object} params.zatcaData - From mapQBOInvoiceToZatca (supplier, taxTotal, monetaryTotal, issueDate)
 * @param {string} params.invoiceHashBase64 - Step 1: base64 of raw hash (or base64(hex) per ZATCA - check Fatoora)
 * @param {string} params.digitalSignature - Step 2: base64 ECDSA signature
 * @param {string} params.binarySecurityToken - Compliance certificate (base64)
 * @returns {string} Base64-encoded TLV for QR
 */
function generateZatcaQrBase64(params) {
  const {
    zatcaData,
    invoiceHashBase64,
    digitalSignature,
    binarySecurityToken,
  } = params;

  const supplier = zatcaData?.supplier || {};
  const taxTotal = zatcaData?.taxTotal || {};
  const monetaryTotal = zatcaData?.monetaryTotal || {};
  const issueDate = zatcaData?.issueDate || new Date();

  const totalWithVat = parseFloat(monetaryTotal.payableAmount ?? monetaryTotal.taxInclusiveAmount ?? 0).toFixed(2);
  const vatAmount = parseFloat(taxTotal.taxAmount ?? 0).toFixed(2);
  const timestamp = formatTimestamp(issueDate);

  const publicKeyDer = getPublicKeyDer(binarySecurityToken);

  const parts = [];

  // Tag 1: Seller Name
  parts.push(buildTLV(1, supplier.name || ''));

  // Tag 2: VAT Registration Number
  parts.push(buildTLV(2, supplier.vatNumber || ''));

  // Tag 3: Invoice Date/Time (ISO 8601)
  parts.push(buildTLV(3, timestamp));

  // Tag 4: Invoice Total (with VAT)
  parts.push(buildTLV(4, totalWithVat));

  // Tag 5: VAT Amount
  parts.push(buildTLV(5, vatAmount));

  // Tag 6: Invoice Hash (base64)
  parts.push(buildTLV(6, invoiceHashBase64 || ''));

  // Tag 7: ECDSA Signature (base64)
  parts.push(buildTLV(7, digitalSignature || ''));

  // Tag 8: ECDSA Public Key (raw SPKI DER bytes - same format as Fatoora)
  parts.push(buildTLV(8, publicKeyDer));

  // Tag 9 omitted - Fatoora outputs only Tags 1-8 for exact match

  const tlvBuffer = Buffer.concat(parts);
  return tlvBuffer.toString('base64');
}

module.exports = {
  generateZatcaQrBase64,
  buildTLV,
  formatTimestamp,
  getCertificateBase64,
};
