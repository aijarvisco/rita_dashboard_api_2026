import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

// Import routes
import authRoutes from './routes/auth.js'
import companiesRoutes from './routes/companies.js'
import metricsRoutes from './routes/metrics.js'
import conversationsRoutes from './routes/conversations.js'
import leadsRoutes from './routes/leads.js'
import sessionsRoutes from './routes/sessions.js'
import stockRoutes from './routes/stock.js'
import searchRoutes from './routes/search.js'

// Import middleware
import { errorHandler } from './middleware/errorHandler.js'
import { notFoundHandler } from './middleware/notFoundHandler.js'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Security middleware
app.use(helmet())

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173', // Development
  'http://localhost:4173', // Vite preview
  process.env.FRONTEND_URL, // Custom frontend URL
  /^https:\/\/.*\.vercel\.app$/, // Vercel deployments
].filter(Boolean) // Remove undefined values

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', limiter)

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'))
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Rita v2 API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  })
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/companies', companiesRoutes)
app.use('/api/metrics', metricsRoutes)
app.use('/api/conversations', conversationsRoutes)
app.use('/api/leads', leadsRoutes)
app.use('/api/sessions', sessionsRoutes)
app.use('/api/stock', stockRoutes)
app.use('/api/search', searchRoutes)

// Error handling middleware
app.use(notFoundHandler)
app.use(errorHandler)

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Rita v2 API Server running on port ${PORT}`)
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`)
  })
}

export default app