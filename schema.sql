-- Enable UUID extension if we want to use UUIDs, but SERIAL is fine for now.
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'director',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ensembles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  organization_name TEXT,
  level TEXT,
  size TEXT,
  director_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roster (
  id SERIAL PRIMARY KEY,
  ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  section TEXT,
  part TEXT,
  pronouns TEXT,
  status TEXT DEFAULT 'active',
  external_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  director_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  beacon_uuid TEXT,
  beacon_major INTEGER,
  beacon_minor INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'present'
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_items (
  id SERIAL PRIMARY KEY,
  director_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  description TEXT,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seating Configuration Tables
CREATE TABLE IF NOT EXISTS seating_configurations (
  id SERIAL PRIMARY KEY,
  ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  global_rows INTEGER NOT NULL,
  global_module_width NUMERIC NOT NULL,
  global_tread_depth NUMERIC NOT NULL,
  is_curved BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seating_sections (
  id SERIAL PRIMARY KEY,
  configuration_id INTEGER REFERENCES seating_configurations(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL,
  section_name TEXT NOT NULL,
  ada_row INTEGER
);

CREATE TABLE IF NOT EXISTS seating_placements (
  id SERIAL PRIMARY KEY,
  configuration_id INTEGER REFERENCES seating_configurations(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL,
  row INTEGER NOT NULL,
  position_index INTEGER NOT NULL,
  UNIQUE(configuration_id, student_id)
);

-- Assignments Tables
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  due_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'draft',
  piece_id INTEGER,
  measures_text TEXT,
  submission_required BOOLEAN DEFAULT true,
  grading_type TEXT DEFAULT 'completion',
  max_score INTEGER,
  visible_at TIMESTAMP WITH TIME ZONE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_targets (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_value TEXT,
  student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES roster(id) ON DELETE CASCADE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'not_started',
  score NUMERIC,
  feedback TEXT,
  text_response TEXT,
  file_url TEXT,
  audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS assignment_attachments (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ensemble_sections (
  id SERIAL PRIMARY KEY,
  ensemble_id INTEGER REFERENCES ensembles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ensemble_id, name)
);

CREATE TABLE IF NOT EXISTS ensemble_parts (
  id SERIAL PRIMARY KEY,
  section_id INTEGER REFERENCES ensemble_sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(section_id, name)
);
