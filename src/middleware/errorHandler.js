export const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query
  })

  // Default error
  let error = {
    message: err.message || 'Internal Server Error',
    status: err.status || 500
  }

  // Database connection errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    error = {
      message: 'Database connection failed',
      status: 503
    }
  }

  // PostgreSQL specific errors
  if (err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        error = {
          message: 'Resource already exists',
          status: 409
        }
        break
      case '23503': // foreign_key_violation
        error = {
          message: 'Referenced resource not found',
          status: 400
        }
        break
      case '23514': // check_violation
        error = {
          message: 'Invalid data provided',
          status: 400
        }
        break
      case '42P01': // undefined_table
        error = {
          message: 'Database schema error',
          status: 500
        }
        break
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      message: 'Invalid token',
      status: 401
    }
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      message: 'Token expired',
      status: 401
    }
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    error = {
      message: 'Validation failed',
      status: 400,
      details: err.details || []
    }
  }

  // Send error response
  res.status(error.status).json({
    success: false,
    error: {
      message: error.message,
      ...(error.details && { details: error.details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  })
}