'use strict';

const mysql = require('mysql2/promise');

// DB connection pool
const pool = mysql.createPool({
    host: '192.168.43.88',
    user: 'faasuser',
    password: '1234',
    database: 'codementor_db',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = async (event, context) => {
    const T4 = Date.now();
    try {
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
        const { email, password } = body;

        if (!email || !password) {
            return { statusCode: 400, body: JSON.stringify({ error: "email/password required", T4 }) };
        }

        // --- වැදගත්: SELECT එකට 'id' ඇතුළත් කර ඇත ---
        const query = 'SELECT id, email, first_name, password FROM user WHERE email = ? LIMIT 1';
        const [rows] = await pool.execute(query, [email]);

        if (rows.length === 0) {
            return { statusCode: 401, body: JSON.stringify({ error: "Invalid credentials", T4 }) };
        }

        if (rows[0].password !== password) {
            // For internal telemetry, return the existing user's id on wrong-password attempts.
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Invalid credentials",
                    auth: false,
                    user: {
                        id: rows[0].id,
                        email: rows[0].email,
                        first_name: rows[0].first_name
                    },
                    T4
                })
            };
        }

        // Status update to logged in
        await pool.execute('UPDATE user SET status = 1 WHERE email = ?', [email]);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Login successful",
                user: {
                    id: rows[0].id, // Database එකේ තියෙන සැබෑ ID එක (1, 2, 3...)
                    email: rows[0].email,
                    first_name: rows[0].first_name
                },
                T4
            })
        };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message, T4: Date.now() }) };
    }
};