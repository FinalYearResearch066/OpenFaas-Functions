'use strict';

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '192.168.43.88',
  user: 'faasuser',
  password: '1234',
  database: 'codementor_db',
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = async (event) => {
  try {
    // safe parse
    const body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body || {};

    const { categoryId, subCategoryId } = body;
    const T4 = Date.now();

    // at least one filter required
    if (!categoryId && !subCategoryId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "categoryId or subCategoryId required",
          T4
        })
      };
    }

    let query = "";
    let params = [];

    // CASE 1 — both provided (most specific)
    if (categoryId && subCategoryId) {
      query = `
        SELECT question_id, question
        FROM questions
        WHERE cat_id = ? AND sub_cat_id = ?
      `;
      params = [categoryId, subCategoryId];
    }

    // CASE 2 — only subcategory provided
    else if (subCategoryId) {
      query = `
        SELECT question_id, question
        FROM questions
        WHERE sub_cat_id = ?
      `;
      params = [subCategoryId];
    }

    // CASE 3 — only category provided
    else if (categoryId) {
      query = `
        SELECT question_id, question
        FROM questions
        WHERE cat_id = ? 
      `;
      params = [categoryId];
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: "No questions found",
          categoryId,
          subCategoryId,
          T4
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        questions: rows,
        filterUsed: {
          categoryId: categoryId || null,
          subCategoryId: subCategoryId || null
        },
        count: rows.length,
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