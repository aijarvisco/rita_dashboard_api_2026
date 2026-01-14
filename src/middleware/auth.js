import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// JWT middleware for API routes
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: 'Access token required' }
      })
    }

    // Verify JWT token (our custom JWT)
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
    // Add user info to request from JWT payload
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      ...decoded
    }

    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid token' }
      })
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { message: 'Token expired' }
      })
    }

    return res.status(500).json({
      success: false,
      error: { message: 'Authentication failed' }
    })
  }
}

// Optional authentication middleware (doesn't throw error if no token)
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
      if (!error && user) {
        req.user = {
          id: user.id,
          email: user.email,
          ...decoded
        }
      }
    }

    next()
  } catch (error) {
    // Continue without authentication
    next()
  }
}

// Company access middleware - ensures user can only access their company data
export const requireCompanyAccess = (req, res, next) => {
  try {
    const companyId = req.params.companyId || req.query.company_id || req.body.company_id

    if (!companyId || companyId === 'null' || companyId === 'undefined') {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid Company ID required' }
      })
    }

    const parsedCompanyId = parseInt(companyId)
    if (isNaN(parsedCompanyId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID must be a valid number' }
      })
    }

    // TODO: Add company access validation based on user permissions
    // For now, we'll store the company ID for use in queries
    req.companyId = parsedCompanyId
    
    next()
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: 'Company access validation failed' }
    })
  }
}

export { supabase }