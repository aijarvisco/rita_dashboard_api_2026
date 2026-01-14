import express from 'express'
import jwt from 'jsonwebtoken'
import { supabase } from '../middleware/auth.js'

const router = express.Router()

// Login with email and password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email and password are required' }
      })
    }

    // Authenticate with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      return res.status(401).json({
        success: false,
        error: { message: error.message }
      })
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        sub: data.user.id,
        email: data.user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    res.json({
      success: true,
      data: {
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.full_name || data.user.email
        },
        session: {
          access_token: token,
          expires_at: data.session.expires_at
        }
      }
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Login failed' }
    })
  }
})

// OAuth login callback
router.post('/oauth', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body

    if (!access_token) {
      return res.status(400).json({
        success: false,
        error: { message: 'Access token is required' }
      })
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(access_token)

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid access token' }
      })
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        sub: user.id,
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email,
          avatar: user.user_metadata?.avatar_url
        },
        session: {
          access_token: token
        }
      }
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'OAuth authentication failed' }
    })
  }
})

// Logout
router.post('/logout', async (req, res) => {
  try {
    // Note: JWT tokens are stateless, so we just return success
    // In production, you might want to implement a token blacklist
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Logout failed' }
    })
  }
})

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: 'Access token required' }
      })
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
    // Verify with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid token' }
      })
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email,
          avatar: user.user_metadata?.avatar_url
        }
      }
    })

  } catch (error) {
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

    res.status(500).json({
      success: false,
      error: { message: 'Token verification failed' }
    })
  }
})

// Debug endpoint to test authentication
router.get('/debug', async (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    res.json({
      success: true,
      debug: {
        hasAuthHeader: !!authHeader,
        authHeader: authHeader,
        hasToken: !!token,
        tokenLength: token ? token.length : 0,
        jwtSecret: !!process.env.JWT_SECRET,
        jwtSecretLength: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Debug failed' }
    })
  }
})

export default router