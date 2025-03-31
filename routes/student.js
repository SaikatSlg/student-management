const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Student = require('../models/student');
const PendingStudent = require('../models/pendingStudent');
const Installment = require('../models/installment');
const Payment = require('../models/payment');
const { authenticateToken, authorize } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const Course = require('../models/course');

// Login Endpoint - Allows students/admins to log in
router.post('/login', [
  body('identifier').notEmpty().trim(), // Can be email or phone
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { identifier, password } = req.body;
  try {
    const user = await Student.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!user) return res.status(400).json({ success: false, error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.studentId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({
      success: true,
      data: {
        token,
        student: { studentId: user.studentId, name: user.name, email: user.email, role: user.role }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Create Admin - One-time use to set up an admin user
router.post('/create-admin', async (req, res) => {
  const { name, email, password, phone } = req.body;
  try {
    const existingAdmin = await Student.findOne({ email, role: 'admin' });
    if (existingAdmin) return res.status(400).json({ success: false, error: 'Admin user already exists' });

    const hashedPassword = await bcrypt.hash(password, 12);
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

    res.json({ success: true, data: { message: 'Admin user created successfully', adminId: generatedAdminId } });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Enroll Student - Existing admin-only enrollment (kept for flexibility)
router.post('/enroll', authenticateToken, authorize(['admin']), async (req, res) => {
  const { name, address, email, password, course, Total_fees, phone, initialPayment, installmentCount, batchNo } = req.body;
  const gstRate = 18;

  try {
    const existingStudent = await Student.findOne({ email });
    if (existingStudent) return res.status(400).json({ success: false, error: 'Student already enrolled' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const generatedStudentId = `STU-${uuidv4().split('-')[0].toUpperCase()}`;
    const TotalGSTAmount = parseFloat(((initialPayment * gstRate) / (100 + gstRate)).toFixed(2));
    const CGST = parseFloat((TotalGSTAmount / 2).toFixed(2));
    const SGST = parseFloat((TotalGSTAmount / 2).toFixed(2));

    const student = new Student({
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
    });
    await student.save();

    const payment = new Payment({
      studentId: student.studentId,
      PaidAmount: initialPayment,
      gstRate,
      TotalGSTAmount,
      CGST,
      SGST,
      description: 'Initial Payment',
    });
    await payment.save();

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

    res.json({ success: true, data: { message: 'Enrollment successful', studentId: student.studentId } });
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Student Dashboard - Displays student info
router.get('/dashboard', authenticateToken, authorize(['student']), async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.user.studentId }).lean();
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

    const payments = await Payment.find({ studentId: student.studentId }).lean();
    const paymentsWithDescriptions = payments.map(payment => ({
      PaidAmount: payment.PaidAmount,
      paymentDate: payment.paymentDate,
      description: payment.description || 'Payment Received',
    }));

    const totalPaymentsMade = payments.reduce((sum, payment) => sum + payment.PaidAmount, 0);
    const dueAmount = student.Total_fees - totalPaymentsMade;

    res.json({
      success: true,
      data: {
        name: student.name,
        course: student.course,
        Total_fees: student.Total_fees,
        initialPayment: student.feesPaid,
        feesPaid: totalPaymentsMade,
        dueAmount,
        joinedDate: student.dateJoined,
        payments: paymentsWithDescriptions,
        installments: await Installment.find({ studentId: student.studentId }).lean(),
        batchNo: student.batchNo,
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Generate Enrollment Link - Admin generates a unique link for public form
router.get('/students/generate-enrollment-link', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const token = uuidv4();
    const link = `https://student-management-frontend-flax.vercel.app/enroll-form?token=${token}`;
    await PendingStudent.create({
      token
    }); // Reserve the token
    res.json({ success: true, data: { link, token } });
  } catch (error) {
    console.error('Link generation error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Submit Enrollment - Public endpoint for form submission (no login required)
router.post('/students/submit-enrollment', [
  body('token').notEmpty(),
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  body('phone').matches(/^\d{10}$/),
  body('fatherOrGuardianName').notEmpty().trim(),
  body('dob').isISO8601().toDate(), // Validates date in YYYY-MM-DD format
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { token, name, address, email, password, course, phone, fatherOrGuardianName, dob } = req.body;

  try {
    const pendingStudent = await PendingStudent.findOne({ token });
    if (!pendingStudent) return res.status(400).json({ success: false, error: 'Invalid or expired token' });

    // Update the pending student record
    pendingStudent.name = name;
    pendingStudent.address = address;
    pendingStudent.email = email;
    pendingStudent.password = password; // Store plaintext for now, hash on approval
    pendingStudent.course = course;
    pendingStudent.phone = phone;
    pendingStudent.fatherOrGuardianName = fatherOrGuardianName;
    pendingStudent.dob = dob;
    await pendingStudent.save();

    res.json({ success: true, data: { message: 'Enrollment submitted, awaiting admin approval' } });
  } catch (error) {
    console.error('Enrollment submission error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
router.get('stats', authenticateToken, authorize(['admin']), async (req, res) => {
  try {const courseEnrollments = await Student.aggregate([
    { $group: { _id: '$course', count: { $sum: 1 } } },
    { $project: { name: '$_id', count: 1, _id: 0 } },
  ]);

  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  const payments = await Payment.aggregate([
    { $match: { paymentDate: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $group: { _id: null, total: { $sum: '$PaidAmount' } } },
  ]);
  const monthlyPayments = payments.length > 0 ? payments[0].total : 0;
    const pendingStudents = await PendingStudent.find().lean();
    
    res.json({
      success: true,
      data: {
        courseEnrollments, // Placeholder
        monthlyPayments, // Placeholder
        pendingStudents: pendingStudents.map(s => ({
          name: s.name,
          email: s.email,
          token: s.token,
        })),
      },
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
// Approve Pending Student - Admin approves with additional fields
router.post('/students/approve-student', authenticateToken, authorize(['admin']), [body('token').notEmpty(),
  body('Total_fees').isNumeric().withMessage('Total fees must be a number'),
  body('batchNo').notEmpty().trim().withMessage('Batch number is required'),
  body('initial_payment').isNumeric().withMessage('Initial payment must be a number'),
  body('no_of_installments')
    .optional()
    .isInt({ min: 0 }).withMessage('Number of installments must be a non-negative integer'),
  body('discount_offered')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Discount must be a percentage between 0 and 100'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { token, Total_fees, batchNo, initial_payment, no_of_installments, discount_offered } = req.body;

  try {
    const pendingStudent = await PendingStudent.findOne({ token});
    if (!pendingStudent) return res.status(404).json({ success: false, error: 'Pending student not found' });

    // Apply discount if offered
    let effectiveFees = Total_fees;
    if (discount_offered) {
      effectiveFees = Total_fees * (1 - discount_offered / 100);
    }

    // Validate initial_payment against effective fees
    if (initial_payment > effectiveFees) {
      return res.status(400).json({ success: false, error: 'Initial payment cannot exceed total fees' });
    }

    // Determine if installments are needed
    const hasInstallments = initial_payment < effectiveFees;
    const remainingAmount = effectiveFees - initial_payment;
    let installmentRecords = [];

    if (hasInstallments) {
      if (!no_of_installments || no_of_installments <= 0) {
        return res.status(400).json({ success: false, error: 'Number of installments is required when initial payment is less than total fees' });
      }
      const installmentAmount = remainingAmount / no_of_installments;
      installmentRecords = Array.from({ length: no_of_installments }, (_, index) => ({
        studentId: '', // Will be updated after student creation
        installmentNumber: index + 1,
        amount: installmentAmount,
        dueDate: new Date(new Date().setMonth(new Date().getMonth() + (index + 1))),
        status: 'Pending',
      }));
    }

    const hashedPassword = await bcrypt.hash(pendingStudent.password, 12);
    const generatedStudentId = `STU-${uuidv4().split('-')[0].toUpperCase()}`;

    // Create the student
    const student = new Student({
      studentId: generatedStudentId,
      name: pendingStudent.name,
      address: pendingStudent.address,
      email: pendingStudent.email,
      password: hashedPassword,
      course: pendingStudent.course,
      Total_fees: effectiveFees, // Use discounted fee
      feesPaid: initial_payment,
      dueAmount: remainingAmount,
      phone: pendingStudent.phone,
      batchNo,
      hasInstallments,
      fatherOrGuardianName: pendingStudent.fatherOrGuardianName,
      dob: pendingStudent.dob,
    });
    await student.save();

    // Record initial payment if any
    if (initial_payment > 0) {
      const gstRate = 18;
      const TotalGSTAmount = parseFloat(((initial_payment * gstRate) / (100 + gstRate)).toFixed(2));
      const CGST = parseFloat((TotalGSTAmount / 2).toFixed(2));
      const SGST = parseFloat((TotalGSTAmount / 2).toFixed(2));

      const payment = new Payment({
        studentId: student.studentId,
        PaidAmount: initial_payment,
        gstRate,
        TotalGSTAmount,
        CGST,
        SGST,
        description: 'Initial Payment',
      });
      await payment.save();
    }

    // Update and save installments with studentId
    if (hasInstallments) {
      installmentRecords.forEach(record => (record.studentId = student.studentId));
      await Installment.insertMany(installmentRecords);
    }

    // Remove the pending student record
    await PendingStudent.deleteOne({ token: req.params.token });

    res.json({ success: true, data: { message: 'Student approved', studentId: generatedStudentId } });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// View Pending Students - Admin can see all pending submissions
router.get('/pending-students', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const pendingStudents = await PendingStudent.find().lean();
    res.json({ success: true, data: pendingStudents });
  } catch (error) {
    console.error('Pending students fetch error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Export Pending Students as CSV - Optional backup feature
router.get('/export-pending-csv', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const pendingStudents = await PendingStudent.find().lean();
    const { Parser } = require('json2csv');
    const fields = ['name', 'address', 'email', 'course', 'phone', 'fatherOrGuardianName', 'dob'];
    const csv = new Parser({ fields }).parse(pendingStudents);

    res.setHeader('Content-disposition', 'attachment; filename=pending_students.csv');
    res.set('Content-Type', 'text/csv');
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
// Get Courses (Dynamic)
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().select('name').lean();
    res.json({ success: true, courses: courses.map(c => c.name) });
  } catch (error) {
    console.error('Courses fetch error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
//post courses for adding corse details 
router.post('/courses', authenticateToken, authorize(['admin']), [
  body('name').notEmpty().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { name } = req.body;
  try {
    const existingCourse = await Course.findOne({ name });
    if (existingCourse) return res.status(400).json({ success: false, error: 'Course already exists' });
    const course = new Course({ name });
    await course.save();
    res.json({ success: true, data: { message: 'Course added', name } });
  } catch (error) {
    console.error('Course add error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
//get student record for admin dashboard statistics section 
router.get('/students/by-phone', authenticateToken, authorize(['admin']), async (req, res) => {
  const { phone } = req.query;
  try {
    const student = await Student.findOne({ phone }).lean();
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' });
    res.json({ success: true, data: { studentId: student.studentId } });
  } catch (error) {
    console.error('Student fetch error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
module.exports = router;