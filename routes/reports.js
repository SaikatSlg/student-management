const express = require('express');
const router = express.Router();
const { Parser } = require('json2csv');
const Student = require('../models/student');
const Payment = require('../models/payment');
const Installment = require('../models/installment');
const { authenticateToken, authorize } = require('../middleware/auth');

// Invoices Report
router.get('/invoices', authenticateToken, authorize(['admin']), async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ success: false, error: 'Month parameter is required in YYYY-MM format' });

  try {
    const startDate = new Date(`${month}-01`);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const payments = await Payment.find({ paymentDate: { $gte: startDate, $lt: endDate } }).lean();
    const reportData = await Promise.all(payments.map(async payment => {
      const student = await Student.findOne({ studentId: payment.studentId }).lean();
      return {
        invoiceNumber: payment.paymentId,
        date: payment.paymentDate.toISOString().split('T')[0],
        studentName: student ? student.name : 'Unknown',
        payment: payment.PaidAmount,
        gstAmount: payment.TotalGSTAmount,
        CGST: payment.CGST,
        SGST: payment.SGST,
      };
    }));

    const fields = ['invoiceNumber', 'date', 'studentName', 'payment', 'gstAmount', 'CGST', 'SGST'];
    const csv = new Parser({ fields }).parse(reportData);

    res.header('Content-Type', 'text/csv');
    res.attachment(`invoice_report_${month}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Invoice report error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Pending Payments
router.get('/pending-payments', authenticateToken, authorize(['admin']), async (req, res) => {
  const { batch } = req.query;
  if (!batch) return res.status(400).json({ success: false, error: 'Batch parameter is required' });

  try {
    const students = await Student.find({ batchNo: batch, dueAmount: { $gt: 0 } }).lean();
    const reportData = await Promise.all(students.map(async student => {
      const payments = await Payment.find({ studentId: student.studentId }).sort({ paymentDate: -1 }).lean();
      const installments = await Installment.find({ studentId: student.studentId }).sort({ dueDate: 1 }).lean();
      return { studentName: student.name, remainingFee: student.dueAmount, payments, installments };
    }));

    res.json({ success: true, data: { report: reportData } });
  } catch (error) {
    console.error('Pending payments report error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Course Enrollment
router.get('/course-enrollment', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const courses = await Student.aggregate([
      { $match: { role: 'student' } },
      { $group: { _id: "$course", count: { $sum: 1 } } }
    ]);
    const courseCounts = courses.reduce((acc, course) => ({ ...acc, [course._id]: course.count }), {});
    res.json({ success: true, data: { courses: courseCounts } });
  } catch (error) {
    console.error('Course enrollment error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Monthly Payments
router.get('/monthly-payments', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const payments = await Payment.aggregate([
      { $match: { paymentDate: { $gte: startOfMonth, $lt: startOfNextMonth } } },
      { $group: { _id: null, total: { $sum: "$PaidAmount" } } }
    ]);

    const totalPayments = payments.length > 0 ? payments[0].total : 0;
    res.json({ success: true, data: { totalPayments } });
  } catch (error) {
    console.error('Monthly payments error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Export Data
router.get('/export-data/:studentId', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const payments = await Payment.find({ studentId: req.params.studentId }).lean();
    const installments = await Installment.find({ studentId: req.params.studentId }).lean();

    const paymentFields = ['studentId', 'PaidAmount', 'paymentDate', 'TotalGSTAmount', 'CGST', 'SGST'];
    const installmentFields = ['studentId', 'installmentNumber', 'amount', 'dueDate', 'status'];

    const paymentCsv = new Parser({ fields: paymentFields }).parse(payments);
    const installmentCsv = new Parser({ fields: installmentFields }).parse(installments);

    res.setHeader('Content-disposition', 'attachment; filename=data_export.csv');
    res.set('Content-Type', 'text/csv');
    res.send(`Payments Data\n\n${paymentCsv}\n\nInstallments Data\n\n${installmentCsv}`);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;