const jwt = require('jsonwebtoken');
const Student = require('../models/student');

const authenticateToken = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Access denied' });

  try {
    const userData = jwt.verify(token, process.env.JWT_SECRET);
    const student = await Student.findOne({ studentId: userData.id });
    if (!student) return res.status(404).json({ success: false, error: 'User not found' });

    req.user = student;
    next();
  } catch (err) {
    res.status(403).json({ success: false, error: 'Invalid token' });
  }
};

const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  next();
};

module.exports = { authenticateToken, authorize };