'use strict';

const mysql = require('mysql2/promise');

// DB connection pool
const pool = mysql.createPool({
    host: '192.168.43.88',  // your MySQL host
    user: 'faasuser',
    password: '1234',
    database: 'codementor_db',
    connectTimeout: 3000,
    waitForConnections: true,
    connectionLimit: 10
});

const DB_QUERY_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        )
    ]);
}

async function safeExecute(sql, params, label) {
    return withTimeout(pool.execute(sql, params), DB_QUERY_TIMEOUT_MS, label);
}

module.exports = async (event, context) => {
    const T4 = Date.now();

    try {
        // Parse body
        const body =
            typeof event.body === 'string'
                ? JSON.parse(event.body)
                : event.body || {};

        const { email } = body;

        if (!email) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Email is required",
                    T4
                })
            };
        }

        // Query user
        const query = 'SELECT status FROM user WHERE email = ? LIMIT 1';
        const [rows] = await safeExecute(query, [email], 'SELECT user status');

        if (rows.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error: "Email not found",
                    T4
                })
            };
        }

        // Check current status
        if (rows[0].status === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Already logged out. Login first",
                    T4
                })
            };
        }

        // Update status to 0 (logout)
        const updateQuery = 'UPDATE user SET status = 0 WHERE email = ?';
        await safeExecute(updateQuery, [email], 'UPDATE logout status');

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Logout successful",
                email,
                T4
            })
        };

    } catch (err) {
        console.error(err);

        const isTimeout =
            err.message.includes('timed out') ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'PROTOCOL_SEQUENCE_TIMEOUT';

        return {
            statusCode: isTimeout ? 504 : 500,
            body: JSON.stringify({
                error: isTimeout ? "Database timeout" : "Database error",
                details: err.message,
                T4: Date.now()
            })
        };
    }
};
