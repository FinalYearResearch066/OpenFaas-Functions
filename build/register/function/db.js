'use strict';

const mysql = require("mysql2/promise");

let connection;

async function getConnection() {
    if (!connection) {
        console.log("Connecting to DB:", process.env.DB_HOST);
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });
    }
    return connection;
}

module.exports = { getConnection };
