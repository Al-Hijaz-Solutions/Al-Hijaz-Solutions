/**
 * ZATCA Compliance Invoices API
 * POST /e-invoicing/developer-portal/compliance/invoices
 *
 * Submits a signed invoice to ZATCA Fatoora for compliance check.
 * Uses Basic auth: base64(certificateBase64 + ":" + secret)
 * where certificateBase64 is from Binary_Security_Token (compliance cert).
 */

// const INVOICES_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance/invoices';
// const INVOICES_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance/invoices';

const INVOICES_URL =
  "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/clearance/single";

// const INVOICES_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/clearance';

/**
 * Build Basic auth header for ZATCA compliance/invoices.
 * Username = binarySecurityToken, Password = secret
 * Format: base64(binarySecurityToken + ":" + secret)
 *
 * @param {string} binarySecurityToken - Compliance cert from ZATCA (passed as-is)
 * @param {string} secret - Secret from compliance CSR response (passed as-is)
 * @returns {string} "Basic <base64>"
 */
function buildBasicAuth(binarySecurityToken, secret) {
  if (!binarySecurityToken || !secret) {
    throw new Error("binarySecurityToken and secret are required");
  }
  const credentials = binarySecurityToken + ":" + secret;
  return "Basic " + Buffer.from(credentials, "utf8").toString("base64");
}

/**
 * Extract UUID from invoice XML (cbc:UUID)
 */
function extractUuid(invoiceXml) {
  const match = String(invoiceXml || "").match(
    /<cbc:UUID[^>]*>([^<]+)<\/cbc:UUID>/i,
  );
  return match ? match[1].trim() : null;
}

/**
 * Submit signed invoice to ZATCA compliance
 *
 * @param {Object} options
 * @param {string} options.signedInvoiceXml - Full signed invoice XML (string)
 * @param {string} options.invoiceHashBase64 - Step 1 invoice hash (base64)
 * @param {string} [options.uuid] - Invoice UUID; auto-extracted from XML if omitted
 * @param {string} options.binarySecurityToken - Compliance cert (from .env)
 * @param {string} options.secret - Compliance secret (from .env)
 * @returns {Promise<Object>} { success, status, data }
 */
async function submitInvoiceToZatca(options) {
  const {
    signedInvoiceXml,
    invoiceHashBase64,
    uuid: providedUuid,
    binarySecurityToken,
    secret,
  } = options;

  if (!signedInvoiceXml) throw new Error("signedInvoiceXml is required");
  if (!invoiceHashBase64) throw new Error("invoiceHashBase64 is required");
  if (!binarySecurityToken) throw new Error("binarySecurityToken is required");
  if (!secret) throw new Error("secret is required");

  const uuid = providedUuid || extractUuid(signedInvoiceXml);
  if (!uuid)
    throw new Error("UUID not found in invoice; provide uuid in options");

  const auth = buildBasicAuth(binarySecurityToken, secret);
  const invoiceBase64 = Buffer.from(signedInvoiceXml, "utf8").toString(
    "base64",
  );

  const body = JSON.stringify({
    invoiceHash: invoiceHashBase64.trim(),
    uuid,
    invoice: invoiceBase64,
  });

  const response = await fetch(INVOICES_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Accept-Language": "en",
      "Accept-Version": "V2",
      Authorization: auth,
      "Clearance-Status": "1",
      "Content-Type": "application/json",
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  const success = response.ok;

  return {
    success,
    status: response.status,
    statusText: response.statusText,
    data,
  };
}

module.exports = {
  submitInvoiceToZatca,
  buildBasicAuth,
  extractUuid,
  INVOICES_URL,
};
