import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = express.Router()

// Apply authentication to all routes
router.use(authenticateToken)

// GET /api/companies - Get all companies
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        id,
        name,
        context,
        dealers,
        phone_number,
        phone_number_id,
        created_at
      FROM companies 
      ORDER BY name ASC
    `)

    res.json({
      success: true,
      data: result.rows
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch companies' }
    })
  }
})

// GET /api/companies/:id - Get company by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid company ID required' }
      })
    }

    const result = await query(`
      SELECT 
        id,
        name,
        context,
        dealers,
        phone_number,
        phone_number_id,
        created_at
      FROM companies 
      WHERE id = $1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Company not found' }
      })
    }

    res.json({
      success: true,
      data: result.rows[0]
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch company' }
    })
  }
})

// POST /api/companies - Create new company
router.post('/', async (req, res) => {
  try {
    const { name, context, dealers, phone_number, phone_number_id } = req.body

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company name is required' }
      })
    }

    const result = await query(`
      INSERT INTO companies (name, context, dealers, phone_number, phone_number_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, context, dealers, phone_number, phone_number_id, created_at
    `, [name, context, dealers, phone_number, phone_number_id])

    res.status(201).json({
      success: true,
      data: result.rows[0]
    })

  } catch (error) {
    if (error.code === '23505') { // unique_violation
      return res.status(409).json({
        success: false,
        error: { message: 'Company name already exists' }
      })
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to create company' }
    })
  }
})

// PUT /api/companies/:id - Update company
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, context, dealers, phone_number, phone_number_id } = req.body

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid company ID required' }
      })
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company name is required' }
      })
    }

    const result = await query(`
      UPDATE companies 
      SET 
        name = $1,
        context = $2,
        dealers = $3,
        phone_number = $4,
        phone_number_id = $5
      WHERE id = $6
      RETURNING id, name, context, dealers, phone_number, phone_number_id, created_at
    `, [name, context, dealers, phone_number, phone_number_id, id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Company not found' }
      })
    }

    res.json({
      success: true,
      data: result.rows[0]
    })

  } catch (error) {
    if (error.code === '23505') { // unique_violation
      return res.status(409).json({
        success: false,
        error: { message: 'Company name already exists' }
      })
    }

    res.status(500).json({
      success: false,
      error: { message: 'Failed to update company' }
    })
  }
})

// DELETE /api/companies/:id - Delete company
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid company ID required' }
      })
    }

    // Check if company has associated data
    const checkResult = await query(`
      SELECT 
        (SELECT COUNT(*) FROM conversations WHERE company_id = $1) as conversations_count,
        (SELECT COUNT(*) FROM leads WHERE company_id = $1) as leads_count,
        (SELECT COUNT(*) FROM sessions WHERE company_id = $1) as sessions_count
    `, [id])

    const counts = checkResult.rows[0]
    const totalRecords = parseInt(counts.conversations_count) + parseInt(counts.leads_count) + parseInt(counts.sessions_count)

    if (totalRecords > 0) {
      return res.status(409).json({
        success: false,
        error: { 
          message: 'Cannot delete company with associated data',
          details: {
            conversations: counts.conversations_count,
            leads: counts.leads_count,
            sessions: counts.sessions_count
          }
        }
      })
    }

    const result = await query('DELETE FROM companies WHERE id = $1 RETURNING id', [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Company not found' }
      })
    }

    res.json({
      success: true,
      message: 'Company deleted successfully'
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete company' }
    })
  }
})

export default router