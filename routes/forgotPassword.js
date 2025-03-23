const express = require('express');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const dotenv = require('dotenv');
dotenv.config();
const router = express.Router();
const Student = require('../models/student');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Check if email is provided
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format using a simple regex
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Find the student by email.
    // For security, do not disclose if the email doesn't exist.
    const student = await Student.findOne({ email });
    let resetToken;
    if (student) {
      // Generate a secure token and hash it
      resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // Set token and expiry (e.g., 1 hour)
      student.resetPasswordToken = hashedToken;
      student.resetPasswordExpires = Date.now() + 3600000; // 1 hour

      await student.save();
    }

    // Construct the reset URL using the generated token (if student exists)
    // Use a frontend URL from env variables (fallback provided)
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken || 'invalid-token'}`;

    const msg = {
      to: email,
      from: process.env.SENDGRID_SENDER_EMAIL,
      subject: 'Password Reset Instructions',
      text: `We received a request to reset your password. Please use the following link to reset your password: ${resetUrl}. If you did not request this, please ignore this email.`,
      html: `<p>We received a request to reset your password.</p>
             <p>Please click <a href="${resetUrl}">here</a> to reset your password.</p>
             <p>If you did not request this, please ignore this email.</p>`,
    };

    await sgMail.send(msg);
    res.status(200).json({ message: 'If an account with that email exists, password reset instructions have been sent.' });
  } catch (error) {
    console.error('Error in forgot-password route:', error);
    res.status(500).json({ error: 'Failed to send reset instructions.' });
  }
});

module.exports = router;
