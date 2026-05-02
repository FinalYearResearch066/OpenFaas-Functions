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
        // Safe parse
        const body =
            typeof event.body === 'string'
                ? JSON.parse(event.body)
                : event.body || {};

        const { email, password, confirmPassword } = body;

        // validation
        if (!email || !password || !confirmPassword) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "email, password, confirmPassword required",
                    T4
                })
            };
        }

        // check password match
        if (password !== confirmPassword) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Passwords do not match",
                    T4
                })
            };
        }

        // check user exists
        const [rows] = await pool.execute(
            'SELECT email FROM user WHERE email = ? LIMIT 1',
            [email]
        );

        if (rows.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error: "User not found",
                    T4
                })
            };
        }

        // update password
        await pool.execute(
            'UPDATE user SET password = ? WHERE email = ?',
            [password, email]
        );

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Password reset successful",
                email,
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
