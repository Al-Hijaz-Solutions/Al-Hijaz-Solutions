const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const zatcaStorage = require('../utils/zatcaStorage');

const { mapQBOInvoiceToZatca } = require('../utils/qboMapper');
const { generateZatcaXML } = require('../utils/ublGenerator');
const { generateInvoiceHash } = require('../utils/invoiceHash');
const { generateDigitalSignature } = require('../utils/invoiceSign');
const { generateCertificateHash } = require('../utils/certificateHash');
const {
  buildSignedPropertiesValues,
  populateSignedPropertiesInXml,
  generateSignedPropertiesHash,
} = require('../utils/signedProperties');
const { populateUblExtensions } = require('../utils/populateUblExtensions');
const { submitInvoiceToZatca } = require('../api/submitInvoiceAPI');
// const { requestProductionCsid } = require('../api/productionCsidOnboarding');
const { generateZatcaQrBase64 } = require('../qrcode/zatcaQr');

const BASE_DIR = process.env.VERCEL
  ? path.join(process.env.TMPDIR || '/tmp', 'generated_xmls')
  : path.join(__dirname, '..', 'generated_xmls');

const getStatus = async (req, res) => {
  const invoiceNumbers = req.body.invoiceNumbers || req.query.invoiceNumbers;
  if (!invoiceNumbers) {
    return res.json({});
  }
  try {
    let list = [];
    if (Array.isArray(invoiceNumbers)) {
      list = invoiceNumbers.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof invoiceNumbers === 'string') {
      list = invoiceNumbers.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const map = await zatcaStorage.getStatusMap(list);
    res.json(map);
  } catch (e) {
    console.error('ZATCA status error:', e);
    res.status(500).json({ error: 'Failed to fetch ZATCA status' });
  }
};

const submitInvoice = async (req, res) => {
  const { invoiceId, invoiceNumber, invoiceData, invoice, customerId, isCreditNote, invoiceDocumentReference, instructionNote } = req.body;
  const targetInvoice = invoice || invoiceData;

  console.log(`--- ZATCA Submission Process Started for ${isCreditNote ? 'Credit Note' : 'Invoice'}: ${invoiceNumber} ---`);

  try {
    if (!targetInvoice) {
      return res.json({
        success: true,
        status: 'SAVED',
        message: 'No invoice data provided.',
        savedPath: BASE_DIR,
        timestamp: new Date().toISOString(),
      });
    }

    console.log('--- Invoice Data ---', JSON.stringify(targetInvoice, null, 2));

    const docNumber = targetInvoice.DocNumber || invoiceNumber || 'invoice';
    const existingStatus = await zatcaStorage.getStatusForInvoice(targetInvoice.Id, docNumber);

    if (existingStatus === 'CLEARED') {
      return res.status(400).json({
        error: 'Invoice already submitted',
        message: `Invoice ${docNumber} has already been submitted to ZATCA and cleared.`,
        status: 'CLEARED',
      });
    }

    // --- NEW: SUBMITTING GUARD ---
    // Check if there is a global "SUBMITTING" record that is not this invoice.
    // This prevents generating a new invoice while the previous one is in an unknown state.

    const lastSub = await zatcaStorage.getLastSubmission();
    if (lastSub && lastSub.zatcaStatus === 'SUBMITTING' && lastSub.invoiceNumber !== String(docNumber)) {
      return res.status(409).json({
        error: 'Chain Blocked',
        message: `A previous submission (Invoice ${lastSub.invoiceNumber}) is stuck in 'SUBMITTING' state. Please resolve its status before submitting a new invoice.`,
        status: 'SUBMITTING_BLOCKED',
        blockedInvoice: lastSub.invoiceNumber
      });
    }



    console.log(`--- Submitting Invoice: ${targetInvoice.DocNumber} ---`);

    const { realmId, oauthclient } = req;

    const baseUrl = 'https://quickbooks.api.intuit.com';
    const custId = customerId || targetInvoice.CustomerRef?.value;
    const customerUrl = `${baseUrl}/v3/company/${realmId}/customer/${custId}?minorversion=70&include=enhancedAllCustomFields`;
    const customerResponse = await oauthclient.makeApiCall({ url: customerUrl, method: 'GET', headers: { Accept: 'application/json' } });
    const customerInfo = JSON.parse(customerResponse.body).Customer;

    let nextICV;
    let previousInvoiceHash;
    let invoiceUuid;

    // --- REUSE DB PARAMETERS IF RETRYING A SUBMITTING INVOICE ---
    if (lastSub && lastSub.invoiceNumber === String(docNumber) && lastSub.zatcaStatus === 'SUBMITTING') {
      console.log(`--- Resuming interrupted submission for Invoice: ${docNumber} ---`);
      nextICV = lastSub.icv;
      previousInvoiceHash = lastSub.previousInvoiceHash;
      invoiceUuid = lastSub.uuid;
    } else {
      // NEW INVOICE - GENERATE FRESH
      nextICV = await zatcaStorage.getNextICV();
      previousInvoiceHash = await zatcaStorage.getLastInvoiceHash();
      invoiceUuid = crypto.randomUUID();
      console.log(`--- New submission parameters generated - ICV: ${nextICV}, PIH: ${previousInvoiceHash.substring(0, 10)}... ---`);
    }

    const zatcaData = mapQBOInvoiceToZatca(targetInvoice, customerInfo);
    zatcaData.icv = String(nextICV);
    zatcaData.previousInvoiceHash = previousInvoiceHash;
    zatcaData.uuid = invoiceUuid;


    if (isCreditNote) {
      zatcaData.invoiceType = '381';
      zatcaData.invoiceDocumentReference = invoiceDocumentReference || '';
      zatcaData.instructionNote = instructionNote || '';
    }

    const xml = generateZatcaXML(zatcaData);
    const result = generateInvoiceHash(xml);

    const folderPath = path.join(BASE_DIR, String(docNumber));
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    fs.writeFileSync(path.join(folderPath, 'invoiceHash.txt'), `hex: ${result.invoiceHashHex}\nbase64: ${result.invoiceHashBase64}`, 'utf8');
    console.log(`--- Step 1 Hash saved to: ${folderPath} ---`);

    const digitalSignature = generateDigitalSignature({
      canonicalXml: result.canonicalXml,
      privateKey: process.env.ZATCA_PRIVATE_KEY || process.env.private_key,
      hashBuffer: result.hashBuffer,
    });

    const token = process.env.BINARY_SECURITY_TOKEN || process.env.Binary_Security_Token;
    if (!token) {
      throw new Error('Binary_Security_Token or BINARY_SECURITY_TOKEN required in .env for Steps 3-4');
    }

    const step3 = generateCertificateHash(token);
    const step4Values = buildSignedPropertiesValues({
      certificateHashBase64: step3.certificateHashBase64,
      binarySecurityToken: token,
    });
    const xmlWithSignedProps = populateSignedPropertiesInXml(xml, step4Values);

    const step5 = generateSignedPropertiesHash({
      certificateHashBase64: step3.certificateHashBase64,
      binarySecurityToken: token,
    });

    const qrCodeBase64 = generateZatcaQrBase64({
      zatcaData,
      invoiceHashBase64: result.invoiceHashBase64,
      digitalSignature,
      binarySecurityToken: token,
    });

    const signedInvoiceXml = populateUblExtensions({
      invoiceXml: xmlWithSignedProps,
      invoiceHashBase64: result.invoiceHashBase64,
      signatureValue: digitalSignature,
      binarySecurityToken: token,
      signedPropertiesHashBase64: step5.signedPropertiesHashBase64,
      signedPropertiesValues: step4Values,
      qrCodeBase64,
    });
    fs.writeFileSync(path.join(folderPath, 'signedInvoice.xml'), signedInvoiceXml, 'utf8');
    console.log('--- Step 6: UBL Extensions populated (incl. QR) ---');

    const secret = (process.env.ZATCA_SECRET || process.env.secret || process.env.SECRET || '').trim().replace(/^['"]|['"]$/g, '');
    if (secret) {
      try {
        // --- PRE-SAVE AS SUBMITTING ---
        // Record intent to ensure PIH chain is maintained even after timeout
        await zatcaStorage.saveSubmission({
          uuid: invoiceUuid,
          qboInvoiceId: targetInvoice.Id,
          invoiceNumber: targetInvoice.DocNumber || invoiceNumber,
          icv: nextICV,
          invoiceHashBase64: result.invoiceHashBase64,
          previousInvoiceHash,
          qrCodeBase64,
          zatcaStatus: 'SUBMITTING',
          submittedAt: new Date().toISOString(),
        });

        console.log('--- Step 7: Submitting to ZATCA Compliance API ---');
        const complianceResult = await submitInvoiceToZatca({
          signedInvoiceXml,
          invoiceHashBase64: result.invoiceHashBase64,
          binarySecurityToken: token,
          secret,
        });

        // Debug: store ZATCA response in JSON file
        const debugPath = path.join(folderPath, 'zatca-response-debug.json');
        fs.writeFileSync(debugPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          success: complianceResult.success,
          status: complianceResult.status,
          statusText: complianceResult.statusText,
          data: complianceResult.data,
        }, null, 2), 'utf8');

        if (complianceResult.success) {
          console.log('--- ZATCA Compliance: SUCCESS ---');

          if (complianceResult.data && complianceResult.data.clearedInvoice) {
            const clearedXml = Buffer.from(complianceResult.data.clearedInvoice, 'base64').toString('utf8');
            fs.writeFileSync(path.join(folderPath, 'clearedInvoice.xml'), clearedXml, 'utf8');
          }

          await zatcaStorage.saveSubmission({
            uuid: invoiceUuid,
            qboInvoiceId: targetInvoice.Id,
            invoiceNumber: targetInvoice.DocNumber || invoiceNumber,
            icv: nextICV,
            invoiceHashBase64: result.invoiceHashBase64,
            previousInvoiceHash,
            qrCodeBase64,
            zatcaStatus: 'CLEARED',
            zatcaResponse: complianceResult.data,
            clearedInvoice: complianceResult.data.clearedInvoice,
            submittedAt: new Date().toISOString(),
          });

          return res.json({
            success: true,
            status: 'CLEARED',
            message: 'Invoice signed and submitted to ZATCA compliance successfully',
            zatcaResponse: complianceResult.data,
            savedPath: folderPath,
            timestamp: new Date().toISOString(),
          });
        }

        console.error('--- ZATCA Compliance: FAILED ---', complianceResult.status, complianceResult.statusText);

        // Final update to REJECTED so it doesn't block the next attempt
        await zatcaStorage.saveSubmission({
          uuid: invoiceUuid,
          qboInvoiceId: targetInvoice.Id,
          invoiceNumber: targetInvoice.DocNumber || invoiceNumber,
          icv: nextICV,
          invoiceHashBase64: result.invoiceHashBase64,
          previousInvoiceHash,
          zatcaStatus: 'ZATCA_REJECTED',
          zatcaResponse: complianceResult.data,
          submittedAt: new Date().toISOString(),
        });

        return res.status(502).json({
          success: false,
          status: 'ZATCA_REJECTED',
          message: 'Invoice signed and saved, but ZATCA compliance check failed',
          zatcaStatus: complianceResult.status,
          zatcaResponse: complianceResult.data,
          savedPath: folderPath,
          timestamp: new Date().toISOString(),
        });
      } catch (apiErr) {
        console.error('--- ZATCA Compliance API Error ---', apiErr.message);
        return res.status(502).json({
          success: false,
          status: 'ZATCA_ERROR',
          message: 'Invoice signed and saved, but ZATCA API call failed',
          error: apiErr.message,
          savedPath: folderPath,
          timestamp: new Date().toISOString(),
        });
      }
    }


    console.log('--- Step 7 skipped: No secret in .env for ZATCA submission ---');

    res.json({
      success: true,
      status: 'SAVED',
      message: 'Invoice signed and saved. Add secret to .env to submit to ZATCA.',
      savedPath: BASE_DIR,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('ZATCA Process Error:', e);
    res.status(500).json({ error: 'Failed to process ZATCA submission', message: e.message });
  }
};

// const previewXml = async (req, res) => {
//   const { invoice, invoiceData, customerId } = req.body;
//   const targetInvoice = invoice || invoiceData;

//   if (!targetInvoice) {
//     return res.status(400).json({ error: 'Missing invoice data' });
//   }

//   try {
//     const { realmId, oauthclient } = req;
//     console.log(`--- Generating ZATCA XML Preview for Invoice: ${targetInvoice.DocNumber} ---`);

//     const baseUrl = 'https://quickbooks.api.intuit.com';
//     const custId = customerId || targetInvoice.CustomerRef?.value;
//     const customerUrl = `${baseUrl}/v3/company/${realmId}/customer/${custId}?minorversion=70&include=enhancedAllCustomFields`;
//     const customerResponse = await oauthclient.makeApiCall({ url: customerUrl, method: 'GET', headers: { Accept: 'application/json' } });
//     const customerInfo = JSON.parse(customerResponse.body).Customer;

//     const zatcaData = mapQBOInvoiceToZatca(targetInvoice, customerInfo);
//     const xml = generateZatcaXML(zatcaData);

//     if (!fs.existsSync(BASE_DIR)) {
//       fs.mkdirSync(BASE_DIR, { recursive: true });
//     }
//     const fileName = `Preview_Invoice_${targetInvoice.DocNumber}_${Date.now()}.xml`;
//     const filePath = path.join(BASE_DIR, fileName);
//     fs.writeFileSync(filePath, xml, 'utf8');
//     console.log(`--- XML Saved Successfully: ${filePath} ---`);

//     res.json({
//       success: true,
//       xml,
//       savedPath: filePath,
//       fileName,
//     });
//   } catch (e) {
//     console.error('XML Generation/Saving Error:', e);
//     res.status(500).json({ error: 'Failed to generate and save ZATCA XML', message: e.message });
//   }
// };

/**
 * POST /api/zatca/production-csids
 * Request Production CSID from ZATCA. Uses COMPLIANCE_REQUEST_ID and auth from .env.
 */
// const productionCsids = async (req, res) => {
//   try {
//     const result = await requestProductionCsid();
//     if (result.success) {
//       return res.json({ success: true, ...result });
//     }
//     return res.status(result.status || 502).json({
//       success: false,
//       status: result.status,
//       statusText: result.statusText,
//       data: result.data,
//     });
//   } catch (err) {
//     console.error('Production CSID request error:', err);
//     return res.status(400).json({
//       success: false,
//       error: err.message || 'Production CSID request failed',
//     });
//   }
// };

module.exports = {
  getStatus,
  submitInvoice,
  // previewXml,
  // productionCsids,
};
