/**
 * Step 4: Populate The Signed Properties & Generate Signed Properties Hash
 *
 * Build SignedProperties XML (not inserted into invoice), populate with:
 * - DigestValue (xades:CertDigest) - Certificate hash from Step 3
 * - SigningTime - Current datetime
 * - X509IssuerName, X509SerialNumber - From X509 certificate
 *
 * Then: Canonicalize → SHA-256 → Base64 = Signed Properties Hash (for next step ds:Reference DigestValue)
 */

const crypto = require('crypto');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const { C14n11Canonicalization } = require('./c14n11Canonicalization');

const NAMESPACES = {
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
};

/**
 * Extract issuer name and serial number from X509 certificate (binary security token)
 *
 * @param {string} binarySecurityToken - Base64-encoded X509 certificate
 * @returns {Object} { issuerName: string, serialNumber: string (decimal) }
 */
/**
 * Get X509 DER from token (handles single or double base64 from ZATCA)
 * Certificate hash uses single decode; issuer/serial need inner cert.
 */
function getCertDer(binarySecurityToken) {
  const raw = String(binarySecurityToken).trim().replace(/^['"]|['"]$/g, '');
  const token = raw.replace(/\s/g, '');
  const first = Buffer.from(token, 'base64');

  if (first.length === 0) {
    throw new Error('Invalid binary security token');
  }

  // 0x30 = SEQUENCE (start of X509 DER)
  if (first[0] === 0x30) return first;

  // ZATCA sometimes returns double base64; inner decode is the actual cert
  const inner = first.toString('utf8').replace(/\s/g, '');
  const second = Buffer.from(inner, 'base64');
  if (second.length > 0 && second[0] === 0x30) return second;

  return first; // fallback
}

function extractCertificateInfo(binarySecurityToken) {
  const certDer = getCertDer(binarySecurityToken);

  const pem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64')}\n-----END CERTIFICATE-----`;
  const cert = new crypto.X509Certificate(pem);

  const issuerName = cert.issuer;
  let serialNumber = cert.serialNumber;

  // Node returns hex (e.g. "AB:CD:12" or "0eaa20f53cacdcaa40fbde51ab50c7d1")
  // ZATCA expects decimal string for ds:X509SerialNumber
  const hex = serialNumber.replace(/:/g, '').toLowerCase();
  const serialDecimal = BigInt('0x' + hex).toString(10);

  return {
    issuerName,
    serialNumber: serialDecimal,
  };
}

/**
 * Format current datetime for xades:SigningTime (ISO 8601 without ms)
 * e.g. 2025-02-26T14:30:00
 */
function getSigningTime() {
  const d = new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

/**
 * Build SignedProperties fragment (xades:SignedProperties inner content)
 * Or return the values for manual insertion
 *
 * @param {Object} options
 * @param {string} options.certificateHashBase64 - From Step 3 (generateCertificateHash)
 * @param {string} [options.signingTime] - Optional; defaults to current time
 * @param {string} [options.binarySecurityToken] - To extract issuer/serial; or pass issuerName + serialNumber directly
 * @param {string} [options.issuerName]
 * @param {string} [options.serialNumber]
 * @returns {Object} { digestValue, signingTime, issuerName, serialNumber }
 */
function buildSignedPropertiesValues(options) {
  const {
    certificateHashBase64,
    X509Certificate_Base64,
    signingTime = getSigningTime(),
    binarySecurityToken,
    issuerName: providedIssuer,
    serialNumber: providedSerial,
  } = options;

  const digestValue = certificateHashBase64 ?? X509Certificate_Base64;
  if (!digestValue) {
    throw new Error('certificateHashBase64 is required');
  }

  let issuerName = providedIssuer;
  let serialNumber = providedSerial;

  if ((!issuerName || !serialNumber) && binarySecurityToken) {
    const info = extractCertificateInfo(binarySecurityToken);
    issuerName = issuerName ?? info.issuerName;
    serialNumber = serialNumber ?? info.serialNumber;
  }

  if (!issuerName || !serialNumber) {
    throw new Error('Issuer and serial required: provide binarySecurityToken or issuerName + serialNumber');
  }

  return {
    digestValue: digestValue.replace(/\s/g, ''),
    signingTime,
    issuerName,
    serialNumber,
  };
}

/**
 * Build the xades:SignedProperties XML fragment (exact structure per ZATCA)
 * Used to compute Signed Properties Hash - NOT inserted into invoice in this step
 */
function buildSignedPropertiesXML(values) {
  const { digestValue, signingTime, issuerName, serialNumber } = values;
  return `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
<xades:SignedSignatureProperties>
<xades:SigningTime>${escapeXml(signingTime)}</xades:SigningTime>
<xades:SigningCertificate>
<xades:Cert>
<xades:CertDigest>
<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(digestValue)}</ds:DigestValue>
</xades:CertDigest>
<xades:IssuerSerial>
<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(issuerName)}</ds:X509IssuerName>
<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(serialNumber)}</ds:X509SerialNumber>
</xades:IssuerSerial>
</xades:Cert>
</xades:SigningCertificate>
</xades:SignedSignatureProperties>
</xades:SignedProperties>`;
}

/**
 * Generate Signed Properties Hash (Step 5 - for ds:Reference SignatureProperties DigestValue)
 *
 * 1. Build xades:SignedProperties tag with populated values from Step 4
 * 2. Canonicalize (C14N11) and hash with SHA-256 → hex output
 * 3. Base64-encode the hex string (ZATCA format for DigestValue)
 *
 * @param {Object} options - Same as buildSignedPropertiesValues
 * @returns {Object} {
 *   signedPropertiesXml,
 *   signedPropertiesHashHex,      // e.g. 99282555b5d79209be5883cc23eb234cd01bd33ea7d54d88f491248d33e321f1
 *   signedPropertiesHashBase64,   // Base64(hex) - use in ds:Reference DigestValue
 *   values
 * }
 */
function generateSignedPropertiesHash(options) {
  const values = buildSignedPropertiesValues(options);
  const xml = buildSignedPropertiesXML(values);

  const parser = new DOMParser({
    locator: {},
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e; } },
  });
  const doc = parser.parseFromString(xml, 'application/xml');
  const root = doc.documentElement;

  if (!root || !/SignedProperties$/i.test(root.localName || root.tagName || '')) {
    throw new Error('Failed to parse SignedProperties XML');
  }

  const c14n = new C14n11Canonicalization();
  const canonicalXml = c14n.process(root, {});
  const hashBuffer = crypto.createHash('sha256').update(canonicalXml, 'utf8').digest();
  const signedPropertiesHashHex = hashBuffer.toString('hex');
  
  // ZATCA: base64-encode the hex string (not raw hash bytes) for DigestValue
  const signedPropertiesHashBase64 = Buffer.from(signedPropertiesHashHex, 'utf8').toString('base64');

  return {
    signedPropertiesXml: xml,
    signedPropertiesHashHex,
    signedPropertiesHashBase64,
    values,
  };
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const select = xpath.useNamespaces(NAMESPACES);

/**
 * Populate Signed Properties in an invoice XML that has the signature block structure.
 * Updates: DigestValue (CertDigest), SigningTime, X509IssuerName, X509SerialNumber
 *
 * @param {string} invoiceXml - Original invoice (before removing tags)
 * @param {Object} values - { digestValue, signingTime, issuerName, serialNumber }
 * @returns {string} Updated invoice XML
 */
function populateSignedPropertiesInXml(invoiceXml, values) {
  const { digestValue, signingTime, issuerName, serialNumber } = values;

  const parser = new DOMParser({
    locator: {},
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e; } },
  });
  const doc = parser.parseFromString(invoiceXml, 'application/xml');

  const setText = (xpathExpr, text) => {
    const nodes = select(xpathExpr, doc);
    const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
    for (const node of list) {
      if (node && node.nodeType === 1) {
        node.textContent = String(text ?? '');
      }
    }
  };

  setText("//xades:CertDigest/ds:DigestValue", digestValue);
  setText("//xades:SigningTime", signingTime);
  setText("//xades:IssuerSerial/ds:X509IssuerName", issuerName);
  setText("//xades:IssuerSerial/ds:X509SerialNumber", serialNumber);

  return new XMLSerializer().serializeToString(doc);
}

module.exports = {
  extractCertificateInfo,
  buildSignedPropertiesValues,
  buildSignedPropertiesXML,
  generateSignedPropertiesHash,
  populateSignedPropertiesInXml,
  getSigningTime,
  getCertDer,
};
