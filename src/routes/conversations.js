import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken, requireCompanyAccess } from '../middleware/auth.js'

const router = express.Router()

// GET /api/conversations/qualification-statuses - Get all qualification statuses (no auth needed)
router.get('/qualification-statuses', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, description
      FROM qualification_statuses
      ORDER BY id
    `)

    res.json({
      success: true,
      data: result.rows
    })

  } catch (error) {
    console.error('Qualification statuses error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch qualification statuses' }
    })
  }
})

// Apply authentication to all other routes
router.use(authenticateToken)

// Test endpoint to verify authentication and basic database access
router.get('/test', async (req, res) => {
  try {
    console.log('🧪 Test endpoint called')
    
    // Test basic query
    const testResult = await query('SELECT COUNT(*) as total FROM contacts')
    console.log('🧪 Test query result:', testResult.rows[0])
    
    res.json({
      success: true,
      message: 'Test endpoint working',
      data: {
        total_contacts: parseInt(testResult.rows[0].total),
        user: req.user,
        companyId: req.companyId
      }
    })
  } catch (error) {
    console.error('🧪 Test endpoint error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Test endpoint failed: ' + error.message }
    })
  }
})

// GET /api/conversations - Get paginated conversations for a company
router.get('/', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id, 
      page = 1, 
      limit = 20, 
      search = '', 
      status = null 
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Build search and status filters
    let searchFilter = ''
    let statusFilter = ''
    let queryParams = [companyId, parseInt(limit), offset]
    let paramIndex = 4

    if (search) {
      searchFilter = `AND (ct.name ILIKE $${paramIndex} OR ct.phone_number::text ILIKE $${paramIndex} OR ct.email ILIKE $${paramIndex})`
      queryParams.push(`%${search}%`)
      paramIndex++
    }

    if (status !== null && !isNaN(status)) {
      statusFilter = `AND s.status = $${paramIndex}`
      queryParams.push(parseInt(status))
    }

    // Get conversations with contact info and session status
    const conversationsResult = await query(`
      SELECT DISTINCT ON (s.id)
        s.id as session_id,
        s.status,
        s.created_at as session_created_at,
        ct.id as contact_id,
        ct.name as contact_name,
        ct.phone_number,
        ct.email as contact_email,
        last_msg.content as last_message,
        last_msg.created_at as last_message_time,
        last_msg.sender as last_message_sender,
        msg_count.total_messages
      FROM sessions s
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      LEFT JOIN LATERAL (
        SELECT content, created_at, sender
        FROM conversations c
        WHERE c.session_id = s.id
        ORDER BY c.created_at DESC
        LIMIT 1
      ) last_msg ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as total_messages
        FROM conversations c
        WHERE c.session_id = s.id
      ) msg_count ON true
      WHERE s.company_id = $1
        ${searchFilter}
        ${statusFilter}
      ORDER BY s.id, last_msg.created_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, queryParams)

    // Get total count for pagination
    const countQuery = queryParams.slice(0, paramIndex - 3) // Remove limit and offset
    countQuery[0] = companyId // Keep company_id as first param
    
    const countResult = await query(`
      SELECT COUNT(DISTINCT s.id) as total
      FROM sessions s
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      LEFT JOIN conversations c ON s.id = c.session_id
      WHERE s.company_id = $1
        ${searchFilter.replace('$' + (paramIndex - 1), '$2')}
        ${statusFilter.replace('$' + paramIndex, '$' + (search ? 3 : 2))}
    `, search ? [companyId, `%${search}%`, ...(status !== null ? [parseInt(status)] : [])] : [companyId, ...(status !== null ? [parseInt(status)] : [])])

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    // Format the response data
    const conversations = conversationsResult.rows.map(row => ({
      session_id: row.session_id,
      contact_id: row.contact_id,
      contact_name: row.contact_name || 'Unknown',
      phone_number: row.phone_number,
      contact_email: row.contact_email,
      last_message: row.last_message || 'No messages',
      last_message_time: row.last_message_time,
      last_message_sender: row.last_message_sender,
      status: row.status,
      session_created_at: row.session_created_at,
      total_messages: parseInt(row.total_messages) || 0
    }))

    res.json({
      success: true,
      data: {
        conversations,
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
    console.error('Conversations error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch conversations' }
    })
  }
})

// GET /api/conversations/:sessionId/messages - Get all messages for a conversation
router.get('/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { limit = 100, offset = 0 } = req.query

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session ID is required' }
      })
    }

    // Get messages for the session
    const result = await query(`
      SELECT 
        c.id,
        c.content,
        c.sender,
        c.created_at,
        c.wa_id,
        ct.name as contact_name,
        ct.phone_number
      FROM conversations c
      LEFT JOIN sessions s ON c.session_id = s.id
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      WHERE c.session_id = $1
      ORDER BY c.created_at ASC
      LIMIT $2 OFFSET $3
    `, [sessionId, parseInt(limit), parseInt(offset)])

    // Get total message count
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM conversations
      WHERE session_id = $1
    `, [sessionId])

    const total = parseInt(countResult.rows[0].total)

    res.json({
      success: true,
      data: {
        messages: result.rows,
        total,
        session_id: sessionId
      }
    })

  } catch (error) {
    console.error('Messages error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch messages' }
    })
  }
})

// GET /api/conversations/:sessionId/knowledge - Get knowledge vault entries for a session
router.get('/:sessionId/knowledge', async (req, res) => {
  try {
    const { sessionId } = req.params

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session ID is required' }
      })
    }

    const result = await query(`
      SELECT 
        kv.id,
        kv.key,
        kv.value,
        kv.created_at,
        ct.name as contact_name
      FROM knowledge_vault kv
      LEFT JOIN sessions s ON kv.session_id = s.id
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      WHERE kv.session_id = $1
      ORDER BY kv.created_at DESC
    `, [sessionId])

    res.json({
      success: true,
      data: result.rows
    })

  } catch (error) {
    console.error('Knowledge error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch knowledge vault data' }
    })
  }
})

// POST /api/conversations/:sessionId/knowledge - Add knowledge vault entry
router.post('/:sessionId/knowledge', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { key, value } = req.body

    if (!sessionId || !key || !value) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session ID, key, and value are required' }
      })
    }

    // Get session info
    const sessionResult = await query(`
      SELECT contact_id, company_id 
      FROM sessions 
      WHERE id = $1
    `, [sessionId])

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Session not found' }
      })
    }

    const { contact_id, company_id } = sessionResult.rows[0]

    // Insert knowledge entry
    const result = await query(`
      INSERT INTO knowledge_vault (contact_id, session_id, key, value, company_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, key, value, created_at
    `, [contact_id, sessionId, key, value, company_id])

    res.status(201).json({
      success: true,
      data: result.rows[0]
    })

  } catch (error) {
    console.error('Knowledge creation error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create knowledge entry' }
    })
  }
})

// GET /api/conversations/contacts - Get contacts grouped with their sessions
// NOTE: Static /contacts routes must be defined BEFORE the dynamic /:sessionId route
router.get('/contacts', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id, 
      page = 1, 
      limit = 20, 
      search = '', 
      status = null 
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Build search and status filters
    let searchFilter = ''
    let statusFilter = ''
    let queryParams = [companyId, parseInt(limit), offset]
    let paramIndex = 4

    if (search) {
      searchFilter = `AND (ct.name ILIKE $${paramIndex} OR ct.phone_number::text ILIKE $${paramIndex} OR ct.email ILIKE $${paramIndex})`
      queryParams.push(`%${search}%`)
      paramIndex++
    }

    if (status !== null && !isNaN(status)) {
      statusFilter = `AND EXISTS (SELECT 1 FROM sessions s2 WHERE s2.contact_id = ct.id AND s2.company_id = $1 AND s2.status = $${paramIndex})`
      queryParams.push(parseInt(status))
    }

    // Get contacts with their session information using a step-by-step approach
    const contactsResult = await query(`
      SELECT 
        ct.id as contact_id,
        ct.name as contact_name,
        ct.phone_number,
        ct.email as contact_email,
        ct.created_at as contact_created_at,
        COUNT(s.id) as session_count,
        MAX(s.created_at) as last_session_time,
        COUNT(CASE WHEN s.status IN (1, 2) THEN 1 END) as active_sessions,
        (
          SELECT s2.status 
          FROM sessions s2 
          WHERE s2.contact_id = ct.id AND s2.company_id = $1 
          ORDER BY s2.created_at DESC 
          LIMIT 1
        ) as latest_status,
        (
          SELECT c.content 
          FROM conversations c
          JOIN sessions s3 ON c.session_id = s3.id
          WHERE s3.contact_id = ct.id AND s3.company_id = $1
          ORDER BY c.created_at DESC
          LIMIT 1
        ) as last_message,
        (
          SELECT c.created_at 
          FROM conversations c
          JOIN sessions s4 ON c.session_id = s4.id
          WHERE s4.contact_id = ct.id AND s4.company_id = $1
          ORDER BY c.created_at DESC
          LIMIT 1
        ) as last_message_time,
        (
          SELECT c.sender 
          FROM conversations c
          JOIN sessions s5 ON c.session_id = s5.id
          WHERE s5.contact_id = ct.id AND s5.company_id = $1
          ORDER BY c.created_at DESC
          LIMIT 1
        ) as last_message_sender
      FROM contacts ct
      INNER JOIN sessions s ON s.contact_id = ct.id
      WHERE s.company_id = $1
        ${searchFilter}
        ${statusFilter}
      GROUP BY ct.id, ct.name, ct.phone_number, ct.email, ct.created_at
      ORDER BY MAX(
        COALESCE((
          SELECT c.created_at 
          FROM conversations c
          JOIN sessions s6 ON c.session_id = s6.id
          WHERE s6.contact_id = ct.id AND s6.company_id = $1
          ORDER BY c.created_at DESC
          LIMIT 1
        ), ct.created_at)
      ) DESC
      LIMIT $2 OFFSET $3
    `, queryParams)

    // Get total count for pagination
    const countResult = await query(`
      SELECT COUNT(DISTINCT ct.id) as total
      FROM contacts ct
      INNER JOIN sessions s ON s.contact_id = ct.id
      WHERE s.company_id = $1
        ${searchFilter.replace('$' + (paramIndex - 1), '$2')}
        ${statusFilter.replace('$' + paramIndex, '$' + (search ? 3 : 2))}
    `, search ? [companyId, `%${search}%`, ...(status !== null ? [parseInt(status)] : [])] : [companyId, ...(status !== null ? [parseInt(status)] : [])])

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    // Format the response data
    const contacts = contactsResult.rows.map(row => ({
      contact_id: row.contact_id,
      contact_name: row.contact_name || 'Unknown',
      phone_number: row.phone_number,
      contact_email: row.contact_email,
      contact_created_at: row.contact_created_at,
      session_count: parseInt(row.session_count) || 0,
      last_session_time: row.last_session_time,
      last_message: row.last_message || 'No messages',
      last_message_time: row.last_message_time,
      last_message_sender: row.last_message_sender,
      active_sessions: parseInt(row.active_sessions) || 0,
      latest_status: row.latest_status
    }))

    res.json({
      success: true,
      data: {
        contacts,
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
    console.error('Contacts error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contacts' }
    })
  }
})

// GET /api/conversations/contacts/:contactId/sessions - Get all sessions for a contact
router.get('/contacts/:contactId/sessions', requireCompanyAccess, async (req, res) => {
  try {
    const { contactId } = req.params
    const { company_id } = req.query
    const companyId = company_id || req.companyId

    if (!contactId || !companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contact ID and Company ID are required' }
      })
    }

    // Get all sessions for the contact
    const sessionsResult = await query(`
      SELECT 
        s.id as session_id,
        s.status,
        s.associated_leads,
        s.created_at as session_created_at,
        (SELECT COUNT(*) FROM conversations c WHERE c.session_id = s.id) as message_count,
        (SELECT content FROM conversations c WHERE c.session_id = s.id ORDER BY c.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM conversations c WHERE c.session_id = s.id ORDER BY c.created_at DESC LIMIT 1) as last_message_time,
        (SELECT sender FROM conversations c WHERE c.session_id = s.id ORDER BY c.created_at DESC LIMIT 1) as last_message_sender
      FROM sessions s
      WHERE s.contact_id = $1 AND s.company_id = $2
      ORDER BY s.created_at DESC
    `, [contactId, companyId])

    res.json({
      success: true,
      data: {
        contact_id: contactId,
        sessions: sessionsResult.rows.map(row => ({
          session_id: row.session_id,
          status: row.status,
          associated_leads: row.associated_leads,
          session_created_at: row.session_created_at,
          message_count: parseInt(row.message_count) || 0,
          last_message: row.last_message,
          last_message_time: row.last_message_time,
          last_message_sender: row.last_message_sender
        }))
      }
    })

  } catch (error) {
    console.error('Contact sessions error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contact sessions' }
    })
  }
})

// GET /api/conversations/contacts/:contactId/messages - Get all messages for a contact across all sessions
router.get('/contacts/:contactId/messages', requireCompanyAccess, async (req, res) => {
  try {
    const { contactId } = req.params
    const { company_id, limit = 500 } = req.query
    const companyId = company_id || req.companyId

    if (!contactId || !companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contact ID and Company ID are required' }
      })
    }

    // Get all messages for the contact across all sessions, ordered chronologically
    const messagesResult = await query(`
      SELECT 
        c.id,
        c.content,
        c.sender,
        c.created_at,
        c.wa_id,
        c.session_id,
        s.status as session_status,
        s.created_at as session_created_at,
        ct.name as contact_name,
        ct.phone_number,
        -- Mark session start messages
        CASE WHEN c.id = (
          SELECT MIN(c2.id) 
          FROM conversations c2 
          WHERE c2.session_id = c.session_id
        ) THEN true ELSE false END as is_session_start
      FROM conversations c
      JOIN sessions s ON c.session_id = s.id
      JOIN contacts ct ON s.contact_id = ct.id
      WHERE s.contact_id = $1 AND s.company_id = $2
      ORDER BY c.created_at ASC
      LIMIT $3
    `, [contactId, companyId, parseInt(limit)])

    // Group messages by session for easier frontend handling
    const sessionGroups = {}
    const messages = messagesResult.rows.map(row => {
      if (!sessionGroups[row.session_id]) {
        sessionGroups[row.session_id] = {
          session_id: row.session_id,
          session_status: row.session_status,
          session_created_at: row.session_created_at
        }
      }
      
      return {
        id: row.id,
        content: row.content,
        sender: row.sender,
        created_at: row.created_at,
        wa_id: row.wa_id,
        session_id: row.session_id,
        contact_name: row.contact_name,
        phone_number: row.phone_number,
        is_session_start: row.is_session_start
      }
    })

    res.json({
      success: true,
      data: {
        contact_id: contactId,
        messages,
        session_groups: Object.values(sessionGroups),
        total_messages: messages.length
      }
    })

  } catch (error) {
    console.error('Contact messages error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contact messages' }
    })
  }
})

// GET /api/conversations/contacts/:contactId/knowledge - Get all knowledge vault entries for a contact
router.get('/contacts/:contactId/knowledge', requireCompanyAccess, async (req, res) => {
  try {
    const { contactId } = req.params
    const { company_id } = req.query
    const companyId = company_id || req.companyId

    if (!contactId || !companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contact ID and Company ID are required' }
      })
    }

    const knowledgeResult = await query(`
      SELECT 
        kv.id,
        kv.key,
        kv.value,
        kv.created_at,
        kv.session_id,
        s.created_at as session_created_at,
        s.status as session_status,
        ct.name as contact_name
      FROM knowledge_vault kv
      JOIN sessions s ON kv.session_id = s.id
      JOIN contacts ct ON s.contact_id = ct.id
      WHERE kv.contact_id = $1 AND kv.company_id = $2
      ORDER BY kv.created_at DESC
    `, [contactId, companyId])

    // Group knowledge by session
    const knowledgeBySession = {}
    knowledgeResult.rows.forEach(row => {
      if (!knowledgeBySession[row.session_id]) {
        knowledgeBySession[row.session_id] = {
          session_id: row.session_id,
          session_created_at: row.session_created_at,
          session_status: row.session_status,
          knowledge_entries: []
        }
      }
      
      knowledgeBySession[row.session_id].knowledge_entries.push({
        id: row.id,
        key: row.key,
        value: row.value,
        created_at: row.created_at
      })
    })

    res.json({
      success: true,
      data: {
        contact_id: contactId,
        knowledge_by_session: Object.values(knowledgeBySession),
        total_entries: knowledgeResult.rows.length
      }
    })

  } catch (error) {
    console.error('Contact knowledge error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contact knowledge vault data' }
    })
  }
})

// GET /api/conversations/:sessionId - Get conversation session details
// NOTE: This catch-all route must be AFTER all static routes (e.g. /contacts)
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session ID is required' }
      })
    }

    const result = await query(`
      SELECT
        s.id as session_id,
        s.status,
        s.associated_leads,
        s.created_at as session_created_at,
        ct.id as contact_id,
        ct.name as contact_name,
        ct.phone_number,
        ct.email as contact_email,
        ct.created_at as contact_created_at,
        c.name as company_name,
        -- Count messages
        (SELECT COUNT(*) FROM conversations WHERE session_id = s.id) as message_count,
        -- Get latest message
        (SELECT content FROM conversations WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM conversations WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message_time
      FROM sessions s
      LEFT JOIN contacts ct ON s.contact_id = ct.id
      LEFT JOIN companies c ON s.company_id = c.id
      WHERE s.id = $1
    `, [sessionId])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Session not found' }
      })
    }

    const session = result.rows[0]

    res.json({
      success: true,
      data: {
        session_id: session.session_id,
        status: session.status,
        associated_leads: session.associated_leads,
        session_created_at: session.session_created_at,
        message_count: parseInt(session.message_count),
        last_message: session.last_message,
        last_message_time: session.last_message_time,
        contact: {
          id: session.contact_id,
          name: session.contact_name,
          phone_number: session.phone_number,
          email: session.contact_email,
          created_at: session.contact_created_at
        },
        company: {
          name: session.company_name
        }
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

export default router