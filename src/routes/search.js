import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken, requireCompanyAccess, optionalAuth } from '../middleware/auth.js'

const router = express.Router()

// Apply authentication to all routes
router.use(authenticateToken)

// GET /api/search/contacts - Search contacts
router.get('/contacts', optionalAuth, async (req, res) => {
  try {
    const { q: searchQuery, company_id, limit = 20 } = req.query
    
    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'Search query must be at least 2 characters long' }
      })
    }

    let queryParams = [`%${searchQuery.trim()}%`, parseInt(limit)]
    let companyFilter = ''

    if (company_id) {
      companyFilter = `
        AND EXISTS (
          SELECT 1 FROM contact_company cc 
          WHERE cc.contact_id = c.id AND cc.company_id = $3
        )
      `
      queryParams.push(parseInt(company_id))
    }

    const result = await query(`
      SELECT DISTINCT
        c.id,
        c.name,
        c.phone_number,
        c.email,
        c.created_at,
        -- Count related sessions
        (SELECT COUNT(*) FROM sessions s WHERE s.contact_id = c.id) as session_count,
        -- Count related leads
        (SELECT COUNT(*) FROM leads l WHERE l.contact_id = c.id) as lead_count,
        -- Get associated companies
        (
          SELECT json_agg(
            json_build_object('id', comp.id, 'name', comp.name)
          )
          FROM contact_company cc
          JOIN companies comp ON cc.company_id = comp.id
          WHERE cc.contact_id = c.id
        ) as companies
      FROM contacts c
      WHERE (
        c.name ILIKE $1
        OR c.email ILIKE $1
        OR c.phone_number::text ILIKE $1
      )
      ${companyFilter}
      ORDER BY c.created_at DESC
      LIMIT $2
    `, queryParams)

    res.json({
      success: true,
      data: {
        contacts: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          phone_number: row.phone_number,
          email: row.email,
          created_at: row.created_at,
          session_count: parseInt(row.session_count),
          lead_count: parseInt(row.lead_count),
          companies: row.companies || []
        })),
        query: searchQuery,
        total: result.rows.length
      }
    })

  } catch (error) {
    console.error('Contact search error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to search contacts' }
    })
  }
})

// GET /api/search/conversations - Search conversations
router.get('/conversations', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      q: searchQuery, 
      company_id, 
      limit = 20,
      session_status = null
    } = req.query
    
    const companyId = company_id || req.companyId

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'Search query must be at least 2 characters long' }
      })
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    let queryParams = [companyId, `%${searchQuery.trim()}%`, parseInt(limit)]
    let statusFilter = ''

    if (session_status !== null && !isNaN(session_status)) {
      statusFilter = 'AND s.status = $4'
      queryParams.push(parseInt(session_status))
    }

    const result = await query(`
      SELECT DISTINCT
        c.session_id,
        c.content,
        c.sender,
        c.created_at as message_time,
        s.status as session_status,
        s.created_at as session_created_at,
        ct.id as contact_id,
        ct.name as contact_name,
        ct.phone_number,
        ct.email as contact_email,
        -- Get message context (surrounding messages)
        (
          SELECT json_agg(
            json_build_object(
              'content', conv.content,
              'sender', conv.sender,
              'created_at', conv.created_at
            ) ORDER BY conv.created_at
          )
          FROM (
            SELECT content, sender, created_at
            FROM conversations
            WHERE session_id = c.session_id
              AND created_at BETWEEN c.created_at - INTERVAL '5 minutes' 
                                 AND c.created_at + INTERVAL '5 minutes'
            ORDER BY created_at
            LIMIT 5
          ) conv
        ) as message_context
      FROM conversations c
      JOIN sessions s ON c.session_id = s.id
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      WHERE s.company_id = $1
        AND c.content ILIKE $2
        ${statusFilter}
      ORDER BY c.created_at DESC
      LIMIT $3
    `, queryParams)

    res.json({
      success: true,
      data: {
        conversations: result.rows.map(row => ({
          session_id: row.session_id,
          matched_content: row.content,
          sender: row.sender,
          message_time: row.message_time,
          session_status: row.session_status,
          session_created_at: row.session_created_at,
          contact: {
            id: row.contact_id,
            name: row.contact_name,
            phone_number: row.phone_number,
            email: row.contact_email
          },
          message_context: row.message_context || []
        })),
        query: searchQuery,
        total: result.rows.length
      }
    })

  } catch (error) {
    console.error('Conversation search error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to search conversations' }
    })
  }
})

// GET /api/search/leads - Search leads
router.get('/leads', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      q: searchQuery, 
      company_id, 
      limit = 20,
      lead_source = null,
      channel = null
    } = req.query
    
    const companyId = company_id || req.companyId

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'Search query must be at least 2 characters long' }
      })
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    let queryParams = [companyId, `%${searchQuery.trim()}%`, parseInt(limit)]
    let filters = []
    let paramIndex = 4

    if (lead_source) {
      filters.push(`l.lead_source = $${paramIndex}`)
      queryParams.push(lead_source)
      paramIndex++
    }

    if (channel) {
      filters.push(`l.channel = $${paramIndex}`)
      queryParams.push(channel)
    }

    const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

    const result = await query(`
      SELECT 
        l.id,
        l.name,
        l.email,
        l.phone_number,
        l.location,
        l.lead_source,
        l.channel,
        l.landing_page,
        l.utms,
        l.created_at,
        ct.id as contact_id,
        ct.name as contact_name,
        -- Check transfer status
        tl.id as transfer_id,
        tl.summary as transfer_summary,
        tl.created_at as transfer_date,
        -- Check discard status
        dl.id as discard_id,
        dl.summary as discard_summary,
        dl.created_at as discard_date
      FROM leads l
      LEFT JOIN contacts ct ON l.contact_id = ct.id
      LEFT JOIN transferred_leads tl ON l.id = tl.lead_id
      LEFT JOIN discarded_leads dl ON l.id = dl.lead_id
      WHERE l.company_id = $1
        AND (
          l.name ILIKE $2
          OR l.email ILIKE $2
          OR l.phone_number ILIKE $2
          OR l.location ILIKE $2
          OR ct.name ILIKE $2
        )
        ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT $3
    `, queryParams)

    res.json({
      success: true,
      data: {
        leads: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          email: row.email,
          phone_number: row.phone_number,
          location: row.location,
          lead_source: row.lead_source,
          channel: row.channel,
          landing_page: row.landing_page,
          utms: row.utms,
          created_at: row.created_at,
          contact: {
            id: row.contact_id,
            name: row.contact_name
          },
          status: {
            is_transferred: !!row.transfer_id,
            is_discarded: !!row.discard_id,
            transfer: row.transfer_id ? {
              id: row.transfer_id,
              summary: row.transfer_summary,
              date: row.transfer_date
            } : null,
            discard: row.discard_id ? {
              id: row.discard_id,
              summary: row.discard_summary,
              date: row.discard_date
            } : null
          }
        })),
        query: searchQuery,
        total: result.rows.length
      }
    })

  } catch (error) {
    console.error('Lead search error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to search leads' }
    })
  }
})

// GET /api/search/stock - Search stock/vehicles
router.get('/stock', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      q: searchQuery, 
      company_id, 
      limit = 20 
    } = req.query
    
    const companyId = company_id || req.companyId

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'Search query must be at least 2 characters long' }
      })
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Get company name
    const companyResult = await query(`SELECT name FROM companies WHERE id = $1`, [companyId])
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Company not found' }
      })
    }

    const companyName = companyResult.rows[0].name

    const result = await query(`
      SELECT 
        id,
        "MARCA" as brand,
        "MODELO" as model,
        "VERSÃO" as version,
        "MATRICULA" as license_plate,
        "VIN" as vin,
        "PREÇO" as price,
        "QUILOMETROS" as kilometers,
        "CATEGORIA" as category,
        "TAGS" as tags,
        "LOCAL" as location,
        "COR EXTERIOR" as exterior_color,
        "TRANSMISSÃO" as transmission,
        "COMBUSTÍVEL" as fuel_type,
        "ANO MATRÍCULA" as registration_year,
        "MAIN_PHOTO" as main_photo,
        created_at
      FROM stock
      WHERE "EMPRESA" = $1
        AND (
          "MARCA" ILIKE $2
          OR "MODELO" ILIKE $2
          OR "VERSÃO" ILIKE $2
          OR "MATRICULA" ILIKE $2
          OR "VIN" ILIKE $2
          OR "CATEGORIA" ILIKE $2
          OR "TAGS" ILIKE $2
          OR "LOCAL" ILIKE $2
        )
      ORDER BY created_at DESC
      LIMIT $3
    `, [companyName, `%${searchQuery.trim()}%`, parseInt(limit)])

    res.json({
      success: true,
      data: {
        vehicles: result.rows,
        query: searchQuery,
        total: result.rows.length
      }
    })

  } catch (error) {
    console.error('Stock search error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to search stock' }
    })
  }
})

// GET /api/search/global - Global search across all entities
router.get('/global', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      q: searchQuery, 
      company_id 
    } = req.query
    
    const companyId = company_id || req.companyId

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'Search query must be at least 2 characters long' }
      })
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    const searchTerm = `%${searchQuery.trim()}%`

    // Search contacts
    const contactsPromise = query(`
      SELECT 'contact' as type, id, name, email, phone_number::text as phone, created_at
      FROM contacts c
      WHERE EXISTS (
        SELECT 1 FROM contact_company cc 
        WHERE cc.contact_id = c.id AND cc.company_id = $1
      )
      AND (c.name ILIKE $2 OR c.email ILIKE $2 OR c.phone_number::text ILIKE $2)
      LIMIT 5
    `, [companyId, searchTerm])

    // Search conversations
    const conversationsPromise = query(`
      SELECT 'conversation' as type, c.session_id as id, c.content as name, 
             ct.name as contact_name, c.created_at
      FROM conversations c
      JOIN sessions s ON c.session_id = s.id
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      WHERE s.company_id = $1 AND c.content ILIKE $2
      LIMIT 5
    `, [companyId, searchTerm])

    // Search leads
    const leadsPromise = query(`
      SELECT 'lead' as type, id, name, email, phone_number as phone, created_at
      FROM leads
      WHERE company_id = $1 
      AND (name ILIKE $2 OR email ILIKE $2 OR phone_number ILIKE $2)
      LIMIT 5
    `, [companyId, searchTerm])

    // Execute all searches in parallel
    const [contactsResult, conversationsResult, leadsResult] = await Promise.all([
      contactsPromise,
      conversationsPromise,
      leadsPromise
    ])

    res.json({
      success: true,
      data: {
        contacts: contactsResult.rows,
        conversations: conversationsResult.rows,
        leads: leadsResult.rows,
        query: searchQuery,
        total: contactsResult.rows.length + conversationsResult.rows.length + leadsResult.rows.length
      }
    })

  } catch (error) {
    console.error('Global search error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to perform global search' }
    })
  }
})

export default router