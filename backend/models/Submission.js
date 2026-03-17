const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema(
  {
    uuid: { type: String, required: true, sparse: true, unique: true },
    qboInvoiceId: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    icv: { type: Number, required: true },
    invoiceHashBase64: { type: String, required: true },
    previousInvoiceHash: { type: String, required: true },
    qrCodeBase64: { type: String, default: null },
    zatcaStatus: { type: String, required: true },
    zatcaResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    clearedInvoice: { type: String, default: null },

    submittedAt: { type: Date, default: Date.now },
  },
  { collection: 'submissions', timestamps: false }
);

submissionSchema.index({ zatcaStatus: 1 });
submissionSchema.index({ invoiceNumber: 1, qboInvoiceId: 1 });

module.exports = mongoose.model('Submission', submissionSchema);
