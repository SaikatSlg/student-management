const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const studentRoutes = require('./routes/student');
const paymentRoutes = require('./routes/payment');
const reportRoutes = require('./routes/reports');
const invoiceRoutes = require('./routes/invoice');
const { errorHandler } = require('./middleware/errorHandler');

dotenv.config();
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: "https://student-management-frontend-flax.vercel.app",
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Routes
app.use('/api/students', studentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/invoices', invoiceRoutes);


// Root endpoint
app.get('/', (req, res) => res.json({ message: 'Student Management System API' }));

// Error handling middleware
app.use(errorHandler);

// MongoDB Connection
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not defined');
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI, {
  //useNewUrlParser: true,
  //useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000,
})
  .then(() => console.log('✅ Connected to MongoDB Cloud Instance!'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  });

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));