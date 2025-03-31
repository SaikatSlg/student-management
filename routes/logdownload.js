const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.post('/log-download', (req, res) => {
  const { studentId, actionType, invoiceNumber } = req.body;
  if (!studentId || !actionType || !invoiceNumber) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const date = `${String(now.getDate()).padStart(2, '0')}/${month}/${year}`;

  const logDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

  const logFilePath = path.join(logDir, `download-log-${year}-${month}.txt`);
  const logEntry = `StudentID: ${studentId}, Invoice: ${invoiceNumber}, Action: ${actionType}, Time: ${now.toISOString()}
`;

  if (!fs.existsSync(logFilePath) || !fs.readFileSync(logFilePath, 'utf-8').includes(`==== ${date} ====`)) {
    fs.appendFileSync(logFilePath, `\n==== ${date} ====\n`);
  }

  fs.appendFileSync(logFilePath, logEntry);

  res.status(200).json({ message: 'Download log saved successfully' });
});

module.exports = router;
