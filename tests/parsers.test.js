const { test, describe } = require("node:test");
const assert = require("node:assert");

// Mock Google Apps Script built-ins before requiring
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: () => "MOCKED_VALUE"
  })
};

const { Parsers } = require("../Ledger.js");

describe("Email Parsers", () => {
  test("Capital One parser extracts correct amount, merchant and account", () => {
    const body = `You made a transaction at Uber Eats, a pending amount of $15.50 on your card ending in 1234`;
    const result = Parsers.capitalOne(body);
    assert.strictEqual(result.merchant, "Uber Eats");
    assert.strictEqual(result.amount, 15.50);
    assert.strictEqual(result.account, "1234");
  });

  test("Santander parser extracts correct amount, merchant and account from HTML", () => {
    const bodyHtml = `
      Monto: $250.00 <br>
      Cuenta terminada en 5678 <br>
      Comercio: Amazon<br>
    `;
    const body = "servicio Amazon con cargo";
    const result = Parsers.santander(body, bodyHtml);
    assert.strictEqual(result.merchant, "Amazon");
    assert.strictEqual(result.amount, 250.00);
    assert.strictEqual(result.account, "5678");
  });

  test("Bebbia parser extracts fixed account and dynamic amount", () => {
    const bodyHtml = `Cargo exitoso por $359.00`;
    const result = Parsers.bebbia(bodyHtml);
    assert.strictEqual(result.merchant, "Bebbia");
    assert.strictEqual(result.amount, 359.00);
    assert.strictEqual(result.account, "4996"); // Bebbia is hardcoded in this logic
  });
});
