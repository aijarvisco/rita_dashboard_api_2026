import express from 'express'
import { query } from '../config/database.js'
import { authenticateToken, requireCompanyAccess } from '../middleware/auth.js'

const router = express.Router()

// Apply authentication to all routes
router.use(authenticateToken)

// GET /api/stock - Get stock/inventory for a company
router.get('/', requireCompanyAccess, async (req, res) => {
  try {
    const { 
      company_id,
      page = 1,
      limit = 20,
      brand = '',
      model = '',
      category = '',
      min_price = '',
      max_price = '',
      fuel_type = '',
      transmission = '',
      location = ''
    } = req.query
    
    const companyId = company_id || req.companyId
    const offset = (parseInt(page) - 1) * parseInt(limit)

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Company ID is required' }
      })
    }

    // Get company name to match with EMPRESA field
    const companyResult = await query(`SELECT name FROM companies WHERE id = $1`, [companyId])
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Company not found' }
      })
    }

    const companyName = companyResult.rows[0].name

    // Build filters
    let filters = []
    let queryParams = [companyName, parseInt(limit), offset]
    let paramIndex = 4

    if (brand) {
      filters.push(`"MARCA" ILIKE $${paramIndex}`)
      queryParams.push(`%${brand}%`)
      paramIndex++
    }

    if (model) {
      filters.push(`"MODELO" ILIKE $${paramIndex}`)
      queryParams.push(`%${model}%`)
      paramIndex++
    }

    if (category) {
      filters.push(`"CATEGORIA" ILIKE $${paramIndex}`)
      queryParams.push(`%${category}%`)
      paramIndex++
    }

    if (min_price) {
      filters.push(`"PREÇO" >= $${paramIndex}`)
      queryParams.push(parseFloat(min_price))
      paramIndex++
    }

    if (max_price) {
      filters.push(`"PREÇO" <= $${paramIndex}`)
      queryParams.push(parseFloat(max_price))
      paramIndex++
    }

    if (fuel_type) {
      filters.push(`"COMBUSTÍVEL" ILIKE $${paramIndex}`)
      queryParams.push(`%${fuel_type}%`)
      paramIndex++
    }

    if (transmission) {
      filters.push(`"TRANSMISSÃO" ILIKE $${paramIndex}`)
      queryParams.push(`%${transmission}%`)
      paramIndex++
    }

    if (location) {
      filters.push(`"LOCAL" ILIKE $${paramIndex}`)
      queryParams.push(`%${location}%`)
      paramIndex++
    }

    const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

    // Get stock data
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
        "EMPRESA" as company,
        "LOCAL" as location,
        "COR EXTERIOR" as exterior_color,
        "TRANSMISSÃO" as transmission,
        "COMBUSTÍVEL" as fuel_type,
        "ANO MATRÍCULA" as registration_year,
        "MÊS MATRÍCULA" as registration_month,
        "COR INTERIOR" as interior_color,
        "URL_WEB" as web_url,
        "MAIN_PHOTO" as main_photo,
        "OTHER_PHOTOS" as other_photos,
        created_at
      FROM stock
      WHERE "EMPRESA" = $1
        ${whereClause}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, queryParams)

    // Get total count for pagination
    const countParams = queryParams.slice(0, paramIndex - 2) // Remove limit and offset
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM stock
      WHERE "EMPRESA" = $1
        ${whereClause}
    `, countParams)

    const total = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / parseInt(limit))

    res.json({
      success: true,
      data: {
        vehicles: result.rows,
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
    console.error('Stock error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch stock data' }
    })
  }
})

// GET /api/stock/summary - Get stock summary/statistics
router.get('/summary', requireCompanyAccess, async (req, res) => {
  try {
    const { company_id } = req.query
    const companyId = company_id || req.companyId

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
        COUNT(*) as total_vehicles,
        COUNT(DISTINCT "MARCA") as total_brands,
        COUNT(DISTINCT "MODELO") as total_models,
        COUNT(DISTINCT "CATEGORIA") as total_categories,
        COUNT(DISTINCT "LOCAL") as total_locations,
        AVG("PREÇO") as avg_price,
        MIN("PREÇO") as min_price,
        MAX("PREÇO") as max_price,
        AVG("QUILOMETROS") as avg_kilometers,
        MIN("QUILOMETROS") as min_kilometers,
        MAX("QUILOMETROS") as max_kilometers
      FROM stock
      WHERE "EMPRESA" = $1
        AND "PREÇO" IS NOT NULL
        AND "QUILOMETROS" IS NOT NULL
    `, [companyName])

    // Get brand distribution
    const brandsResult = await query(`
      SELECT 
        "MARCA" as brand,
        COUNT(*) as count,
        AVG("PREÇO") as avg_price
      FROM stock
      WHERE "EMPRESA" = $1
        AND "MARCA" IS NOT NULL
      GROUP BY "MARCA"
      ORDER BY count DESC
      LIMIT 10
    `, [companyName])

    // Get category distribution
    const categoriesResult = await query(`
      SELECT 
        "CATEGORIA" as category,
        COUNT(*) as count,
        AVG("PREÇO") as avg_price
      FROM stock
      WHERE "EMPRESA" = $1
        AND "CATEGORIA" IS NOT NULL
      GROUP BY "CATEGORIA"
      ORDER BY count DESC
    `, [companyName])

    const summary = result.rows[0]

    res.json({
      success: true,
      data: {
        overview: {
          total_vehicles: parseInt(summary.total_vehicles),
          total_brands: parseInt(summary.total_brands),
          total_models: parseInt(summary.total_models),
          total_categories: parseInt(summary.total_categories),
          total_locations: parseInt(summary.total_locations)
        },
        pricing: {
          avg_price: parseFloat(summary.avg_price) || 0,
          min_price: parseFloat(summary.min_price) || 0,
          max_price: parseFloat(summary.max_price) || 0
        },
        mileage: {
          avg_kilometers: parseFloat(summary.avg_kilometers) || 0,
          min_kilometers: parseFloat(summary.min_kilometers) || 0,
          max_kilometers: parseFloat(summary.max_kilometers) || 0
        },
        brands: brandsResult.rows.map(row => ({
          brand: row.brand,
          count: parseInt(row.count),
          avg_price: parseFloat(row.avg_price) || 0
        })),
        categories: categoriesResult.rows.map(row => ({
          category: row.category,
          count: parseInt(row.count),
          avg_price: parseFloat(row.avg_price) || 0
        }))
      }
    })

  } catch (error) {
    console.error('Stock summary error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch stock summary' }
    })
  }
})

// GET /api/stock/:id - Get specific vehicle details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vehicle ID is required' }
      })
    }

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
        "EMPRESA" as company,
        "LOCAL" as location,
        "COR EXTERIOR" as exterior_color,
        "TRANSMISSÃO" as transmission,
        "COMBUSTÍVEL" as fuel_type,
        "ANO MATRÍCULA" as registration_year,
        "MÊS MATRÍCULA" as registration_month,
        "COR INTERIOR" as interior_color,
        "URL_WEB" as web_url,
        "MAIN_PHOTO" as main_photo,
        "OTHER_PHOTOS" as other_photos,
        created_at
      FROM stock
      WHERE id = $1
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Vehicle not found' }
      })
    }

    const vehicle = result.rows[0]

    // Parse other_photos if it's a string
    if (vehicle.other_photos && typeof vehicle.other_photos === 'string') {
      try {
        vehicle.other_photos = vehicle.other_photos.split(',').map(url => url.trim()).filter(url => url)
      } catch (e) {
        vehicle.other_photos = []
      }
    }

    res.json({
      success: true,
      data: vehicle
    })

  } catch (error) {
    console.error('Vehicle details error:', error)
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch vehicle details' }
    })
  }
})

export default router