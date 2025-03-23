const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const Student = require('../models/student');

// GET route to validate reset token
router.get('/reset-password/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const student = await Student.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!student) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    res.status(200).json({ message: 'Token is valid' });
  } catch (error) {
    console.error('Error validating reset token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST route to reset password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { newPassword } = req.body;
    
    // Basic password validation: ensure a minimum length of 8 characters.
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const token = req.params.token;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const student = await Student.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!student) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // Hash the new password and reset the token fields
    student.password = await bcrypt.hash(newPassword, 10);
    student.resetPasswordToken = undefined;
    student.resetPasswordExpires = undefined;

    await student.save();
    res.status(200).json({ message: 'Password has been reset' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
