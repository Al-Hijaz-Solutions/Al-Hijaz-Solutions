/**
 * Supplier (seller) data from .env - no API calls.
 * Used for ZATCA XML and preview UI.
 *
 * IMPORTANT: SUPPLIER_VAT must match the VAT number in your ZATCA certificate (Production CSID).
 * ZATCA returns "User only allowed to use the vat number that exists in the authentication certificate"
 * if the invoice seller VAT does not match the cert.
 */
function getSupplierFromEnv() {
  return {
    name: process.env.SUPPLIER_NAME || process.env.SELLER_NAME,
    // vatNumber: process.env.SUPPLIER_VAT || '302071225900003',
    vatNumber: '399999999900003',
    crn: process.env.SUPPLIER_CRN || process.env.SELLER_CRN,
    street: process.env.SUPPLIER_STREET || process.env.SELLER_STREET,
    buildingNumber: process.env.SUPPLIER_BUILDING_NUMBER || process.env.SELLER_BUILDING_NUMBER,
    neighborhood: process.env.SUPPLIER_NEIGHBORHOOD || process.env.SELLER_NEIGHBORHOOD,
    city: process.env.SUPPLIER_CITY || process.env.SELLER_CITY,
    postalCode: process.env.SUPPLIER_POSTAL_CODE || process.env.SELLER_POSTAL_CODE,
  };
}

module.exports = { getSupplierFromEnv };
