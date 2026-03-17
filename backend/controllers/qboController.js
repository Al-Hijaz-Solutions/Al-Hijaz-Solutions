/**
 * QBO Controller - Handles QuickBooks Online API requests.
 * Uses req.realmId and req.oauthclient from authQbo middleware.
 */

/**
 * Shared helper to fetch an entity from QuickBooks.
 * @param {object} oauthclient - OAuth2 client
 * @param {string} realmId - Company realm ID
 * @param {string} entity - e.g. 'SalesReceipt', 'RefundReceipt', 'Invoice', 'CreditMemo'
 * @param {number} minorVersion - API minor version (default 75)
 */
async function fetchQBOEntity(oauthclient, realmId, entity, minorVersion = 75) {
  const baseUrl = 'https://quickbooks.api.intuit.com';

  const query = `SELECT * FROM ${entity}`;
  const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${minorVersion}`;

  console.log(`--- Fetching ${entity} ---`);
  console.log('URL:', url);

  const response = await oauthclient.makeApiCall({
    url,
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  console.log('Response Status:', response.status);

  if (response.status !== 200) {
    const err = new Error(`QuickBooks API Error: ${response.body}`);
    err.status = response.status;
    throw err;
  }

  if (!response.body) {
    return { QueryResponse: {} };
  }

  return JSON.parse(response.body);
}

/**
 * Fetch a specific page of records from QuickBooks.
 * Returns { records, totalCount }
 */
async function fetchPaginatedFromQBO(oauthclient, realmId, entity, page = 1, limit = 50, customerId = null, minorVersion = 75) {
  const baseUrl = 'https://quickbooks.api.intuit.com';
  const startPosition = (page - 1) * limit + 1;
  const whereClause = customerId ? `WHERE CustomerRef = '${customerId}'` : '';
  
  // 1. Get total count
  const countQuery = `SELECT count(*) FROM ${entity} ${whereClause}`;
  const countUrl = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(countQuery)}&minorversion=${minorVersion}`;
  const countRes = await oauthclient.makeApiCall({
    url: countUrl,
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (countRes.status !== 200) {
    const err = new Error(`QuickBooks API Error (count): ${countRes.body}`);
    err.status = countRes.status;
    throw err;
  }

  const countData = JSON.parse(countRes.body);
  const totalCount = countData.QueryResponse.totalCount || 0;

  if (totalCount === 0) return { records: [], totalCount: 0 };

  // 2. Fetch the specific page
  let baseQuery = `SELECT * FROM ${entity} ${whereClause}`;
  if (entity === 'Invoice' || entity === 'CreditMemo') {
    baseQuery = `SELECT * FROM ${entity} ${whereClause} ORDER BY MetaData.CreateTime DESC`;
  }
  const query = `${baseQuery} STARTPOSITION ${startPosition} MAXRESULTS ${limit}`;
  const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${minorVersion}`;
  
  console.log(`--- Fetching ${entity} Page ${page} (Start: ${startPosition}) ---`);
  const response = await oauthclient.makeApiCall({
    url,
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (response.status !== 200) {
    const err = new Error(`QuickBooks API Error (data): ${response.body}`);
    err.status = response.status;
    throw err;
  }

  const data = JSON.parse(response.body);
  const records = data.QueryResponse?.[entity] || [];

  return { records, totalCount };
}

/**
 * Fetch all records from QuickBooks concurrently to massively speed up data retrieval.
 * Supports optional customerId filtering.
 */
async function fetchAllFromQBO(oauthclient, realmId, entity, minorVersion = 75, customerId = null) {
  const baseUrl = 'https://quickbooks.api.intuit.com';
  const maxResults = 1000;
  
  const whereClause = customerId ? `WHERE CustomerRef = '${customerId}'` : '';
  
  // 1. Get total count first
  const countQuery = `SELECT count(*) FROM ${entity} ${whereClause}`;
  const countUrl = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(countQuery)}&minorversion=${minorVersion}`;
  console.log(`--- Fetching ${entity} Total Count ${whereClause} ---`);
  const countRes = await oauthclient.makeApiCall({
    url: countUrl,
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (countRes.status !== 200) {
    const err = new Error(`QuickBooks API Error: ${countRes.body}`);
    err.status = countRes.status;
    throw err;
  }

  const countData = JSON.parse(countRes.body);
  const totalCount = countData.QueryResponse.totalCount || 0;
  console.log(`--- Total ${entity} Count: ${totalCount} ---`);

  if (totalCount === 0) return [];

  // 2. Build the array of promises (batches of 1000)
  const numRequests = Math.ceil(totalCount / maxResults);
  const promises = [];

  for (let i = 0; i < numRequests; i++) {
    const startPosition = i * maxResults + 1;
    let baseQuery = `SELECT * FROM ${entity} ${whereClause}`;
    
    // Sort Invoices & CreditMemos newest first natively at QBO level if possible
    if (entity === 'Invoice' || entity === 'CreditMemo') {
      baseQuery = `SELECT * FROM ${entity} ${whereClause} ORDER BY MetaData.CreateTime DESC`;
    }

    const query = `${baseQuery} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${minorVersion}`;
    
    console.log(`--- Fetching ${entity} (Start: ${startPosition}) ---`);
    promises.push(
      oauthclient.makeApiCall({
        url,
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    );
  }

  // 3. Await all batches simultaneously
  const responses = await Promise.all(promises);
  
  let allRecords = [];
  for (const response of responses) {
    if (response.status !== 200) {
      console.error(`QuickBooks Chunk Error: ${response.body}`);
      continue;
    }
    const data = JSON.parse(response.body);
    const records = data.QueryResponse?.[entity] || [];
    allRecords = allRecords.concat(records);
  }

  return allRecords;
}

/**
 * GET /customers
 */
async function getCustomers(req, res) {
  try {
    const { realmId, oauthclient } = req;
    const customers = await fetchAllFromQBO(oauthclient, realmId, 'Customer', 75);
    console.log(`--- Total Customers Fetched: ${customers.length} ---`);
    res.json({ QueryResponse: { Customer: customers } });
  } catch (e) {
    console.error('Fetch Customers Error:', e);
    res.status(e.status || 500).json({
      error: e.message,
      ...(e.status && { status: e.status })
    });
  }
}

const { getSupplierFromEnv } = require('../config/supplierConfig');

/**
 * GET /supplier-info - Seller data from .env (no QuickBooks API)
 */
async function getSupplierInfo(req, res) {
  try {
    const s = getSupplierFromEnv();
    res.json({
      name: s.name,
      vat: s.vatNumber,
      building: s.buildingNumber,
      street: s.street,
      city: s.city,
      postal: s.postalCode,
    });
  } catch (e) {
    console.error('Supplier Info Error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /customer/:id
 */
async function getCustomerById(req, res) {
  try {
    const { realmId, oauthclient } = req;
    const baseUrl = 'https://quickbooks.api.intuit.com';
    const url = `${baseUrl}/v3/company/${realmId}/customer/${req.params.id}?minorversion=70&include=enhancedAllCustomFields`;
    console.log(`--- Fetching Customer Info (Enhanced): ${url} ---`);
    const response = await oauthclient.makeApiCall({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    console.log('customer data')
    const data = JSON.parse(response.body);

    console.log(JSON.stringify(data.Customer.CustomField, null, 2));
    res.json(JSON.parse(response.body));
  } catch (e) {
    console.error('Customer By Id Error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /salesreceipt
 */
async function getSalesReceipt(req, res) {
  try {
    const { realmId, oauthclient } = req;
    const data = await fetchQBOEntity(oauthclient, realmId, 'SalesReceipt', 75);
    res.json(data);
  } catch (e) {
    console.error('SalesReceipt Error:', e);
    res.status(e.status || 500).json({
      error: e.message,
      ...(e.status && { status: e.status })
    });
  }
}

/**
 * GET /refundreceipts
 */
async function getRefundReceipts(req, res) {
  try {
    const { realmId, oauthclient } = req;
    const data = await fetchQBOEntity(oauthclient, realmId, 'RefundReceipt', 75);
    res.json(data);
  } catch (e) {
    console.error('RefundReceipt Error:', e);
    res.status(e.status || 500).json({
      error: e.message,
      ...(e.status && { status: e.status })
    });
  }
}

/**
 * GET /invoices - Fetches all Invoice records with pagination to match QuickBooks list.
 */
async function getInvoices(req, res) {
  try {
    const { realmId, oauthclient } = req;
    const { customerId, page = 1, limit = 50 } = req.query;
    if (!customerId) {
        return res.json({ QueryResponse: { Invoice: [], totalCount: 0 } });
    }
    const { records, totalCount } = await fetchPaginatedFromQBO(oauthclient, realmId, 'Invoice', parseInt(page), parseInt(limit), customerId, 75);
    console.log(`--- Total Invoices for ${customerId}: ${totalCount}, Sent ${records.length} (Page ${page}) ---`);
    res.json({ QueryResponse: { Invoice: records, totalCount } });
  } catch (e) {
    console.error('Invoices Error:', e);
    res.status(e.status || 500).json({
      error: e.message,
      ...(e.status && { status: e.status })
    });
  }
}

/**
 * GET /creditmemo - Fetches all CreditMemo records with pagination to match QuickBooks list.
 */
async function getCreditMemo(req, res) {
  try {
    const { realmId, oauthclient } = req;
    const { customerId, page = 1, limit = 50 } = req.query;
    if (!customerId) {
        return res.json({ QueryResponse: { CreditMemo: [], totalCount: 0 } });
    }
    const { records, totalCount } = await fetchPaginatedFromQBO(oauthclient, realmId, 'CreditMemo', parseInt(page), parseInt(limit), customerId, 65);
    console.log(`--- Total Credit Memos for ${customerId}: ${totalCount}, Sent ${records.length} (Page ${page}) ---`);
    res.json({ QueryResponse: { CreditMemo: records, totalCount } });
  } catch (e) {
    console.error('CreditMemo Error:', e);
    res.status(e.status || 500).json({
      error: e.message,
      ...(e.status && { status: e.status })
    });
  }
}

module.exports = {
  getCustomers,
  getSupplierInfo,
  getCustomerById,
  getSalesReceipt,
  getRefundReceipts,
  getInvoices,
  getCreditMemo
};
