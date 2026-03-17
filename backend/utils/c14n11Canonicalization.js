/**
 * C14N11 (Canonical XML Version 1.1) - ZATCA-compliant canonicalization
 * Algorithm URI: http://www.w3.org/2006/12/xml-c14n11
 *
 * ZATCA explicitly specifies C14N11 for invoice hashing. This extends
 * the C14N 1.0 algorithm (identical output for UBL invoices without
 * xml:id/xml:base) with the correct C14N11 algorithm identifier for
 * ZATCA Sandbox validation.
 *
 * See: https://www.w3.org/TR/xml-c14n11/
 */

const { C14nCanonicalization } = require('xml-crypto');

const C14N11_ALGORITHM_URI = 'http://www.w3.org/2006/12/xml-c14n11';

class C14n11Canonicalization extends C14nCanonicalization {
  getAlgorithmName() {
    return C14N11_ALGORITHM_URI;
  }
}

module.exports = { C14n11Canonicalization, C14N11_ALGORITHM_URI };
