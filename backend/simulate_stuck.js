// backend/simulate_stuck.js
require('dotenv').config();
const connectDB = require('./config/mongodb');
const Submission = require('./models/Submission');

async function simulate() {
    await connectDB();

    // 1. Find the last invoice
    const last = await Submission.findOne({}).sort({ icv: -1, submittedAt: -1 });

    if (!last) {
        console.log("No invoices found to simulate. Submit one normally first.");
        process.exit(0);
    }

    console.log(`Simulating a STUCK record for Invoice: ${last.invoiceNumber}`);

    // 2. Clear its ZATCA result and mark as SUBMITTING
    await Submission.updateOne(
        { _id: last._id },
        {
            $set: {
                zatcaStatus: 'SUBMITTING',
                clearedInvoice: null,
                zatcaResponse: null
            }
        }
    );

    console.log("SUCCESS: Database record is now 'SUBMITTING'.");
    process.exit(0);
}

simulate();
