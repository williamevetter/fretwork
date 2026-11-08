const crypto = require("crypto");

function uid() {
  return crypto.randomBytes(9).toString("hex");
}

function nowISO() {
  return new Date().toISOString();
}

module.exports = { uid, nowISO };
