// routes/invoice.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Student = require('../models/student');
const Payment = require('../models/payment');
const { authenticateToken, authorize } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const multer = require('multer'); // For handling file uploads
const upload = multer({ storage: multer.memoryStorage() });

router.get('/by-payment/:paymentId', authenticateToken, authorize(['admin', 'student']), async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId).lean();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    const student = await Student.findOne({ studentId: payment.studentId }).lean();
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const invoiceNumber = `INV-${uuidv4().split('-')[0].toUpperCase()}`;
    const currentDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
    const gstRate = payment.gstRate || 18;
    const totalGSTAmount = payment.TotalGSTAmount || parseFloat(((payment.PaidAmount * gstRate) / (100 + gstRate)).toFixed(2));
    const CGST = payment.CGST || parseFloat((totalGSTAmount / 2).toFixed(2));
    const SGST = payment.SGST || parseFloat((totalGSTAmount / 2).toFixed(2));

    res.json({
      success: true,
      data: {
        invoiceNumber,
        currentDate,
        student: {
          studentId: student.studentId,
          name: student.name,
          course: student.course,
          batch: student.batchNo,
          dateJoined: student.dateJoined,
          totalFees: student.Total_fees,
        },
        latestPayment: payment,
        gstDetails: { rate: gstRate, totalGST: totalGSTAmount, CGST, SGST },
        institute: {
          name: 'The Dhronas',
          address: 'Ashutosh Mukherjee Road, Subhashpally, Siliguri-734001',
          phone: '+91-8436586516',
          email: 'infodhronas@gmail.com',
          website: 'www.thedhronas.com',
        },
      },
    });
  } catch (error) {
    console.error('Invoice error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.post('/generate', upload.single('pdf'), authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { paymentId } = req.body;
    const pdfBuffer = req.file.buffer;

    const payment = await Payment.findById(paymentId).lean();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    const student = await Student.findOne({ studentId: payment.studentId }).lean();
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: student.email,
      subject: 'Payment Invoice',
      text: 'Thank you for your payment. Please find your invoice attached.',
      attachments: [{ filename: `invoice-${payment.transactionId}.pdf`, content: pdfBuffer }],
    });

    res.json({ success: true, message: 'Invoice emailed successfully' });
  } catch (error) {
    console.error('Invoice emailing error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;