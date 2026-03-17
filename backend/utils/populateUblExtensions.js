/**
 * Step 6: Populate The UBL Extensions Output
 *
 * Fills the signature block fields with values from previous steps:
 * - SignatureValue (Step 2 - digital signature)
 * - X509Certificate (certificate from Binary_Security_Token)
 * - DigestValue for #xadesSignedProperties (Step 5 - signed properties hash)
 * - DigestValue for invoiceSignedData (Step 1 - invoice hash)
 * - xades:SignedProperties content (Step 4 - CertDigest, SigningTime, Issuer, Serial)
 *
 * Uses XPath to locate and replace values. Removes old values before setting new ones.
 */

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const { getCertDer } = require('./signedProperties');

const NAMESPACES = {
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
};

const select = xpath.useNamespaces(NAMESPACES);

/**
 * Set text content of node(s) matching XPath. Replaces existing content.
 */
function setText(doc, xpathExpr, text) {
  const nodes = select(xpathExpr, doc);
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  for (const node of list) {
    if (node && node.nodeType === 1) {
      node.textContent = String(text ?? '').trim();
    }
  }
}

/**
 * Populate UBL Extensions with signature values from Steps 1–5.
 *
 * @param {Object} params
 * @param {string} params.invoiceXml - Invoice XML (with signature structure from after Step 4)
 * @param {string} params.invoiceHashBase64 - Step 1: Base64 invoice hash (raw bytes)
 * @param {string} params.signatureValue - Step 2: Base64 digital signature
 * @param {string} params.binarySecurityToken - Certificate (base64, single or double encoded)
 * @param {string} params.signedPropertiesHashBase64 - Step 5: Base64(hex) signed properties hash
 * @param {Object} params.signedPropertiesValues - Step 4: { digestValue, signingTime, issuerName, serialNumber }
 * @param {string} [params.qrCodeBase64] - ZATCA Phase 2 QR TLV base64 (replaces placeholder in cbc:EmbeddedDocumentBinaryObject ID=QR)
 * @returns {string} Updated invoice XML
 */
function populateUblExtensions(params) {
  const {
    invoiceXml,
    invoiceHashBase64,
    signatureValue,
    binarySecurityToken,
    signedPropertiesHashBase64,
    signedPropertiesValues,
    qrCodeBase64,
  } = params;

  if (!invoiceXml) {
    throw new Error('invoiceXml is required');
  }
  if (!invoiceHashBase64) {
    throw new Error('invoiceHashBase64 (Step 1) is required');
  }
  if (!signatureValue) {
    throw new Error('signatureValue (Step 2) is required');
  }
  if (!binarySecurityToken) {
    throw new Error('binarySecurityToken is required');
  }
  if (!signedPropertiesHashBase64) {
    throw new Error('signedPropertiesHashBase64 (Step 5) is required');
  }
  if (!signedPropertiesValues) {
    throw new Error('signedPropertiesValues (Step 4) is required');
  }

  const certDer = getCertDer(binarySecurityToken);
  const x509CertificateBase64 = certDer.toString('base64');

  const parser = new DOMParser({
    locator: {},
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e; } },
  });
  const doc = parser.parseFromString(invoiceXml, 'application/xml');

  // 1. ds:SignatureValue (Step 2)
  setText(doc, "//ds:SignatureValue", signatureValue.trim());

  // 2. ds:X509Certificate
  setText(doc, "//ds:X509Certificate", x509CertificateBase64);

  // 3. ds:Reference[@URI='#xadesSignedProperties']/ds:DigestValue (Step 5)
  setText(doc, "//ds:Reference[@URI='#xadesSignedProperties']/ds:DigestValue", signedPropertiesHashBase64.trim());

  // 4. ds:Reference[@Id='invoiceSignedData']/ds:DigestValue (Step 1)
  setText(doc, "//ds:Reference[@Id='invoiceSignedData']/ds:DigestValue", invoiceHashBase64.trim());

  // 5. xades:SignedProperties content (Step 4 values)
  const { digestValue, signingTime, issuerName, serialNumber } = signedPropertiesValues;
  setText(doc, "//xades:CertDigest/ds:DigestValue", digestValue?.trim() ?? '');
  setText(doc, "//xades:SigningTime", signingTime?.trim() ?? '');
  setText(doc, "//xades:IssuerSerial/ds:X509IssuerName", issuerName?.trim() ?? '');
  setText(doc, "//xades:IssuerSerial/ds:X509SerialNumber", serialNumber?.trim() ?? '');

  // 6. QR code (ZATCA Phase 2 TLV base64) - cbc:EmbeddedDocumentBinaryObject in AdditionalDocumentReference ID=QR
  if (qrCodeBase64) {
    setText(doc, "//cac:AdditionalDocumentReference[cbc:ID='QR']/cac:Attachment/cbc:EmbeddedDocumentBinaryObject", qrCodeBase64.trim());
  }

  return new XMLSerializer().serializeToString(doc);
}

module.exports = { populateUblExtensions };
