// Vercel entrypoint. Everything real lives in ../server.js — this file just
// hands the Express app to Vercel's Node.js runtime, which wraps it as a
// serverless function.
module.exports = require("../server");
