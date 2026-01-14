import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken, requireCompanyAccess } from '../middleware/auth.js'

const router = express.Router()

// Apply authentication to all routes
router.use(authenticateToken)

// GET /api/metrics - Get dashboard metrics for a company
router.get('/', requireCompanyAccess, async (req, res) => {
  try {
    const { company_id, start_date, end_date } = req.query
    const companyId = company_id || req.companyId

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Build date filter
    let dateFilter = ''
    let queryParams = [companyId]

    if (start_date && end_date) {
      dateFilter = 'AND created_at BETWEEN $2 AND $3'
      queryParams.push(start_date, end_date)
    }

    // Get total conversations initiated (total sessions)
    const conversationsResult = await query(`
      SELECT COUNT(*) as total_conversations
      FROM sessions
      WHERE company_id = $1 ${dateFilter.replace('created_at', 'created_at')}
    `, queryParams)

    // Get transferred leads count
    const transferredLeadsResult = await query(`
      SELECT COUNT(*) as transferred_leads
      FROM transferred_leads
      WHERE company_id = $1 ${dateFilter}
    `, queryParams)

    // Get transferred sessions count for qualification percentage
    const transferredSessionsResult = await query(`
      SELECT COUNT(DISTINCT tl.session_id) as transferred_sessions
      FROM transferred_leads tl
      WHERE tl.company_id = $1 ${dateFilter}
    `, queryParams)

    // Get average messages per session
    const avgMessagesResult = await query(`
      SELECT
        AVG(message_count) as avg_messages_per_session
      FROM (
        SELECT
          s.id,
          COUNT(c.id) as message_count
        FROM sessions s
        LEFT JOIN conversations c ON s.id = c.session_id
        WHERE s.company_id = $1
          ${dateFilter.replace('created_at', 's.created_at')}
        GROUP BY s.id
      ) as session_message_counts
    `, queryParams)

    // Get active sessions count
    const activeSessionsResult = await query(`
      SELECT COUNT(*) as active_sessions
      FROM sessions
      WHERE company_id = $1
        AND status IN (0, 1, 2)
        ${dateFilter}
    `, queryParams)

    const totalConversations = parseInt(conversationsResult.rows[0].total_conversations)
    const transferredLeads = parseInt(transferredLeadsResult.rows[0].transferred_leads)
    const transferredSessions = parseInt(transferredSessionsResult.rows[0].transferred_sessions)
    const avgMessages = parseFloat(avgMessagesResult.rows[0].avg_messages_per_session) || 0
    const activeSessions = parseInt(activeSessionsResult.rows[0].active_sessions)

    // Calculate qualification percentage (transferred sessions / total sessions)
    const qualificationPercentage = totalConversations > 0 ? ((transferredSessions / totalConversations) * 100) : 0

    res.json({
      success: true,
      data: {
        totalConversations,
        transferredLeads,
        qualificationPercentage: Math.round(qualificationPercentage * 100) / 100,
        avgMessagesPerSession: Math.round(avgMessages * 100) / 100,
        activeSessions,
        transferredSessions
      }
    })

  } catch (error) {
    console.error('Metrics error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch metrics' }
    })
  }
})

// GET /api/metrics/historical - Get historical metrics data
router.get('/historical', requireCompanyAccess, async (req, res) => {
  try {
    const { company_id, months = 6 } = req.query
    const companyId = company_id || req.companyId

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    const monthsBack = parseInt(months) || 6

    // First try to get data from test_metrics table
    const testData = await query(`
      SELECT
        month,
        "totalConversations",
        "transferredLeads",
        "totalLeads",
        "qualificationPercentage"
      FROM test_metrics
      WHERE company_id = $1
      ORDER BY month
      LIMIT $2
    `, [companyId, monthsBack])

    if (testData.rows.length > 0) {
      res.json({
        success: true,
        data: testData.rows
      })
      return
    }

    // Fallback to real data if test data doesn't exist
    const historicalData = await query(`
      WITH months AS (
        SELECT
          date_trunc('month', CURRENT_DATE - INTERVAL '1 month' * generate_series(0, $2 - 1)) as month_start,
          date_trunc('month', CURRENT_DATE - INTERVAL '1 month' * generate_series(0, $2 - 1)) + INTERVAL '1 month' - INTERVAL '1 day' as month_end
        ORDER BY month_start
      ),
      monthly_conversations AS (
        SELECT
          date_trunc('month', s.created_at) as month,
          COUNT(*) as total_conversations
        FROM sessions s
        WHERE s.company_id = $1
          AND s.created_at >= CURRENT_DATE - INTERVAL '1 month' * $2
        GROUP BY date_trunc('month', s.created_at)
      ),
      monthly_transferred AS (
        SELECT
          date_trunc('month', tl.created_at) as month,
          COUNT(*) as transferred_leads,
          COUNT(DISTINCT tl.session_id) as transferred_sessions
        FROM transferred_leads tl
        WHERE tl.company_id = $1
          AND tl.created_at >= CURRENT_DATE - INTERVAL '1 month' * $2
        GROUP BY date_trunc('month', tl.created_at)
      )
      SELECT
        m.month_start as month,
        COALESCE(mc.total_conversations, 0) as "totalConversations",
        COALESCE(mt.transferred_leads, 0) as "transferredLeads",
        COALESCE(mt.transferred_sessions, 0) as "transferredSessions",
        CASE
          WHEN COALESCE(mc.total_conversations, 0) > 0
          THEN ROUND((COALESCE(mt.transferred_sessions, 0)::decimal / mc.total_conversations * 100), 2)
          ELSE 0
        END as "qualificationPercentage"
      FROM months m
      LEFT JOIN monthly_conversations mc ON m.month_start = mc.month
      LEFT JOIN monthly_transferred mt ON m.month_start = mt.month
      ORDER BY m.month_start
    `, [companyId, monthsBack])

    res.json({
      success: true,
      data: historicalData.rows
    })

  } catch (error) {
    console.error('Historical metrics error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch historical metrics' }
    })
  }
})

// GET /api/metrics/summary - Get summary metrics by company
router.get('/summary', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        c.id,
        c.name,
        COUNT(DISTINCT s.id) as total_conversations,
        COUNT(DISTINCT tl.id) as transferred_leads,
        COUNT(DISTINCT tl.session_id) as transferred_sessions,
        CASE
          WHEN COUNT(DISTINCT s.id) > 0
          THEN ROUND((COUNT(DISTINCT tl.session_id)::decimal / COUNT(DISTINCT s.id) * 100), 2)
          ELSE 0
        END as qualification_percentage
      FROM companies c
      LEFT JOIN sessions s ON c.id = s.company_id
      LEFT JOIN transferred_leads tl ON c.id = tl.company_id
      GROUP BY c.id, c.name
      ORDER BY c.name
    `)

    res.json({
      success: true,
      data: result.rows
    })

  } catch (error) {
    console.error('Summary metrics error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch summary metrics' }
    })
  }
})

// GET /api/metrics/realtime - Get real-time metrics for dashboard
router.get('/realtime', requireCompanyAccess, async (req, res) => {
  try {
    const { company_id } = req.query
    const companyId = company_id || req.companyId

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Get metrics for today, yesterday, and this month
    const result = await query(`
      SELECT
        -- Today's metrics
        COUNT(CASE WHEN s.created_at::date = CURRENT_DATE THEN 1 END) as conversations_today,
        COUNT(CASE WHEN tl.created_at::date = CURRENT_DATE THEN 1 END) as transfers_today,

        -- Yesterday's metrics
        COUNT(CASE WHEN s.created_at::date = CURRENT_DATE - 1 THEN 1 END) as conversations_yesterday,
        COUNT(CASE WHEN tl.created_at::date = CURRENT_DATE - 1 THEN 1 END) as transfers_yesterday,

        -- This month's metrics
        COUNT(CASE WHEN date_trunc('month', s.created_at) = date_trunc('month', CURRENT_DATE) THEN 1 END) as conversations_this_month,
        COUNT(CASE WHEN date_trunc('month', tl.created_at) = date_trunc('month', CURRENT_DATE) THEN 1 END) as transfers_this_month,

        -- Active sessions right now
        COUNT(CASE WHEN s.status IN (0, 1, 2) THEN 1 END) as active_sessions

      FROM companies comp
      LEFT JOIN sessions s ON comp.id = s.company_id
      LEFT JOIN transferred_leads tl ON comp.id = tl.company_id
      WHERE comp.id = $1
    `, [companyId])

    const metrics = result.rows[0]

    // Calculate growth percentages
    const conversationGrowth = metrics.conversations_yesterday > 0
      ? ((metrics.conversations_today - metrics.conversations_yesterday) / metrics.conversations_yesterday * 100)
      : (metrics.conversations_today > 0 ? 100 : 0)

    const transferGrowth = metrics.transfers_yesterday > 0
      ? ((metrics.transfers_today - metrics.transfers_yesterday) / metrics.transfers_yesterday * 100)
      : (metrics.transfers_today > 0 ? 100 : 0)

    res.json({
      success: true,
      data: {
        today: {
          conversations: parseInt(metrics.conversations_today),
          transfers: parseInt(metrics.transfers_today)
        },
        yesterday: {
          conversations: parseInt(metrics.conversations_yesterday),
          transfers: parseInt(metrics.transfers_yesterday)
        },
        thisMonth: {
          conversations: parseInt(metrics.conversations_this_month),
          transfers: parseInt(metrics.transfers_this_month)
        },
        growth: {
          conversations: Math.round(conversationGrowth * 100) / 100,
          transfers: Math.round(transferGrowth * 100) / 100
        },
        activeSessions: parseInt(metrics.active_sessions)
      }
    })

  } catch (error) {
    console.error('Realtime metrics error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch realtime metrics' }
    })
  }
})

export default router
