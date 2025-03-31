const mongoose = require('mongoose');

const pendingStudentSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true }, // Unique token for the link
  name: { type: String, required: true },
  address: String,
  email: { 
    type: String, 
    required: true, 
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'] 
  },
  password: { type: String, required: true }, // Will be hashed on approval
  course: String,
  phone: { 
    type: String, 
    required: true, 
    match: [/^\d{10}$/, 'Phone number must be 10 digits'] 
  },
  fatherOrGuardianName: { type: String, required: true }, // New field
  dob: { type: Date, required: true }, // New field
  createdAt: { type: Date, default: Date.now, expires: '7d' }, // Auto-expire after 7 days
});

module.exports = mongoose.model('PendingStudent', pendingStudentSchema);