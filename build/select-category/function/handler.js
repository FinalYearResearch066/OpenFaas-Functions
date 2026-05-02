'use strict';

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "192.168.43.88",
  user: "faasuser",
  password: "1234",
  database: "codementor_db",
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = async (event) => {
  try {
    const body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body || {};

    const { categoryId } = body;
    const T4 = Date.now();

    // STEP 1 — show categories
    if (!categoryId) {
      const [rows] = await pool.execute(
        "SELECT cat_id, cat_name FROM category ORDER BY cat_id"
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          step: "select-category",
          categories: rows,
          message: "Send categoryId to continue",
          T4
        })
      };
    }

    // STEP 2 — validate category
    const [cat] = await pool.execute(
      "SELECT cat_id, cat_name FROM category WHERE cat_id = ?",
      [categoryId]
    );

    if (cat.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Invalid categoryId", T4 })
      };
    }

    // STEP 3 — show options
    return {
      statusCode: 200,
      body: JSON.stringify({
        step: "choose-action",
        categoryId,
        categoryName: cat[0].name,
        options: [
          { id: 1, name: "Select Subcategory" },
          { id: 2, name: "Questions" }
        ],
        message:
          "Send {categoryId, optionId} → 1=subcategory, 2=questions",
        T4
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};