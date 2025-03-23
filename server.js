// server.js - Express backend setup
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

dotenv.config();
const app = express();
app.use(express.json());
//app.use(cors());
app.use(cors({
  origin: 'https://student-management-frontend-n2vzs1u0c-saikat-guhas-projects.vercel.app', // Allow frontend origin
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  allowedHeaders: 'Content-Type,Authorization'
}));
// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  //useNewUrlParser: true
  //useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000, // Increase timeout to 10 seconds
}).then(() => console.log('✅ Connected to MongoDB Cloud Instance!')).catch(err => console.error('❌ MongoDB Connection Error:', err));

// Student Schema
const studentSchema = new mongoose.Schema({
  studentId: { type: String, unique: true },
  name: String,
  address: String,
  email: { type: String, unique: true },
  password: String,
  course: String,
  Total_fees: Number,
  //feesPaid: Number,
  //dueAmount: Number,
  dateJoined: { type: Date, default: Date.now },
  phone: { type: String, unique: true },
  batchNo: {
    type: String,
    required: function () {
      return this.role !== 'admin';  // batchNo required only for non-admin roles
    },},
  role: { type: String, default: 'student' },
  hasInstallments: { type: Boolean, default: false },
});
const Student = mongoose.model('Student', studentSchema);

// Payment Schema
const paymentSchema = new mongoose.Schema({ 
  paymentId: {
  type: String,
  unique: true,
  default: function generatePaymentId() {
    return Math.floor(100000000000 + Math.random() * 900000000000).toString();
  },},
  studentId: { type: String, ref: 'Student' },
  PaidAmount: Number,
  gstRate: Number,
  TotalGSTAmount: Number,
  CGST: Number,
  SGST: Number,
  paymentDate: { type: Date, default: Date.now },
});
const Payment = mongoose.model('Payment', paymentSchema);

// Installment Schema
const installmentSchema = new mongoose.Schema({
  studentId: { type: String, ref: 'Student' },
  installmentNumber: Number,
  amount: Number,
  dueDate: Date,
  status: { type: String, enum: ['Pending', 'Partially Paid', 'Paid'], default: 'Pending' },
});
const Installment = mongoose.model('Installment', installmentSchema);

// Middleware for Authentication and Authorization
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET, async (err, userData) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });

    const student = await Student.findOne({ studentId: userData.id });
    if (!student) return res.status(404).json({ error: 'User not found' });

    req.user = student;
    next();
  });
};

const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

// Temporary route to create admin users (one-time use)
app.post('/create-admin', async (req, res) => {
  const { name, email, password, phone } = req.body;

  try {console.log('📌 Received /create-admin request:', req.body);
    const existingAdmin = await Student.findOne({ email, role: 'admin' });
    if (existingAdmin) return res.status(400).json({ error: 'Admin user already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const generatedAdminId = `ADMIN-${uuidv4().split('-')[0].toUpperCase()}`;

    const newAdmin = new Student({
      studentId: generatedAdminId,
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'admin',
      feesPaid: 0,
      dueAmount: 0,
    });
    await newAdmin.save();

    res.json({ message: 'Admin user created successfully', adminId: generatedAdminId });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ error: 'Internal Server Error',details: error.message });
  }
});

// Login Endpoint
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const user = await Student.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.studentId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, student: {
      studentId: user.studentId,
      name: user.name,
      email: user.email,
      role: user.role,
    }, });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// Function to handle payment creation with retry for duplicate paymentId
async function createPayment(paymentData) {
  let payment;
  let attempts = 0;

  while (!payment && attempts < 5) {
    try {
      payment = await Payment.create(paymentData);
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate paymentId error
        console.warn('Duplicate paymentId generated. Retrying...');
        paymentData.paymentId = Math.floor(100000000000 + Math.random() * 900000000000).toString();
      } else {
        throw error;
      }
    }

    attempts++;
  }

  if (!payment) {
    throw new Error('Failed to create payment after multiple attempts.');
  }

  return payment;
}

// Payment Handling with WhatsApp Notification
app.post('/pay', authenticateToken, authorize(['admin']), async (req, res) => {
  const { email, amount } = req.body;
  const gstRate = 18;

  try {
    const student = await Student.findOne({ email });
    if (!student) return res.status(400).json({ error: 'Student not found' });

    // GST Calculations
    const TotalGSTAmount = parseFloat(((amount * gstRate) / (100 + gstRate)).toFixed(2));
    const CGST = parseFloat((TotalGSTAmount / 2).toFixed(2));
    const SGST = parseFloat((TotalGSTAmount / 2).toFixed(2));

    // Adjust installments
    const installments = await Installment.find({ studentId: student.studentId, status: { $ne: 'Paid' } }).sort('dueDate');
    let remainingAmount = amount;

    for (let installment of installments) {
      if (remainingAmount <= 0) break;

      if (remainingAmount >= installment.amount) {
        // Fully pay this installment
        remainingAmount -= installment.amount;
        installment.amount = 0;
        installment.status = 'Paid';
      } else {
        // Partially pay this installment
        installment.amount -= remainingAmount;
        remainingAmount = 0;
        installment.status = 'Partially Paid';
      }

      await installment.save();
    }

    // Update student payment records
    student.feesPaid += amount;
    student.dueAmount -= amount;
    await student.save();

    // Save payment record with GST details
    const newPayment = await  createPayment({
      //paymntId: { type: String, unique: true, default: uuidv4 },  // Unique payment ID
      studentId: student.studentId,
      PaidAmount: amount,
      gstRate,
      TotalGSTAmount,
      CGST,
      SGST,
      paymentDate: new Date(),
      description: 'Installment Payment',
    });
    //await payment.save();
 
    /*const whatsappMessage = {
      messaging_product: 'whatsapp',
      to: student.phone,
      type: 'text',
      text: {
        body: `Hello ${student.name}, we have received your payment of Rs.${amount}. Your due amount is now Rs.${student.dueAmount}. Thank you!`,
      },
    };*/

   /* axios.post(`https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`, whatsappMessage, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }).then(() => console.log('WhatsApp payment message sent')).catch(err => console.error('WhatsApp error:', err));*/

    res.json({ message: 'Payment successful', newPayment });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Enrollment with Installment Setup or Update
// Enrollment endpoint logic
app.post('/enroll', authenticateToken, authorize(['admin']), async (req, res) => {
  const { name, address, email, password, course, Total_fees, phone, initialPayment, installmentCount, batchNo } = req.body;
  const gstRate = 18;  // Define GST rate here
  try {
    // Check if the student already exists
    let student = await Student.findOne({ email });

    if (student) {
      return res.status(400).json({ error: 'Student already enrolled' });
    }
 // Calculate GST for the initial payment
 const TotalGSTAmount = parseFloat(((initialPayment * gstRate) / (100 + gstRate)).toFixed(2));
 const CGST = parseFloat((TotalGSTAmount / 2).toFixed(2));
 const SGST = parseFloat((TotalGSTAmount / 2).toFixed(2));

    // Create the new student
    const hashedPassword = await bcrypt.hash(password, 10);
    const generatedStudentId = `STU-${uuidv4().split('-')[0].toUpperCase()}`;

    student = new Student({
      studentId: generatedStudentId,
      name,
      address,
      email,
      password: hashedPassword,
      course,
      Total_fees,
      feesPaid: initialPayment,
      dueAmount: Total_fees - initialPayment,
      phone,
      batchNo,
      hasInstallments: installmentCount > 0,
      enrollmentDate: new Date(),  // Use current date as enrollment date
    });
    await student.save();

    // Add the initial payment record
    const payment = new Payment({
      studentId: student.studentId,
      PaidAmount: initialPayment,
      gstRate,
      TotalGSTAmount,
      CGST,
      SGST, 
      paymentDate: new Date(),  // Enrollment date
      description: 'Initial Payment',
    });
    await payment.save();

    // Generate installment schedule if applicable
    if (installmentCount > 0) {
      const installmentAmount = (Total_fees - initialPayment) / installmentCount;

      const installmentRecords = Array.from({ length: installmentCount }, (_, index) => ({
        studentId: student.studentId,
        installmentNumber: index + 1,
        amount: installmentAmount,
        dueDate: new Date(new Date().setMonth(new Date().getMonth() + (index + 1))),
        status: 'Pending',
      }));

      await Installment.insertMany(installmentRecords);
    }

    
    

   // const whatsappMessage = {
     // messaging_product: 'whatsapp',
      //to: phone,
      //type: 'text',
     // text: { body: `Hello ${name}, you have been successfully enrolled in the ${course} course under Batch ${batchNo}. Your student ID is ${generatedStudentId}.` },
   // };

   // axios.post(`https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`, whatsappMessage, {
     // headers: {
      //  Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        //'Content-Type': 'application/json',
    //  },
    //}).then(() => console.log('WhatsApp enrollment message sent')).catch(err => console.error('WhatsApp error:', err));*//

    res.json({ message: 'Enrollment successful', studentId: student.studentId });
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}); 

// Exportable Reports Endpoint
app.get('/export-data/:studentId', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const payments = await Payment.find({ studentId: req.params.studentId });
    const installments = await Installment.find({ studentId: req.params.studentId });

    const { Parser } = require('json2csv');
    const paymentFields = ['studentId', 'PaidAmount', 'paymentDate', 'TotalGSTAmount', 'CGST', 'SGST'];
    const installmentFields = ['studentId', 'installmentNumber', 'amount', 'dueDate', 'status'];

    const paymentCsv = new Parser({ fields: paymentFields }).parse(payments);
    const installmentCsv = new Parser({ fields: installmentFields }).parse(installments);

    res.setHeader('Content-disposition', 'attachment; filename=data_export.csv');
    res.set('Content-Type', 'text/csv');
    res.send(`Payments Data\n\n${paymentCsv}\n\nInstallments Data\n\n${installmentCsv}`);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin-Dashboard Statistics
app.get('/admin-dashboard', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments({ role: 'student' });
    const totalPayments = await Payment.aggregate([{ $group: { _id: null, total: { $sum: '$PaidAmount' } } }]);
    const totalPendingInstallments = await Installment.countDocuments({ status: 'Pending' });

    res.json({
      totalStudents,
      totalPayments: totalPayments[0]?.total || 0,
      totalPendingInstallments,
    });
  } catch (error) {
    console.error('Admin-Dashboard error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//Student-Dashboard
app.get('/student-dashboard', authenticateToken, authorize(['student']), async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.user.studentId });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Fetch all payments made by the student
    const payments = await Payment.find({ studentId: student.studentId });
    
    // Ensure each payment has a description
    const paymentsWithDescriptions = payments.map(payment => ({
      PaidAmount: payment.PaidAmount,
      paymentDate: payment.paymentDate,
      description: payment.description || 'Payment Received',
    }));

    // Calculate total payments made so far
    const totalPaymentsMade = payments.reduce((sum, payment) => sum + payment.PaidAmount, 0);

    // Initial payment is the amount paid at the time of enrollment
    const initialPayment = student.feesPaid;

    // Update due amount dynamically
    const dueAmount = student.Total_fees - totalPaymentsMade;

    res.json({
      name: student.name,
      course: student.course,
      Total_fees: student.Total_fees,
      initialPayment,
      feesPaid: totalPaymentsMade,
      dueAmount,
      joinedDate: student.enrollmentDate|| new Date(), 
      payments: paymentsWithDescriptions,
      installments: await Installment.find({ studentId: student.studentId }),
      batchNo: student.batchNo,
    });
  } catch (error) {
    console.error('Error fetching student dashboard data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Notifications for Due Payments
app.get('/notifications', authenticateToken, authorize(['admin', 'student']), async (req, res) => {
  try {
    const today = new Date();
    const upcomingDueDate = new Date(today.setDate(today.getDate() + 7));

    const pendingInstallments = await Installment.find({
      studentId: req.user.role === 'admin' ? { $exists: true } : req.user.studentId,
      dueDate: { $lte: upcomingDueDate },
      status: 'Pending',
    });

    res.json({ pendingInstallments });
  } catch (error) {
    console.error('Notification error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// Invoice Printing
app.get('/invoice/:phone', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const phone = req.params.phone;
    const student = await Student.findOne({ phone });
    if (!student) return res.status(404).json({ error: 'Student not found' });
// Get the latest payment
const latestPayment = await Payment.findOne({ studentId: student.studentId })
.sort({ paymentId: -1 })  // Sort by paymentDate in descending order
.exec();
    //const payments = await Payment.find({ studentId: student.studentId });
    //const amount_paid = Payment.PaidAmount;

    // Generate a unique invoice number
    const invoiceNumber = `INV-${uuidv4().split('-')[0].toUpperCase()}`;

    // Format current date
    const currentDate = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date());

    // GST details (assuming 18% GST)
    const gstRate = 18;
    const totalGSTAmount = parseFloat((latestPayment ? (latestPayment.PaidAmount * gstRate)  / (100 + gstRate): 0).toFixed(2));
    const CGST = parseFloat((totalGSTAmount / 2).toFixed(2));
    const SGST = parseFloat((totalGSTAmount / 2).toFixed(2));

    // Response data for the invoice
    res.json({
      invoiceNumber,
      currentDate,
      student: {
        studentId: student.studentId,
        name: student.name,
        course: student.course,
        batch: student.batchNo,
        dateJoined: student.enrollmentDate,
        totalFees: student.Total_fees,
        //amountPaid: amount_paid,
        //dueAmount: student.Total_fees - totalPayments,
      },
      latestPayment: latestPayment || {},
      gstDetails: {
        rate: gstRate,
        totalGST: totalGSTAmount,
        CGST,
        SGST,
      },
      institute: {
        name: 'The Dhronas',
        logo: '/path-to-logo.png',
        address: 'Hatimore, Siliguri, West Bengal, India',
        phone: '+91-8436900456',
        //email: 'info@thedhronas.com',
        website: 'www.thedhronas.com',
      },
    });
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = app;

app.get('/', (req, res) => {
  res.send('Student Management System API');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
