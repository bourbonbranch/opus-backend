const { pool } = require('./db');

const FeeService = {
    // Fee Definitions
    async getFeeDefinitions(ensembleId) {
        const result = await pool.query(
            `SELECT * FROM fee_definitions 
             WHERE ensemble_id = $1 AND active = true 
             ORDER BY created_at DESC`,
            [ensembleId]
        );
        return result.rows;
    },

    async createFeeDefinition(ensembleId, data) {
        const { name, description, amountCents, defaultDueDate } = data;
        const result = await pool.query(
            `INSERT INTO fee_definitions 
             (ensemble_id, name, description, amount_cents, default_due_date)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [ensembleId, name, description, amountCents, defaultDueDate]
        );
        return result.rows[0];
    },

    // Fee Assignments
    async assignFee(data) {
        const { ensembleId, feeDefinitionId, studentId, amountCents, dueDate, notes } = data;
        const result = await pool.query(
            `INSERT INTO fee_assignments 
             (ensemble_id, fee_definition_id, student_id, amount_cents, due_date, notes, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'invoiced')
             RETURNING *`,
            [ensembleId, feeDefinitionId, studentId, amountCents, dueDate, notes]
        );
        return result.rows[0];
    },

    async bulkAssignFee(data) {
        const { ensembleId, feeDefinitionId, studentIds, amountCents, dueDate } = data;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const assignments = [];

            for (const studentId of studentIds) {
                const result = await client.query(
                    `INSERT INTO fee_assignments 
                     (ensemble_id, fee_definition_id, student_id, amount_cents, due_date, status)
                     VALUES ($1, $2, $3, $4, $5, 'invoiced')
                     RETURNING *`,
                    [ensembleId, feeDefinitionId, studentId, amountCents, dueDate]
                );
                assignments.push(result.rows[0]);
            }

            await client.query('COMMIT');
            return assignments;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    async getMemberFees(studentId) {
        // Get assignments with definition details and payments
        const assignmentsResult = await pool.query(
            `SELECT fa.*, fd.name as fee_name, fd.description as fee_description,
                    (SELECT COALESCE(SUM(amount_cents), 0) FROM fee_payments WHERE fee_assignment_id = fa.id) as paid_cents
             FROM fee_assignments fa
             JOIN fee_definitions fd ON fa.fee_definition_id = fd.id
             WHERE fa.student_id = $1
             ORDER BY fa.due_date ASC`,
            [studentId]
        );

        const assignments = assignmentsResult.rows.map(a => ({
            ...a,
            balance_cents: a.amount_cents - a.discount_cents - parseInt(a.paid_cents)
        }));

        const totalBalance = assignments.reduce((sum, a) => sum + a.balance_cents, 0);

        return {
            assignments,
            summary: {
                total_assigned_cents: assignments.reduce((sum, a) => sum + a.amount_cents, 0),
                total_paid_cents: assignments.reduce((sum, a) => sum + parseInt(a.paid_cents), 0),
                total_balance_cents: totalBalance
            }
        };
    },

    async getEnsembleFeeSummary(ensembleId) {
        // Get balance for each student in the ensemble
        const result = await pool.query(
            `SELECT s.id as student_id, s.first_name, s.last_name,
                    COALESCE(SUM(fa.amount_cents - fa.discount_cents), 0) as total_owed_cents,
                    COALESCE(SUM(fp.amount_cents), 0) as total_paid_cents
             FROM roster s
             LEFT JOIN fee_assignments fa ON s.id = fa.student_id AND fa.ensemble_id = $1
             LEFT JOIN fee_payments fp ON fa.id = fp.fee_assignment_id
             WHERE s.ensemble_id = $1
             GROUP BY s.id`,
            [ensembleId]
        );

        return result.rows.map(row => ({
            student_id: row.student_id,
            first_name: row.first_name,
            last_name: row.last_name,
            balance_cents: parseInt(row.total_owed_cents) - parseInt(row.total_paid_cents)
        }));
    },

    // Payments
    async recordPayment(data) {
        const { feeAssignmentId, amountCents, paymentProvider, notes } = data;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Create payment record
            const paymentResult = await client.query(
                `INSERT INTO fee_payments 
                 (fee_assignment_id, amount_cents, payment_provider, status, paid_at)
                 VALUES ($1, $2, $3, 'succeeded', NOW())
                 RETURNING *`,
                [feeAssignmentId, amountCents, paymentProvider || 'offline']
            );
            const payment = paymentResult.rows[0];

            // 2. Update assignment status
            const assignmentResult = await client.query(
                `SELECT * FROM fee_assignments WHERE id = $1`,
                [feeAssignmentId]
            );
            const assignment = assignmentResult.rows[0];

            const paidResult = await client.query(
                `SELECT COALESCE(SUM(amount_cents), 0) as total FROM fee_payments WHERE fee_assignment_id = $1`,
                [feeAssignmentId]
            );
            const totalPaid = parseInt(paidResult.rows[0].total);
            const netAmount = assignment.amount_cents - assignment.discount_cents;

            let newStatus = assignment.status;
            if (totalPaid >= netAmount) {
                newStatus = 'paid';
            } else if (totalPaid > 0) {
                newStatus = 'partial';
            }

            if (newStatus !== assignment.status) {
                await client.query(
                    `UPDATE fee_assignments SET status = $1 WHERE id = $2`,
                    [newStatus, feeAssignmentId]
                );
            }

            await client.query('COMMIT');
            return payment;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
};

module.exports = FeeService;
