const pool = require('../db');

exports.getTransactionsPage = async (req, res) => {
    try {
        const query = `
            SELECT 
                t.id AS transaction_id,
                t.amount AS amount_paid,
                t.rating,
                t.comment,
                t.created_at,
                t.updated_at,
                c.username AS customer_name,
                r.username AS rider_name,
                p.name AS pet_name
            FROM transactions t
            LEFT JOIN customer_user c ON t.customer_id = c.id
            LEFT JOIN riders r ON t.rider_id = r.id
            LEFT JOIN pets p ON t.pet_id = p.id;
        `;

        const result = await pool.query(query);
        const rows = result.rows || []; // Correct way to access rows


        res.render('transactions', { transactions: rows });
    } catch (error) {
        console.error('Error fetching transactions data:', error);
        res.status(500).send('Server error');
    }
};
