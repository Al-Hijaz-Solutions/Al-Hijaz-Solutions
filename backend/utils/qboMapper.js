
/**
 * Mapper to transform QuickBooks Invoice JSON to ZATCA-compatible data structure
 * Supplier (seller) data comes from .env - no API calls.
 */
const { getSupplierFromEnv } = require('../config/supplierConfig');

const mapQBOInvoiceToZatca = (qboInvoice, customerInfo) => {
    const supplier = getSupplierFromEnv();
    const taxRate = parseFloat(process.env.TAX_RATE || '0.15', 10);

    // 2. Extract Customer Info
    // Extract VAT from Custom Fields or fallback as done in frontend
    let buyerVat = customerInfo.PrimaryTaxIdentifier || customerInfo.TaxRegistrationNumber || '';

    let streetName = '';
    let buildingNumber = '';
    let citySubdivisionName = '';

    if (customerInfo.CustomField) {
        const vatField = customerInfo.CustomField.find(f =>
            f.Name && (
                f.Name === 'Buyer VAT' ||
                f.Name.toLowerCase().includes('vat') ||
                f.Name.toLowerCase().includes('tax')
            )
        );
        if (vatField) {
            const val = vatField.StringValue || vatField.NumberValue;
            if (val) buyerVat = val.toString();
        }

        const fetchField = (nameMatch) => {
            const field = customerInfo.CustomField.find(f => f.Name && f.Name.toLowerCase() === nameMatch.toLowerCase());
            return field ? (field.StringValue || field.NumberValue || '') : '';
        };

        streetName = fetchField('StreetName');
        buildingNumber = fetchField('BuildingNumber');
        citySubdivisionName = fetchField('CitySubdivisionName');
    }

    // Fallback: Check Notes if still masked or empty
    if ((!buyerVat || buyerVat.includes('X')) && customerInfo.Notes) {
        const vatInNotes = customerInfo.Notes.match(/\b\d{15}\b/);
        if (vatInNotes) buyerVat = vatInNotes[0];
    }

    if (!streetName || !buildingNumber || !citySubdivisionName) {
        throw new Error('Please add the following details Street Name, Building Number, City Subdivision Name, Buyer VAT in the customer’s address in the Custom Fields section of QuickBook. Then try again');
    }

    const customer = {
        name: customerInfo.DisplayName || customerInfo.CompanyName,
        vatNumber: buyerVat,
        street: streetName,
        buildingNumber: buildingNumber,
        neighborhood: citySubdivisionName,
        city: customerInfo.BillAddr?.City,
        postalCode: customerInfo.BillAddr?.PostalCode
    };

    // Helper function for ZATCA half-up rounding to 2 decimal places
    const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

    // 3. Extract Items
    const items = qboInvoice.Line
        .filter(line => line.DetailType === 'SalesItemLineDetail')
        .map(line => {
            const detail = line.SalesItemLineDetail;
            const quantity = detail.Qty || 1;
            const unitPrice = detail.UnitPrice || line.Amount / quantity;
            const lineExtensionAmount = round2(line.Amount);
            const taxAmount = round2(lineExtensionAmount * taxRate);
            const taxInclusiveAmount = round2(lineExtensionAmount + taxAmount);

            return {
                name: line.Description || 'Item Name',
                quantity: quantity,
                unitPrice: unitPrice,
                lineExtensionAmount: lineExtensionAmount,
                taxAmount: taxAmount,
                taxInclusiveAmount: taxInclusiveAmount
            };
        });

    // 4. Calculate Totals based strictly on summed rounded line values
    const lineExtensionAmount = round2(items.reduce((sum, item) => sum + item.lineExtensionAmount, 0));
    const taxAmount = round2(items.reduce((sum, item) => sum + item.taxAmount, 0));
    const payableAmount = round2(lineExtensionAmount + taxAmount);

    // Use TxnDate for correct invoice date + CreateTime for real issue time
    const txnDate = qboInvoice.TxnDate || '';
    const createTime = qboInvoice.MetaData?.CreateTime;
    let issueDate = txnDate;
    if (createTime && txnDate) {
        const timeMatch = createTime.match(/T(\d{2}:\d{2}:\d{2})/);
        if (timeMatch) issueDate = `${txnDate}T${timeMatch[1]}`;
    }

    return {
        invoiceNumber: qboInvoice.DocNumber,
        issueDate,
        supplier,
        customer,
        items,
        taxTotal: {
            taxAmount: taxAmount
        },
        monetaryTotal: {
            lineExtensionAmount: lineExtensionAmount,
            taxExclusiveAmount: lineExtensionAmount,
            taxInclusiveAmount: payableAmount,
            payableAmount: payableAmount
        }
    };
};

module.exports = { mapQBOInvoiceToZatca };
