const { pool } = require('./db');

/**
 * Donor CRM Service
 * Core business logic for donor management, matching, and activity tracking
 */

/**
 * Find or create a donor based on email and ensemble_id
 * @param {string} email - Donor email
 * @param {number} ensembleId - Ensemble ID
 * @param {object} contactInfo - Additional contact information
 * @returns {Promise<object>} Donor record
 */
async function findOrCreateDonor(email, ensembleId, contactInfo = {}) {
    if (!email || !ensembleId) {
        throw new Error('Email and ensembleId are required');
    }

    // Try to find existing donor
    const existingDonor = await pool.query(
        'SELECT * FROM donors WHERE LOWER(email) = LOWER($1) AND ensemble_id = $2',
        [email, ensembleId]
    );

    if (existingDonor.rows.length > 0) {
        return existingDonor.rows[0];
    }

    // Create new donor
    const {
        firstName,
        lastName,
        organizationName,
        phone,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        country = 'US'
    } = contactInfo;

    const result = await pool.query(
        `INSERT INTO donors (
            ensemble_id, first_name, last_name, organization_name, email, phone,
            address_line1, address_line2, city, state, postal_code, country
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
            ensembleId, firstName, lastName, organizationName, email, phone,
            addressLine1, addressLine2, city, state, postalCode, country
        ]
    );

    return result.rows[0];
}

/**
 * Record a donation and update donor aggregates
 * @param {number} donorId - Donor ID
 * @param {number} amountCents - Donation amount in cents
 * @param {number} campaignId - Campaign ID
 * @param {object} metadata - Additional donation metadata
 * @returns {Promise<object>} Updated donation record
 */
async function recordDonation(donorId, amountCents, campaignId, metadata = {}) {
    const {
        stripePaymentIntentId,
        studentId,
        participantId,
        donorName,
        donorEmail,
        isAnonymous = false,
        message
    } = metadata;

    // Update the donation record with donor_id
    // Note: The donation should already exist from the Stripe webhook
    // We're just linking it to the donor
    if (stripePaymentIntentId) {
        const result = await pool.query(
            `UPDATE donations 
             SET donor_id = $1
             WHERE stripe_payment_intent_id = $2
             RETURNING *`,
            [donorId, stripePaymentIntentId]
        );

        if (result.rows.length > 0) {
            // Aggregates are automatically updated by trigger
            return result.rows[0];
        }
    }

    // If no existing donation found, this shouldn't happen in normal flow
    // but we'll handle it gracefully
    return null;
}

/**
 * Update donor aggregates manually (usually handled by triggers)
 * @param {number} donorId - Donor ID
 */
async function updateDonorAggregates(donorId) {
    await pool.query('SELECT update_donor_aggregates($1)', [donorId]);
}

/**
 * Log an activity for a donor
 * @param {number} donorId - Donor ID
 * @param {number} ensembleId - Ensemble ID
 * @param {string} type - Activity type (donation, ticket_purchase, note, email_sent, manual_log)
 * @param {string} summary - Short description
 * @param {object} details - Additional structured data
 * @param {number} relatedId - Related record ID (donation_id, order_id, etc.)
 * @returns {Promise<object>} Activity record
 */
async function logActivity(donorId, ensembleId, type, summary, details = {}, relatedId = null) {
    const result = await pool.query(
        `INSERT INTO donor_activities (donor_id, ensemble_id, type, summary, details, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [donorId, ensembleId, type, summary, JSON.stringify(details), relatedId]
    );

    return result.rows[0];
}

/**
 * Get donor by ID with full details
 * @param {number} donorId - Donor ID
 * @returns {Promise<object>} Donor with donations and activities
 */
async function getDonorById(donorId) {
    const donorResult = await pool.query('SELECT * FROM donors WHERE id = $1', [donorId]);

    if (donorResult.rows.length === 0) {
        return null;
    }

    const donor = donorResult.rows[0];

    // Get donations
    const donationsResult = await pool.query(
        `SELECT d.*, c.name as campaign_name, r.first_name as student_first_name, r.last_name as student_last_name
         FROM donations d
         LEFT JOIN campaigns c ON d.campaign_id = c.id
         LEFT JOIN roster r ON d.student_id = r.id
         WHERE d.donor_id = $1
         ORDER BY d.created_at DESC`,
        [donorId]
    );

    // Get activities
    const activitiesResult = await pool.query(
        `SELECT * FROM donor_activities
         WHERE donor_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [donorId]
    );

    return {
        ...donor,
        donations: donationsResult.rows,
        activities: activitiesResult.rows
    };
}

/**
 * Get all donors for an ensemble with filters
 * @param {number} ensembleId - Ensemble ID
 * @param {object} filters - Filter options
 * @returns {Promise<array>} List of donors
 */
async function getDonors(ensembleId, filters = {}) {
    const {
        search,
        tags,
        minTotal,
        maxTotal,
        lastDonationAfter,
        lastDonationBefore,
        sortBy = 'last_donation_at',
        sortOrder = 'DESC',
        limit = 50,
        offset = 0
    } = filters;

    let query = 'SELECT * FROM donors WHERE ensemble_id = $1';
    const params = [ensembleId];
    let paramIndex = 2;

    // Search filter
    if (search) {
        query += ` AND (
            LOWER(first_name) LIKE LOWER($${paramIndex}) OR 
            LOWER(last_name) LIKE LOWER($${paramIndex}) OR 
            LOWER(organization_name) LIKE LOWER($${paramIndex}) OR
            LOWER(email) LIKE LOWER($${paramIndex})
        )`;
        params.push(`%${search}%`);
        paramIndex++;
    }

    // Tags filter
    if (tags && tags.length > 0) {
        query += ` AND tags && $${paramIndex}`;
        params.push(tags);
        paramIndex++;
    }

    // Amount filters
    if (minTotal !== undefined) {
        query += ` AND lifetime_donation_cents >= $${paramIndex}`;
        params.push(minTotal);
        paramIndex++;
    }

    if (maxTotal !== undefined) {
        query += ` AND lifetime_donation_cents <= $${paramIndex}`;
        params.push(maxTotal);
        paramIndex++;
    }

    // Date filters
    if (lastDonationAfter) {
        query += ` AND last_donation_at >= $${paramIndex}`;
        params.push(lastDonationAfter);
        paramIndex++;
    }

    if (lastDonationBefore) {
        query += ` AND last_donation_at <= $${paramIndex}`;
        params.push(lastDonationBefore);
        paramIndex++;
    }

    // Sorting
    const validSortColumns = ['last_donation_at', 'lifetime_donation_cents', 'first_name', 'created_at'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'last_donation_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${order} NULLS LAST`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
}

/**
 * Update donor information
 * @param {number} donorId - Donor ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated donor record
 */
async function updateDonor(donorId, updates) {
    const allowedFields = [
        'first_name', 'last_name', 'organization_name', 'email', 'phone',
        'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
        'employer', 'preferred_contact_method', 'tags', 'notes'
    ];

    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(updates[key]);
            paramIndex++;
        }
    });

    if (fields.length === 0) {
        throw new Error('No valid fields to update');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(donorId);

    const query = `UPDATE donors SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);

    return result.rows[0];
}

module.exports = {
    findOrCreateDonor,
    recordDonation,
    updateDonorAggregates,
    logActivity,
    getDonorById,
    getDonors,
    updateDonor
};
