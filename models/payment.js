const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  paymentId: { type: String, unique: true },
  transactionId: { type: String, unique: true, required: true }, // New field for Transaction ID
  studentId: { type: String, ref: 'Student', required: true },
  PaidAmount: { type: Number, required: true },
  gstRate: Number,
  TotalGSTAmount: Number,
  CGST: Number,
  SGST: Number,
  paymentDate: { type: Date, default: Date.now },
  description: String,
});

paymentSchema.pre('save', function(next) {
  // If no paymentId exists, auto-generate one.
  if (!this.paymentId) {
    this.paymentId = Math.floor(100000000000 + Math.random() * 900000000000).toString();
  }
  next();
});

//paymentSchema.index({ studentId: 1 });
module.exports = mongoose.model('Payment', paymentSchema);
