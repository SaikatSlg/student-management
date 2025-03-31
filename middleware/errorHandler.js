const errorHandler = (err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  };
  
  module.exports = { errorHandler };