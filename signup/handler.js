'use strict';

const mysql = require('mysql2/promise');

// DB connection pool (better performance)
const pool = mysql.createPool({
    host: '192.168.43.88',   // your machine IP
    user: 'faasuser',      // MySQL user
    password: '1234',      // your password
    database: 'codementor_db',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = async (event, context) => {
    try {
        const body =
            typeof event.body === 'string'
                ? JSON.parse(event.body)
                : event.body || {};

        const { email, first_name, last_name, password } = body;
        const T4 = Date.now();

        // validation
        if (!email || !first_name || !last_name || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "email, first_name, last_name, password required",
                    T4
                })
            };
        }

        // Compute next id from existing records.
        const [rows] = await pool.execute(
            'SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM `user`'
        );
        const nextId = rows[0].nextId;

        // insert query with explicit id and status = 0
        const query = `
            INSERT INTO \`user\` (id, email, first_name, last_name, password, status)
            VALUES (?, ?, ?, ?, ?, 0)
        `;

        await pool.execute(query, [
            nextId,
            email,
            first_name,
            last_name,
            password
        ]);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "User registered successfully",
                user: { id: nextId, email, first_name, last_name, status: 0 },
                T4
            })
        };

    } catch (err) {
        console.error(err);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Database error",
                details: err.message,
                T4: Date.now()
            })
        };
    }
};
