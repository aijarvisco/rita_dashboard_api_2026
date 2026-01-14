import { query } from '../config/database.js'

async function seedData() {
  try {
    console.log('Starting data seeding...')

    // First, let's check if there are companies
    const companiesResult = await query('SELECT id, name FROM companies ORDER BY id LIMIT 1')
    let companyId

    if (companiesResult.rows.length === 0) {
      // Create a test company
      const newCompany = await query(`
        INSERT INTO companies (name, context, phone_number, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING id
      `, ['Caetano Test Motors', 'Test automotive company', '+351912345678'])
      companyId = newCompany.rows[0].id
      console.log('Created test company with ID:', companyId)
    } else {
      companyId = companiesResult.rows[0].id
      console.log('Using existing company:', companiesResult.rows[0].name, 'ID:', companyId)
    }

    // Generate historical data for the last 6 months
    const months = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date()
      date.setMonth(date.getMonth() - i)
      date.setDate(1) // First day of month
      months.push(date)
    }

    console.log('Generating data for months:', months.map(m => m.toISOString().substring(0, 7)))

    // Clear existing data for this company
    await query('DELETE FROM conversations WHERE company_id = $1', [companyId])
    await query('DELETE FROM transferred_leads WHERE company_id = $1', [companyId])
    await query('DELETE FROM leads WHERE company_id = $1', [companyId])
    
    // Clear contacts that don't have related data in other companies
    const contactsToDelete = await query(`
      SELECT DISTINCT c.id FROM contacts c 
      LEFT JOIN leads l ON l.contact_id = c.id AND l.company_id != $1
      LEFT JOIN conversations conv ON conv.contact_id = c.id AND conv.company_id != $1
      WHERE l.id IS NULL AND conv.id IS NULL
    `, [companyId])
    
    for (const contact of contactsToDelete.rows) {
      await query('DELETE FROM contacts WHERE id = $1', [contact.id])
    }
    
    console.log('Cleared existing data')

    // Generate data for each month
    for (const month of months) {
      const baseConversations = Math.floor(Math.random() * 500) + 800 // 800-1300 conversations
      const baseLeads = Math.floor(baseConversations * 0.7) // About 70% of conversations become leads
      const transferredLeads = Math.floor(baseLeads * (0.15 + Math.random() * 0.25)) // 15-40% qualification rate

      console.log(`Month ${month.toISOString().substring(0, 7)}:`, {
        conversations: baseConversations,
        leads: baseLeads,
        transferred: transferredLeads
      })

      // Create contacts first
      const contactIds = []
      for (let i = 0; i < Math.max(baseConversations, baseLeads); i++) {
        const contactId = `00000000-0000-4000-8000-${String(i + month.getTime()).padStart(12, '0').slice(-12)}`
        contactIds.push(contactId)
        
        await query(`
          INSERT INTO contacts (id, name, phone_number, email, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
        `, [
          contactId, 
          `Contact ${i + 1}`, 
          Math.floor(Math.random() * 900000000) + 100000000, 
          `contact${i}@test.com`, 
          month
        ])
      }

      // Insert conversations
      for (let i = 0; i < baseConversations; i++) {
        const conversationDate = new Date(month)
        conversationDate.setDate(Math.floor(Math.random() * 28) + 1)
        conversationDate.setHours(Math.floor(Math.random() * 24))
        conversationDate.setMinutes(Math.floor(Math.random() * 60))

        const contactId = contactIds[i]
        const sessionId = `11111111-1111-4111-9111-${String(i + month.getTime()).padStart(12, '0').slice(-12)}`

        await query(`
          INSERT INTO conversations (company_id, contact_id, session_id, sender, content, wa_id, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [companyId, contactId, sessionId, 0, 'Test conversation message', `351${Math.floor(Math.random() * 900000000) + 100000000}`, conversationDate])
      }

      // Insert leads  
      for (let i = 0; i < baseLeads; i++) {
        const leadDate = new Date(month)
        leadDate.setDate(Math.floor(Math.random() * 28) + 1)
        leadDate.setHours(Math.floor(Math.random() * 24))
        leadDate.setMinutes(Math.floor(Math.random() * 60))

        const contactId = contactIds[i]

        await query(`
          INSERT INTO leads (contact_id, channel, company_id, created_at)
          VALUES ($1, $2, $3, $4)
        `, [contactId, 'whatsapp', companyId, leadDate])
      }

      // Insert transferred leads
      for (let i = 0; i < transferredLeads; i++) {
        const transferDate = new Date(month)
        transferDate.setDate(Math.floor(Math.random() * 28) + 1)
        transferDate.setHours(Math.floor(Math.random() * 24))
        transferDate.setMinutes(Math.floor(Math.random() * 60))

        const contactId = contactIds[i]
        const sessionId = `11111111-1111-4111-9111-${String(i + month.getTime()).padStart(12, '0').slice(-12)}`
        
        // First get a lead_id 
        const leadResult = await query(`
          SELECT id FROM leads WHERE contact_id = $1 AND company_id = $2 LIMIT 1
        `, [contactId, companyId])
        
        if (leadResult.rows.length > 0) {
          await query(`
            INSERT INTO transferred_leads (lead_id, summary, contact_id, session_id, company_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [leadResult.rows[0].id, 'Qualified lead transferred to sales team', contactId, sessionId, companyId, transferDate])
        }
      }
    }

    console.log('Data seeding completed successfully!')
    console.log('Company ID for testing:', companyId)

  } catch (error) {
    console.error('Error seeding data:', error)
    throw error
  }
}

// Run the seeder
seedData().catch(console.error)