const express = require('express');
const authQbo = require('../middleware/authQbo');
const {
  getCustomers,
  getSupplierInfo,
  getCustomerById,
  getSalesReceipt,
  getRefundReceipts,
  getInvoices,
  getCreditMemo
} = require('../controllers/qboController');

const qboRouter = express.Router();

qboRouter.get('/customers', authQbo, getCustomers);
qboRouter.get('/supplier-info', authQbo, getSupplierInfo);
qboRouter.get('/customer/:id', authQbo, getCustomerById);
qboRouter.get('/salesreceipt', authQbo, getSalesReceipt);
qboRouter.get('/refundreceipts', authQbo, getRefundReceipts);
qboRouter.get('/invoices', authQbo, getInvoices);
qboRouter.get('/creditmemo', authQbo, getCreditMemo);

module.exports = qboRouter;
