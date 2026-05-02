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

    const { categoryId, subCategoryId } = body;
    const T4 = Date.now();

    if (!categoryId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "categoryId required",
          T4
        })
      };
    }

    // STEP 1 — show subcategories for category
    if (!subCategoryId) {
      const [rows] = await pool.execute(
        "SELECT sub_cat_id, sub_name, description FROM sub_category WHERE cat_id = ?",
        [categoryId]
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          step: "select-subcategory",
          categoryId,
          subCategories: rows,
          message: "Send {categoryId, subCategoryId} to get questions",
          T4
        })
      };
    }

    // STEP 2 — validate subcategory
    const [sub] = await pool.execute(
      "SELECT * FROM sub_category WHERE sub_cat_id = ? AND cat_id = ?",
      [subCategoryId, categoryId]
    );

    if (sub.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Invalid subCategoryId", T4 })
      };
    }

    // Ready to pass to questions handler
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Ready for questions",
        categoryId,
        subCategoryId,
        next: "Send these IDs to questions function",
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