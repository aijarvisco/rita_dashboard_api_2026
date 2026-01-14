import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // maximum number of connections in the pool
  connectionTimeoutMillis: 2000, // return error after 2 seconds if connection could not be established
  idleTimeoutMillis: 30000, // close connection after 30 seconds of inactivity
}

// Create connection pool
const pool = new Pool(dbConfig)

// Test database connection on startup
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database')
})

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err)
  process.exit(-1)
})

// Query function with error handling
export const query = async (text, params) => {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔍 Query executed: ${text.substring(0, 100)}... (${duration}ms)`)
    }
    
    return res
  } catch (error) {
    console.error('❌ Database query error:', {
      query: text,
      params,
      error: error.message
    })
    throw error
  }
}

// Transaction helper
export const transaction = async (callback) => {
  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Close database connection pool
export const closePool = async () => {
  await pool.end()
  console.log('🔌 Database connection pool closed')
}

export default pool