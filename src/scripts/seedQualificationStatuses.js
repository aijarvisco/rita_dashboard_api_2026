import { query } from '../config/database.js'

async function seedQualificationStatuses() {
  try {
    console.log('Seeding qualification statuses...')

    // Check if statuses already exist
    const existingStatuses = await query('SELECT COUNT(*) FROM qualification_statuses')
    
    if (existingStatuses.rows[0].count > 0) {
      console.log('Qualification statuses already exist, skipping...')
      return
    }

    // Insert default qualification statuses
    const statuses = [
      { id: 0, description: 'Novo' },
      { id: 1, description: 'Em progresso' }, 
      { id: 2, description: 'Qualificando' },
      { id: 3, description: 'Transferido' },
      { id: 4, description: 'Finalizado' }
    ]

    for (const status of statuses) {
      await query(`
        INSERT INTO qualification_statuses (id, description)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET description = $2
      `, [status.id, status.description])
    }

    console.log('Qualification statuses seeded successfully!')
    
  } catch (error) {
    console.error('Error seeding qualification statuses:', error)
    throw error
  }
}

// Run the seeder
seedQualificationStatuses().catch(console.error)