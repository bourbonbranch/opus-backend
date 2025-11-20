const { Pool } = require('pg');

// Using the Public Proxy URL
const connectionString = 'postgresql://postgres:fWqcmFWhdMovPTRUbQyqxcpxiIkvPDuY@crossover.proxy.rlwy.net:30557/railway';

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
});

async function renameTicketsTables() {
  try {
    console.log('Connecting to database...');

    // Drop old tables if they exist (in reverse dependency order)
    console.log('Dropping old ticket tables if they exist...');
    await pool.query('DROP TABLE IF EXISTS order_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS orders CASCADE');
    await pool.query('DROP TABLE IF EXISTS student_sale_links CASCADE');
    await pool.query('DROP TABLE IF EXISTS ticket_types CASCADE');
    await pool.query('DROP TABLE IF EXISTS performances CASCADE');
    await pool.query('DROP TABLE IF EXISTS promo_codes CASCADE');
    await pool.query('DROP TABLE IF EXISTS ticket_events CASCADE');

    // Create new tables with correct names

    // Ticket events table (renamed from events)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_events (
        id SERIAL PRIMARY KEY,
        director_id INTEGER REFERENCES users(id),
        ensemble_id INTEGER REFERENCES ensembles(id),
        calendar_event_id INTEGER,
        title VARCHAR(255) NOT NULL,
        subtitle VARCHAR(255),
        description TEXT,
        program_notes TEXT,
        venue_name VARCHAR(255),
        venue_address TEXT,
        parking_instructions TEXT,
        dress_code TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Ticket events table created');

    // Performances table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS performances (
        id SERIAL PRIMARY KEY,
        ticket_event_id INTEGER REFERENCES ticket_events(id) ON DELETE CASCADE,
        performance_date DATE NOT NULL,
        doors_open_time TIME,
        start_time TIME NOT NULL,
        end_time TIME,
        capacity INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Performances table created');

    // Ticket types table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_types (
        id SERIAL PRIMARY KEY,
        ticket_event_id INTEGER REFERENCES ticket_events(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        seating_type VARCHAR(50) DEFAULT 'general_admission',
        quantity_available INTEGER,
        is_public BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Ticket types table created');

    // Student sale links table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_sale_links (
        id SERIAL PRIMARY KEY,
        ticket_event_id INTEGER REFERENCES ticket_events(id) ON DELETE CASCADE,
        roster_id INTEGER REFERENCES roster(id),
        unique_code VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Student sale links table created');

    // Orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        ticket_event_id INTEGER REFERENCES ticket_events(id),
        performance_id INTEGER REFERENCES performances(id),
        student_sale_link_id INTEGER REFERENCES student_sale_links(id),
        buyer_email VARCHAR(255) NOT NULL,
        buyer_name VARCHAR(255) NOT NULL,
        buyer_phone VARCHAR(50),
        subtotal DECIMAL(10, 2) NOT NULL,
        fees DECIMAL(10, 2) DEFAULT 0,
        donation DECIMAL(10, 2) DEFAULT 0,
        total DECIMAL(10, 2) NOT NULL,
        stripe_payment_intent_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Orders table created');

    // Order items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        ticket_type_id INTEGER REFERENCES ticket_types(id),
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        qr_code TEXT,
        checked_in_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Order items table created');

    // Promo codes table (for future use)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id SERIAL PRIMARY KEY,
        ticket_event_id INTEGER REFERENCES ticket_events(id) ON DELETE CASCADE,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_type VARCHAR(20),
        discount_value DECIMAL(10, 2),
        max_uses INTEGER,
        uses_count INTEGER DEFAULT 0,
        valid_from TIMESTAMP,
        valid_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Promo codes table created');

    console.log('\n🎉 All tickets tables recreated successfully with correct names!');
  } catch (err) {
    console.error('❌ Error recreating tickets tables:', err);
  } finally {
    await pool.end();
  }
}

renameTicketsTables();
