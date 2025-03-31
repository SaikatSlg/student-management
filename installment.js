const mongoose = require('mongoose');

const installmentSchema = new mongoose.Schema({
  studentId: { type: String, ref: 'Student', required: true },
  installmentNumber: { type: Number, required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  status: { 
    type: String, 
    enum: ['Pending', 'Partially Paid', 'Paid'], 
    default: 'Pending' 
  },
});

installmentSchema.index({ studentId: 1 });
module.exports = mongoose.model('Installment', installmentSchema);