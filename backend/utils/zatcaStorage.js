/**
 * ZATCA submissions storage using Mongoose.
 * Tracks ICV (Invoice Counter Value), PIH (Previous Invoice Hash), and submission status.
 * Uses zatca_connector.submissions collection.
 * Requires connectDB from config/mongodb to be called at app startup.
 */

const Submission = require('../models/Submission');

/** ZATCA first invoice PIH: base64(SHA256("0")) */
const ZATCA_FIRST_INVOICE_HASH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

/**
 * Get the next ICV (Invoice Counter Value).
 * Only counts CLEARED submissions for the chain.
 */
async function getNextICV() {
  const cleared = await Submission.find({ 
    zatcaStatus: { $in: ['CLEARED', 'SUBMITTING'] } 
  }).lean();
  const maxIcv = cleared.length > 0
    ? Math.max(...cleared.map((s) => s.icv || 0))
    : 0;
  return maxIcv + 1;
}

/**
 * Get the previous invoice hash (base64) for PIH.
 * Returns ZATCA first-invoice constant if no previous CLEARED/SUBMITTING submission.
 */
async function getLastInvoiceHash() {
  const last = await Submission.findOne({ 
    zatcaStatus: { $in: ['CLEARED', 'SUBMITTING'] } 
  })
    .sort({ icv: -1, submittedAt: -1 })
    .select('invoiceHashBase64')
    .lean();
  if (!last || !last.invoiceHashBase64) return ZATCA_FIRST_INVOICE_HASH;
  return last.invoiceHashBase64;
}

/**
 * Get the last submission (regardless of status).
 */
async function getLastSubmission() {
  return Submission.findOne({})
    .sort({ icv: -1, submittedAt: -1 })
    .lean();
}



/**
 * Save a submission record. Call on successful ZATCA CLEARED response.
 * uuid must match the <cbc:UUID> in the invoice XML (single source of truth).
 * @param {Object} record - Must include uuid, qboInvoiceId, invoiceNumber, icv, invoiceHashBase64, previousInvoiceHash, zatcaStatus, submittedAt. Optional: qrCodeBase64, zatcaResponse
 */
async function saveSubmission(record) {
  if (!record.uuid || typeof record.uuid !== 'string') {
    throw new Error('saveSubmission requires uuid (must match invoice <cbc:UUID>)');
  }

  const entry = {
    uuid: record.uuid,
    qboInvoiceId: String(record.qboInvoiceId),
    invoiceNumber: String(record.invoiceNumber),
    icv: record.icv,
    invoiceHashBase64: record.invoiceHashBase64,
    previousInvoiceHash: record.previousInvoiceHash,
    qrCodeBase64: record.qrCodeBase64 || null,
    zatcaStatus: record.zatcaStatus,
    zatcaResponse: record.zatcaResponse || null,
    clearedInvoice: record.clearedInvoice || null,
    submittedAt: record.submittedAt ? new Date(record.submittedAt) : new Date(),
  };

  await Submission.findOneAndUpdate(
    {
      $or: [
        { qboInvoiceId: String(record.qboInvoiceId) },
        { invoiceNumber: String(record.invoiceNumber) },
      ],
    },
    { $set: entry },
    { upsert: true, returnDocument: 'after' }
  );
}

/**
 * Get ZATCA status for an invoice by QBO ID or invoice number.
 */
async function getStatusForInvoice(qboInvoiceId, invoiceNumber) {
  const doc = await Submission.findOne({
    $or: [
      { qboInvoiceId: String(qboInvoiceId) },
      { invoiceNumber: String(invoiceNumber) },
    ],
  })
    .select('zatcaStatus')
    .lean();
  return doc ? doc.zatcaStatus : null;
}

/**
 * Get all submissions (for status lookup by invoice list).
 */
async function getAllSubmissions() {
  return Submission.find({}).lean();
}

/**
 * Get status map for multiple invoice numbers.
 * @param {string[]} invoiceNumbers - Array of invoice numbers (e.g. DocNumber)
 * @returns {Object} { invoiceNumber: status } e.g. { "JD26000093": "CLEARED", "JD26000094": null }
 */
async function getStatusMap(invoiceNumbers) {
  const list = (invoiceNumbers || []).map((n) => String(n || '').trim()).filter(Boolean);
  if (list.length === 0) return {};

  const docs = await Submission.find({
    $or: [{ invoiceNumber: { $in: list } }, { qboInvoiceId: { $in: list } }],
  }).lean();

  const map = {};
  for (const n of list) map[n] = null;
  for (const d of docs) {
    if (d.invoiceNumber && list.includes(String(d.invoiceNumber))) {
      map[String(d.invoiceNumber)] = d.zatcaStatus;
    }
    if (d.qboInvoiceId && list.includes(String(d.qboInvoiceId))) {
      map[String(d.qboInvoiceId)] = d.zatcaStatus;
    }
  }
  return map;
}

/**
 * Close MongoDB connection (for graceful shutdown).
 */
async function closeConnection() {
  const mongoose = require('mongoose');
  await mongoose.disconnect();
}

module.exports = {
  getNextICV,
  getLastInvoiceHash,
  saveSubmission,
  getStatusForInvoice,
  getAllSubmissions,
  getStatusMap,
  closeConnection,
  ZATCA_FIRST_INVOICE_HASH,
};
