const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  studentId: { type: String, unique: true },
  name: { type: String, required: true },
  address: String,
  email: { 
    type: String, 
    unique: true, 
    required: true, 
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'] 
  },
  password: { type: String, required: true },
  course: String,
  Total_fees: { type: Number, required: true },
  initialPayment: { type: Number, default: 0 }, // New field for initial payment
  feesPaid: { type: Number, default: 0 },
  dueAmount: { type: Number, default: 0 },
  dateJoined: { type: Date, default: Date.now },
  phone: { 
    type: String, 
    unique: true, 
    required: true, 
    match: [/^\d{10}$/, 'Phone number must be 10 digits'] 
  },
  batchNo: { 
    type: String, 
    required: function() { return this.role === 'student'; } 
  },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  hasInstallments: { type: Boolean, default: false },
  fatherOrGuardianName: { type: String, required: true },
  dob: { type: Date, required: true },
});

//studentSchema.index({ studentId: 1 });
module.exports = mongoose.model('Student', studentSchema);