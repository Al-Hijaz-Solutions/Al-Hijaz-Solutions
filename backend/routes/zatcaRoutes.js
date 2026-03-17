const express = require('express');
const authQbo = require('../middleware/authQbo');
const { getStatus, submitInvoice } = require('../controllers/zatcaController');

const zatcaRouter = express.Router();

zatcaRouter.get('/status', authQbo, getStatus);
zatcaRouter.post('/status', authQbo, getStatus);
zatcaRouter.post('/submit', authQbo, submitInvoice);
// zatcaRouter.post('/preview-xml', authQbo, previewXml);
// zatcaRouter.post('/production-csids', productionCsids);

module.exports = zatcaRouter;
