import { query } from '../config/database.js'

async function quickSeed() {
  try {
    console.log('Quick seed for chart testing...')

    // Get company ID
    const companiesResult = await query('SELECT id FROM companies ORDER BY id LIMIT 1')
    if (companiesResult.rows.length === 0) {
      console.log('No companies found. Please create a company first.')
      return
    }
    
    const companyId = companiesResult.rows[0].id
    console.log('Using company ID:', companyId)

    // Create simple test data for the last 6 months
    const months = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date()
      date.setMonth(date.getMonth() - i)
      date.setDate(1)
      months.push({
        month: date.toISOString().split('T')[0],
        totalConversations: Math.floor(Math.random() * 500) + 800,
        transferredLeads: Math.floor(Math.random() * 200) + 100,
        totalLeads: Math.floor(Math.random() * 400) + 600
      })
    }

    // Calculate qualification percentage for each month
    months.forEach(month => {
      month.qualificationPercentage = Math.round((month.transferredLeads / month.totalLeads) * 100 * 100) / 100
    })

    // Create table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS test_metrics (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        month DATE NOT NULL,
        "totalConversations" INTEGER NOT NULL DEFAULT 0,
        "transferredLeads" INTEGER NOT NULL DEFAULT 0,
        "totalLeads" INTEGER NOT NULL DEFAULT 0,
        "qualificationPercentage" DECIMAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    // Clear existing test data
    await query('DELETE FROM test_metrics WHERE company_id = $1', [companyId])

    console.log('Inserting test data...')
    
    for (const monthData of months) {
      await query(`
        INSERT INTO test_metrics (company_id, month, "totalConversations", "transferredLeads", "totalLeads", "qualificationPercentage")
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [companyId, monthData.month, monthData.totalConversations, monthData.transferredLeads, monthData.totalLeads, monthData.qualificationPercentage])
    }

    console.log('Quick seed completed!')
    console.log('Data generated:', months)

  } catch (error) {
    console.error('Quick seed error:', error)
  }
}

quickSeed().catch(console.error)