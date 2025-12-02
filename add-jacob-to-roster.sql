-- Add student email to ensemble roster
-- This script adds j@jclaudeportraits.com to the first ensemble's roster

-- First, check if the user exists
SELECT id, email, first_name, last_name FROM users WHERE email = 'j@jclaudeportraits.com';

-- If user doesn't exist in roster, add them
-- Get the first ensemble ID
WITH first_ensemble AS (
  SELECT id FROM ensembles ORDER BY id LIMIT 1
)
INSERT INTO roster (ensemble_id, email, first_name, last_name, section, part)
SELECT 
  (SELECT id FROM first_ensemble),
  'j@jclaudeportraits.com',
  'Jacob',
  'Cochran',
  'Tenor',
  'Tenor 1'
WHERE NOT EXISTS (
  SELECT 1 FROM roster 
  WHERE email = 'j@jclaudeportraits.com' 
  AND ensemble_id = (SELECT id FROM first_ensemble)
);

-- Verify the addition
SELECT r.id, r.email, r.first_name, r.last_name, r.section, r.part, e.name as ensemble_name
FROM roster r
JOIN ensembles e ON r.ensemble_id = e.id
WHERE r.email = 'j@jclaudeportraits.com';
