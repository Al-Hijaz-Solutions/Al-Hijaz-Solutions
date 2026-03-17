/**
 * Generate Invoice Hash - Step 1 of ZATCA Invoice Signing Process
 *
 * Steps:
 * 1. Keep a copy of the original invoice
 * 2. Remove UBLExtensions, QR AdditionalDocumentReference, Signature (per XPath)
 * 3. Remove the XML declaration
 * 4. Canonicalize using C14N11 (ZATCA-specified standard)
 * 5. Hash the canonical body using SHA-256 (hex output)
 * 6. Encode the hash in base64
 */

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const crypto = require('crypto');
const { C14n11Canonicalization } = require('./c14n11Canonicalization');

// UBL 2.1 namespace mappings for namespace-aware XPath (ZATCA-compliant)
const UBL_NAMESPACES = {
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  udt: 'urn:oasis:names:specification:ubl:schema:xsd:UnqualifiedDataTypes-2',
};

// XPath expressions for tags to remove (per ZATCA spec) - namespace-aware
// UBLExtensions (plural) = wrapper; UBLExtension (singular) = when no wrapper (e.g. ublGenerator output)
const XPATH_UBLEXTENSIONS = '//ext:UBLExtensions';
const XPATH_UBLEXTENSION = '//ext:UBLExtension';
const XPATH_QR_REFERENCE = "//cac:AdditionalDocumentReference[cbc:ID[normalize-space(text())='QR']]";
const XPATH_SIGNATURE = '//cac:Signature';

/** Namespace-aware XPath select function */
const select = xpath.useNamespaces(UBL_NAMESPACES);

/**
 * Remove elements matching the given XPath from the document.
 * Uses namespace-aware XPath for robust handling of UBL structures.
 */
function removeElementsByXPath(doc, xpathExpr) {
  const nodes = select(xpathExpr, doc);
  const nodeList = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  for (const node of nodeList) {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
}

/**
 * Strip the XML declaration (<?xml version="1.0" encoding="UTF-8"?>) from a string.
 */
function stripXmlDeclaration(xmlString) {
  return xmlString.replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trim();
}

/**
 * Generate invoice hash from UBL invoice XML.
 *
 * @param {string} invoiceXml - Full UBL 2.1 invoice XML (with or without XML declaration)
 * @returns {Object} {
 *   invoiceHashHex: string,      // SHA-256 hash in hexadecimal
 *   invoiceHashBase64: string,   // SHA-256 hash in base64 (for later steps)
 *   originalInvoice: string,     // Copy of original before modifications
 *   strippedXml: string,         // XML after removing UBLExtensions, QR, Signature
 *   canonicalXml: string,        // C14N canonical form (used for hashing)
 * }
 */
function generateInvoiceHash(invoiceXml) {
  const originalInvoice = String(invoiceXml).trim();

  const parser = new DOMParser({
    locator: {},
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e; } },
  });

  const doc = parser.parseFromString(originalInvoice, 'application/xml');

  // Check for parse errors
  const parseError = doc.documentElement?.tagName === 'parsererror';
  if (parseError) {
    throw new Error(`Invalid XML: ${doc.documentElement?.textContent || 'Parse failed'}`);
  }

  // Step 2: Remove UBLExtensions (or UBLExtension when no wrapper), QR, Signature
  removeElementsByXPath(doc, XPATH_UBLEXTENSIONS);
  removeElementsByXPath(doc, XPATH_UBLEXTENSION);
  removeElementsByXPath(doc, XPATH_QR_REFERENCE);
  removeElementsByXPath(doc, XPATH_SIGNATURE);

  // Step 3: Serialize (with declaration for saving; without for hash)
  const serializer = new XMLSerializer();
  const invoiceAfterRemoval = serializer.serializeToString(doc);
  let strippedXml = stripXmlDeclaration(invoiceAfterRemoval);

  // Step 4: Canonicalize using C14N11 (ZATCA-specified standard)
  const c14n = new C14n11Canonicalization();
  const canonicalXml = c14n.process(doc.documentElement, {});

  // Step 5: Hash the canonical body using SHA-256 (hex output)
  const hashBuffer = crypto.createHash('sha256').update(canonicalXml, 'utf8').digest();
  const invoiceHashHex = hashBuffer.toString('hex');

  // Step 6: Encode the hashed invoice (raw buffer) using base64
  const invoiceHashBase64 = hashBuffer.toString('base64');

  return {
    invoiceHashHex,
    hashBuffer,
    invoiceHashBase64,
    originalInvoice,
    invoiceAfterRemoval, // XML after removing UBLExtensions, QR, Signature (for saving)
    strippedXml,
    canonicalXml,
  };
}

module.exports = { generateInvoiceHash };
