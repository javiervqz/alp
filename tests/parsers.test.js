const { test, describe } = require("node:test");
const assert = require("node:assert");

// Mock Google Apps Script built-ins before requiring
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: () => "MOCKED_VALUE"
  })
};

global.UrlFetchApp = {
  fetch: () => ({
    getContentText: () => JSON.stringify({
      rates: {
        MXN: 24.6875
      }
    })
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

  test("Google Play parser extracts correct amount, merchant and account from subscription renewal", () => {
    const body = `Your subscription from Ellation, LLC on Google Play has renewed.
Order number: GPA.3339-8711-6722-31342..47
Order date: Jun 2, 2026 10:39:43 AM CDT
Item \tPrice
Fan (Crunchyroll: Anime Streaming) \t$9.99/month
State sales tax: $0.70
Local sales tax: $0.25
Total: $10.94/month
Payment method: \t
Mastercard-7056`;
    const result = Parsers.googlePlay(body);
    assert.strictEqual(result.merchant, "Fan (Crunchyroll: Anime Streaming) (Google Play)");
    assert.strictEqual(result.amount, 10.94);
    assert.strictEqual(result.account, "7056");
  });

  test("Google Play parser extracts correct amount, merchant and account from Google LLC subscription", () => {
    const body = `Your subscription from Google LLC on Google Play continues and you've been charged.
Order number: SOP.3388-5647-2129-67147..11
Order date: Jun 2, 2026 1:49:12 PM CST
Item \tPrice
Google AI Pro (5 TB) (Google One) (by Google LLC) \t$395.00/month
Total: $395.00/month
Payment method: \t
Mastercard-7056`;
    const result = Parsers.googlePlay(body);
    assert.strictEqual(result.merchant, "Google AI Pro (5 TB) (Google One) (by Google LLC) (Google Play)");
    assert.strictEqual(result.amount, 16.00);
    assert.strictEqual(result.account, "7056");
    assert.strictEqual(result.formula, '=395.00 / GOOGLEFINANCE("CURRENCY:USDMXN")');
  });
});
