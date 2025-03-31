const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Student = require('../models/student');
const Payment = require('../models/payment');
const Installment = require('../models/installment');
const { authenticateToken, authorize } = require('../middleware/auth');
const axios = require('axios');

router.post('/', [
  body('identifierType').isIn(['email', 'phone']).withMessage('Identifier type must be either email or phone'),
  body('identifier').notEmpty().withMessage('Identifier is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
], authenticateToken, authorize(['admin']), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { identifierType, identifier, amount } = req.body;
  const gstRate = 18;

  try {
    const query = identifierType === 'email' ? { email: identifier } : { phone: identifier };
    const student = await Student.findOne(query);
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const TotalGSTAmount = parseFloat(((amount * gstRate) / (100 + gstRate)).toFixed(2));
    const CGST = parseFloat((TotalGSTAmount / 2).toFixed(2));
    const SGST = parseFloat((TotalGSTAmount / 2).toFixed(2));

    const installments = await Installment.find({ studentId: student.studentId, status: { $ne: 'Paid' } }).sort('dueDate');
    let remainingAmount = amount;
    for (let installment of installments) {
      if (remainingAmount <= 0) break;
      if (remainingAmount >= installment.amount) {
        remainingAmount -= installment.amount;
        installment.amount = 0;
        installment.status = 'Paid';
      } else {
        installment.amount -= remainingAmount;
        remainingAmount = 0;
        installment.status = 'Partially Paid';
      }
      await installment.save();
    }

    student.feesPaid += amount;
    student.dueAmount -= amount;
    await student.save();

    const transactionId = uuidv4();
    const newPayment = new Payment({
      studentId: student.studentId,
      PaidAmount: amount,
      gstRate,
      TotalGSTAmount,
      CGST,
      SGST,
      description: 'Installment Payment',
      transactionId,
      paymentDate: new Date(),
    });
    await newPayment.save();

    // Call invoice generation
    //const invoiceResponse = await axios.post(
      //'https://dhronasadmin.h0stname.net/api/invoices/generate',
      //{ paymentId: newPayment._id },
      //{ headers: { Authorization: req.headers.authorization } }
    //);//

   // const { transactionId: returnedTransactionId, invoiceUrl } = invoiceResponse.data.data;

    res.json({
      success: true,
      data: {
        transactionId: returnedTransactionId,
        paymentId: newPayment._id,
      },
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Payment History
router.get('/:studentId', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const payments = await Payment.find({ studentId: req.params.studentId }).lean();
    const paymentData = payments.map(p => ({
      paymentId: p._id,
      amount: p.PaidAmount,
      paymentDate: p.paymentDate,
      invoiceUrl: `https://dhronasadmin.h0stname.net/api/invoices/${p._id}`,
      transactionId: p.transactionId,
    }));
    res.json({ success: true, data: paymentData });
  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;