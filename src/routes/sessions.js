import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken, requireCompanyAccess } from '../middleware/auth.js'

const router = express.Router()

// Apply authentication to all routes
router.use(authenticateToken)

// GET /api/sessions - Get sessions for a company
router.get('/', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id, 
      status = null,
      page = 1,
      limit = 50
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    let statusFilter = ''
    let queryParams = [companyId, parseInt(limit), offset]

    if (status !== null && !isNaN(status)) {
      statusFilter = 'AND s.status = $4'
      queryParams.push(parseInt(status))
    }

    const result = await query(`
      SELECT 
        s.id,
        s.status,
        s.associated_leads,
        s.created_at,
        ct.id as contact_id,
        ct.name as contact_name,
        ct.phone_number,
        ct.email as contact_email,
        -- Count messages in this session
        (SELECT COUNT(*) FROM conversations c WHERE c.session_id = s.id) as message_count,
        -- Get last message
        (SELECT content FROM conversations c WHERE c.session_id = s.id ORDER BY c.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM conversations c WHERE c.session_id = s.id ORDER BY c.created_at DESC LIMIT 1) as last_message_time,
        -- Check if session has transferred leads
        (SELECT COUNT(*) FROM transferred_leads tl WHERE tl.session_id = s.id) as transferred_count,
        -- Check if session has discarded leads
        (SELECT COUNT(*) FROM discarded_leads dl WHERE dl.session_id = s.id) as discarded_count
      FROM sessions s
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      WHERE s.company_id = $1
        ${statusFilter}
      ORDER BY s.created_at DESC
      LIMIT $2 OFFSET $3
    `, queryParams)

    // Get total count
    const countParams = status !== null ? [companyId, parseInt(status)] : [companyId]
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM sessions s
      WHERE s.company_id = $1
        ${statusFilter.replace('$4', '$2')}
    `, countParams)

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    // Format sessions data
    const sessions = result.rows.map(row => ({
      id: row.id,
      status: row.status,
      associated_leads: row.associated_leads,
      created_at: row.created_at,
      message_count: parseInt(row.message_count),
      last_message: row.last_message,
      last_message_time: row.last_message_time,
      transferred_count: parseInt(row.transferred_count),
      discarded_count: parseInt(row.discarded_count),
      contact: {
        id: row.contact_id,
        name: row.contact_name,
        phone_number: row.phone_number,
        email: row.contact_email
      }
    }))

    res.json({
      success: true,
      data: {
        sessions,
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
    console.error('Sessions error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch sessions' }
    })
  }
})

// GET /api/sessions/stats - Get session statistics for a company
router.get('/stats', requireCompanyAccess, async (req, res) => {
  try {
    const { company_id } = req.query
    const companyId = company_id || req.companyId

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    const result = await query(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN status = 0 THEN 1 END) as new_sessions,
        COUNT(CASE WHEN status = 1 THEN 1 END) as active_sessions,
        COUNT(CASE WHEN status = 2 THEN 1 END) as qualifying_sessions,
        COUNT(CASE WHEN status = 3 THEN 1 END) as completed_sessions,
        COUNT(CASE WHEN status = 4 THEN 1 END) as abandoned_sessions,
        -- Sessions with transfers
        COUNT(DISTINCT tl.session_id) as sessions_with_transfers,
        -- Sessions with discards
        COUNT(DISTINCT dl.session_id) as sessions_with_discards,
        -- Average session duration (in hours)
        AVG(
          CASE 
            WHEN status >= 3 THEN 
              EXTRACT(EPOCH FROM (
                (SELECT MAX(created_at) FROM conversations c WHERE c.session_id = s.id) - s.created_at
              )) / 3600
            ELSE NULL
          END
        ) as avg_session_duration_hours
      FROM sessions s
      LEFT JOIN transferred_leads tl ON s.id = tl.session_id
      LEFT JOIN discarded_leads dl ON s.id = dl.session_id
      WHERE s.company_id = $1
    `, [companyId])

    const stats = result.rows[0]

    res.json({
      success: true,
      data: {
        total_sessions: parseInt(stats.total_sessions),
        new_sessions: parseInt(stats.new_sessions),
        active_sessions: parseInt(stats.active_sessions),
        qualifying_sessions: parseInt(stats.qualifying_sessions),
        completed_sessions: parseInt(stats.completed_sessions),
        abandoned_sessions: parseInt(stats.abandoned_sessions),
        sessions_with_transfers: parseInt(stats.sessions_with_transfers),
        sessions_with_discards: parseInt(stats.sessions_with_discards),
        avg_session_duration_hours: parseFloat(stats.avg_session_duration_hours) || 0
      }
    })

  } catch (error) {
    console.error('Session stats error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch session statistics' }
    })
  }
})

// GET /api/sessions/:id - Get specific session details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session ID is required' }
      })
    }

    const result = await query(`
      SELECT 
        s.id,
        s.status,
        s.associated_leads,
        s.created_at,
        ct.id as contact_id,
        ct.name as contact_name,
        ct.phone_number,
        ct.email as contact_email,
        ct.created_at as contact_created_at,
        c.name as company_name,
        -- Message statistics
        (SELECT COUNT(*) FROM conversations conv WHERE conv.session_id = s.id) as message_count,
        (SELECT content FROM conversations conv WHERE conv.session_id = s.id ORDER BY conv.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM conversations conv WHERE conv.session_id = s.id ORDER BY conv.created_at DESC LIMIT 1) as last_message_time,
        (SELECT created_at FROM conversations conv WHERE conv.session_id = s.id ORDER BY conv.created_at ASC LIMIT 1) as first_message_time,
        -- Knowledge vault count
        (SELECT COUNT(*) FROM knowledge_vault kv WHERE kv.session_id = s.id) as knowledge_count
      FROM sessions s
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      LEFT JOIN companies c ON s.company_id = c.id
      WHERE s.id = $1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Session not found' }
      })
    }

    const session = result.rows[0]

    // Get associated leads info
    const leadsResult = await query(`
      SELECT id, name, email, phone_number, lead_source, channel, created_at
      FROM leads
      WHERE company_id = (SELECT company_id FROM sessions WHERE id = $1)
        AND contact_id = (SELECT contact_id FROM sessions WHERE id = $1)
    `, [id])

    // Get transferred/discarded status
    const statusResult = await query(`
      SELECT 
        tl.id as transfer_id,
        tl.summary as transfer_summary,
        tl.created_at as transfer_date,
        dl.id as discard_id,
        dl.summary as discard_summary,
        dl.created_at as discard_date
      FROM sessions s
      LEFT JOIN transferred_leads tl ON s.id = tl.session_id
      LEFT JOIN discarded_leads dl ON s.id = dl.session_id
      WHERE s.id = $1
    `, [id])

    const statusInfo = statusResult.rows[0] || {}

    res.json({
      success: true,
      data: {
        id: session.id,
        status: session.status,
        associated_leads: session.associated_leads,
        created_at: session.created_at,
        message_count: parseInt(session.message_count),
        knowledge_count: parseInt(session.knowledge_count),
        last_message: session.last_message,
        last_message_time: session.last_message_time,
        first_message_time: session.first_message_time,
        contact: {
          id: session.contact_id,
          name: session.contact_name,
          phone_number: session.phone_number,
          email: session.contact_email,
          created_at: session.contact_created_at
        },
        company: {
          name: session.company_name
        },
        leads: leadsResult.rows,
        transfer_status: statusInfo.transfer_id ? {
          id: statusInfo.transfer_id,
          summary: statusInfo.transfer_summary,
          date: statusInfo.transfer_date
        } : null,
        discard_status: statusInfo.discard_id ? {
          id: statusInfo.discard_id,
          summary: statusInfo.discard_summary,
          date: statusInfo.discard_date
        } : null
      }
    })

  } catch (error) {
    console.error('Session details error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch session details' }
    })
  }
})

// PUT /api/sessions/:id/status - Update session status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!id || status === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session ID and status are required' }
      })
    }

    if (!Number.isInteger(status) || status < 0 || status > 4) {
      return res.status(400).json({
        success: false,
        error: { message: 'Status must be an integer between 0 and 4' }
      })
    }

    const result = await query(`
      UPDATE sessions 
      SET status = $1
      WHERE id = $2
      RETURNING id, status, created_at
    `, [status, id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Session not found' }
      })
    }

    res.json({
      success: true,
      data: result.rows[0]
    })

  } catch (error) {
    console.error('Session status update error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update session status' }
    })
  }
})

export default router