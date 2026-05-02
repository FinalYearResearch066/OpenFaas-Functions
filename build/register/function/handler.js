'use strict';

const bcrypt = require("bcryptjs");
const { getConnection } = require("./db");

module.exports = async function handler(event, context) {
    try {
        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
        const { name, email, password } = body;

        if (!name || !email || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "All fields required" })
            };
        }

        const connection = await getConnection();

        const [existing] = await connection.execute(
            "SELECT id FROM signup WHERE email = ?",
            [email]
        );

        if (existing.length > 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "User already exists" })
            };
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await connection.execute(
            "INSERT INTO signup (name, email, password) VALUES (?, ?, ?)",
            [name, email, hashedPassword]
        );

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "Register successful" })
        };

    } catch (err) {
        console.error("REGISTER ERROR:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal server error" })
        };
    }
};
