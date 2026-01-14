import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken, requireCompanyAccess } from '../middleware/auth.js'

const router = express.Router()

// Apply authentication to all routes
router.use(authenticateToken)

// GET /api/leads - Get leads for a company with pagination
router.get('/', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id, 
      page = 1, 
      limit = 20, 
      status = null,
      search = ''
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Build filters
    let statusFilter = ''
    let searchFilter = ''
    let queryParams = [companyId, parseInt(limit), offset]
    let paramIndex = 4

    if (status !== null && !isNaN(status)) {
      statusFilter = `AND l.status = $${paramIndex}`
      queryParams.push(parseInt(status))
      paramIndex++
    }

    if (search) {
      searchFilter = `AND (l.name ILIKE $${paramIndex} OR l.email ILIKE $${paramIndex} OR l.phone_number ILIKE $${paramIndex})`
      queryParams.push(`%${search}%`)
    }

    // Get leads with contact information
    const result = await query(`
      SELECT 
        l.id,
        l.name,
        l.email,
        l.phone_number,
        l.location,
        l.privacy,
        l.marketing,
        l.lead_source,
        l.channel,
        l.landing_page,
        l.utms,
        l.created_at,
        ct.name as contact_name,
        ct.id as contact_id
      FROM leads l
      LEFT JOIN contacts ct ON l.contact_id = ct.id
      WHERE l.company_id = $1
        ${statusFilter}
        ${searchFilter}
      ORDER BY l.created_at DESC
      LIMIT $2 OFFSET $3
    `, queryParams)

    // Get total count
    const countParams = queryParams.slice(0, paramIndex - 2) // Remove limit and offset
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM leads l
      LEFT JOIN contacts ct ON l.contact_id = ct.id
      WHERE l.company_id = $1
        ${statusFilter.replace(`$${paramIndex - 1}`, `$${countParams.length + 1}`)}
        ${searchFilter.replace(`$${paramIndex}`, `$${countParams.length + (status !== null ? 2 : 1)}`)}
    `, countParams.concat(status !== null && !isNaN(status) ? [parseInt(status)] : []).concat(search ? [`%${search}%`] : []))

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    res.json({
      success: true,
      data: {
        leads: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    })

  } catch (error) {
    console.error('Leads error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch leads' }
    })
  }
})

// GET /api/leads/transferred - Get transferred leads for a company
router.get('/transferred', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id, 
      page = 1, 
      limit = 20,
      search = ''
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    let searchFilter = ''
    let queryParams = [companyId, parseInt(limit), offset]

    if (search) {
      searchFilter = `AND (l.name ILIKE $4 OR l.email ILIKE $4 OR tl.summary ILIKE $4)`
      queryParams.push(`%${search}%`)
    }

    const result = await query(`
      SELECT 
        tl.id as transfer_id,
        tl.summary,
        tl.zoho_id,
        tl.created_at as transfer_date,
        l.id as lead_id,
        l.name,
        l.email,
        l.phone_number,
        l.location,
        l.lead_source,
        l.channel,
        ct.name as contact_name,
        ct.id as contact_id
      FROM transferred_leads tl
      LEFT JOIN leads l ON tl.lead_id = l.id
      LEFT JOIN contacts ct ON tl.contact_id = ct.id
      WHERE tl.company_id = $1
        ${searchFilter}
      ORDER BY tl.created_at DESC
      LIMIT $2 OFFSET $3
    `, queryParams)

    // Get total count
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM transferred_leads tl
      LEFT JOIN leads l ON tl.lead_id = l.id
      WHERE tl.company_id = $1
        ${searchFilter.replace('$4', '$2')}
    `, search ? [companyId, `%${search}%`] : [companyId])

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    res.json({
      success: true,
      data: {
        transferredLeads: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    })

  } catch (error) {
    console.error('Transferred leads error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch transferred leads' }
    })
  }
})

// GET /api/leads/discarded - Get discarded leads for a company
router.get('/discarded', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id, 
      page = 1, 
      limit = 20 
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    const result = await query(`
      SELECT 
        dl.id,
        dl.summary,
        dl.created_at as discard_date,
        l.id as lead_id,
        l.name,
        l.email,
        l.phone_number,
        l.location,
        ct.name as contact_name
      FROM discarded_leads dl
      LEFT JOIN leads l ON dl.lead_id = l.id
      LEFT JOIN contacts ct ON dl.contact_id = ct.id
      LEFT JOIN sessions s ON dl.session_id = s.id
      WHERE s.company_id = $1
      ORDER BY dl.created_at DESC
      LIMIT $2 OFFSET $3
    `, [companyId, parseInt(limit), offset])

    // Get total count
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM discarded_leads dl
      LEFT JOIN sessions s ON dl.session_id = s.id
      WHERE s.company_id = $1
    `, [companyId])

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    res.json({
      success: true,
      data: {
        discardedLeads: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    })

  } catch (error) {
    console.error('Discarded leads error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch discarded leads' }
    })
  }
})

// GET /api/leads/:id - Get specific lead details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { message: 'Lead ID is required' }
      })
    }

    const result = await query(`
      SELECT 
        l.*,
        ct.name as contact_name,
        ct.phone_number as contact_phone,
        ct.email as contact_email,
        c.name as company_name,
        -- Check if transferred
        tl.id as transfer_id,
        tl.summary as transfer_summary,
        tl.zoho_id,
        tl.created_at as transfer_date,
        -- Check if discarded
        dl.id as discard_id,
        dl.summary as discard_summary,
        dl.created_at as discard_date
      FROM leads l
      LEFT JOIN contacts ct ON l.contact_id = ct.id
      LEFT JOIN companies c ON l.company_id = c.id
      LEFT JOIN transferred_leads tl ON l.id = tl.lead_id
      LEFT JOIN discarded_leads dl ON l.id = dl.lead_id
      WHERE l.id = $1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Lead not found' }
      })
    }

    const lead = result.rows[0]

    res.json({
      success: true,
      data: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone_number: lead.phone_number,
        location: lead.location,
        privacy: lead.privacy,
        marketing: lead.marketing,
        lead_source: lead.lead_source,
        channel: lead.channel,
        landing_page: lead.landing_page,
        utms: lead.utms,
        created_at: lead.created_at,
        contact: {
          id: lead.contact_id,
          name: lead.contact_name,
          phone_number: lead.contact_phone,
          email: lead.contact_email
        },
        company: {
          name: lead.company_name
        },
        status: {
          isTransferred: !!lead.transfer_id,
          isDiscarded: !!lead.discard_id,
          transfer: lead.transfer_id ? {
            id: lead.transfer_id,
            summary: lead.transfer_summary,
            zoho_id: lead.zoho_id,
            date: lead.transfer_date
          } : null,
          discard: lead.discard_id ? {
            id: lead.discard_id,
            summary: lead.discard_summary,
            date: lead.discard_date
          } : null
        }
      }
    })

  } catch (error) {
    console.error('Lead details error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch lead details' }
    })
  }
})

export default router