/**
 * SYSTEM ENGINE V13: The "Private Accountant"
 * Extensible parser architecture with Deduplication.
 */

const SUPPORTED_SENDERS = [
  "santander@envio.santander.com.mx",
  "notificaciones@notificaciones.santander.com.mx",
  "nomina@ctimex.com",
  "capitalone@notification.capitalone.com",
  "ventasecom@bebbia.com",
  "contacto@parcoapp.com"
];

const SUPPORTED_FACTURA_SENDERS = [
  "facturacion@gruporfacil.com",
  "jvrvzqzp@gmail.com"
];

const CONFIG = {
  SHEETS: {
    LEDGER: "Ledger",
    MAPPING: "Mapping",
    CATEGORIES: "Master_Categories",
    GROCERIES: "Groceries"
  },
  GROCERY_KEYWORDS: ["alsuper", "walmart", "costco", "sams", "oxxo"],
  GMAIL_QUERY: `is:unread (${[...SUPPORTED_SENDERS, ...SUPPORTED_FACTURA_SENDERS].map(s => `from:${s}`).join(' OR ')})`,
  LABELS: {
    NOMINA: PropertiesService.getScriptProperties().getProperty('NOMINA')
  },
  COLUMNS: {
    DATE: 1,
    TYPE: 2,
    MERCHANT: 3,
    ITEM: 4,
    AMOUNT: 5,
    CURRENCY: 6,
    ACCOUNT: 7
  },
  DEDUPLICATION: {
    TIME_WINDOW_DAYS: 3, // Prevent duplicates within 3 days
    LOOKBACK_ROWS: 100   // Rows to look back for duplicates
  }
};

/**
 * Main Orchestrator
 */
function automateSpendingRecord() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName(CONFIG.SHEETS.LEDGER);
  const mappingSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPING);
  const grocerySheet = ss.getSheetByName(CONFIG.SHEETS.GROCERIES) || ss.insertSheet(CONFIG.SHEETS.GROCERIES);
  
  ensureLedgerHeaders(ledgerSheet);
  ensureLedgerHeaders(grocerySheet);
  const mappingStore = new MappingStore(mappingSheet);
  const ledgerManager = new LedgerManager(ledgerSheet);
  const groceryManager = new LedgerManager(grocerySheet);

  const threads = GmailApp.search(CONFIG.GMAIL_QUERY);
  console.log(`Found ${threads.length} threads to process.`);
  
  threads.forEach(thread => {
    const messages = thread.getMessages();
    
    messages.forEach(msg => {
      if (!msg.isUnread()) return;

      const context = {
        from: msg.getFrom().toLowerCase(),
        date: msg.getDate(),
        body: msg.getPlainBody(),
        bodyHtml: msg.getBody(),
        attachments: msg.getAttachments()
      };

      const result = parseTransaction(context);
      
      if (result && result.success) {
        const rows = result.multiRow ? result.rows : [result];
        
        rows.forEach(row => {
          const isGrocery = CONFIG.GROCERY_KEYWORDS.some(kw => 
            row.merchant.toLowerCase().includes(kw.toLowerCase())
          );

          if (isGrocery) {
            groceryManager.appendTransaction(context.date, row.type, row.merchant, row.item || "", row.amount, row.currency, row.account || "");
            if (row.type === "Expense") {
              mappingStore.addIfNeeded(row.merchant, row.item || "");
            }
          } else {
            ledgerManager.appendTransaction(context.date, row.type, row.merchant, row.item || "", row.amount, row.currency, row.account || "");
            if (row.type === "Expense") {
              mappingStore.addIfNeeded(row.merchant, row.item || "");
            }
          }
        });

        finalizeEmail(msg, thread, result.isNomina);
      } else {
        msg.markRead(); // Still mark as read even if failed to parse, to avoid loops
      }
    });
  });

  // Save any new mapping entries in bulk
  mappingStore.save();
}

/**
 * Extensible Parser Registry
 * To add a new merchant email, just add the parser logic here and the email to SUPPORTED_SENDERS.
 */
const ParserRegistry = [
  {
    match: (ctx) => ctx.from.includes("nomina@ctimex.com"),
    parse: (ctx) => processNomina(ctx)
  },
  {
    match: (ctx) => SUPPORTED_FACTURA_SENDERS.some(s => ctx.from.includes(s)),
    parse: (ctx) => processFactura(ctx)
  },
  {
    match: (ctx) => ctx.from.includes("capitalone"),
    parse: (ctx) => {
      const result = Parsers.capitalOne(ctx.body);
      return { success: result.amount > 0, type: "Expense", merchant: result.merchant, amount: result.amount, currency: "USD", account: result.account, isNomina: false };
    }
  },
  {
    match: (ctx) => ctx.from.includes("santander"),
    parse: (ctx) => {
      const result = Parsers.santander(ctx.body, ctx.bodyHtml);
      return { success: result.amount > 0, type: "Expense", merchant: result.merchant, amount: result.amount, currency: "MXN", account: result.account, isNomina: false };
    }
  },
  {
    match: (ctx) => ctx.from.includes("bebbia.com"),
    parse: (ctx) => {
      const result = Parsers.bebbia(ctx.bodyHtml);
      return { success: result.amount > 0, type: "Expense", merchant: result.merchant, amount: result.amount, currency: "MXN", account: result.account, isNomina: false };
    }
  },
  {
    match: (ctx) => ctx.from.includes("parcoapp.com"),
    parse: (ctx) => {
      const result = Parsers.parco(ctx.bodyHtml);
      return { success: result.amount > 0, type: "Expense", merchant: result.merchant, amount: result.amount, currency: "MXN", account: result.account, isNomina: false };
    }
  }
];

function parseTransaction(ctx) {
  for (const parser of ParserRegistry) {
    if (parser.match(ctx)) {
      return parser.parse(ctx);
    }
  }
  return { success: false };
}

const Parsers = {
  capitalOne: function(body) {
    const merchantMatch = body.match(/at\s+([^,]+),\s+a\s+pending/i) || body.match(/Merchant:\s*(.*)/i);
    const amountMatch = body.match(/amount\s+of\s+\$([\d,.]+)/i) || body.match(/Amount:\s*\$([\d,.]+)/i);
    const accountMatch = body.match(/ending in (\d{4})/i);
    return {
      merchant: merchantMatch ? merchantMatch[1].trim() : "Capital One Purchase",
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      account: accountMatch ? accountMatch[1] : ""
    };
  },

  santander: function(body, bodyHtml) {
    const amountMatch = bodyHtml.match(/[Mm]onto:?(?:<\/span>)?(?:<br>)?\s*(?:de\s+)?\$?([\d,.]+)/) || 
                       bodyHtml.match(/[Mm]onto:?(?:<[^>]+>)*\s*\$?([\d,.]+)/i) || 
                       bodyHtml.match(/monto\s+de\s+(?:<[^>]+>)*\$?([\d,.]+)(?:<[^>]+>)*\s+pesos/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    const accountMatch = bodyHtml.match(/terminada en (\d{4})/i) || bodyHtml.match(/\*{4}(\d{4})/i) || bodyHtml.match(/cuenta\s*(?:\*{4})?(\d{4})/i);
    const account = accountMatch ? accountMatch[1] : "";

    let merchant = "Santander Merchant";
    const merchantHTML = bodyHtml.match(/Comercio:?(?:<\/span>)?(?:<br>)?\s*([\w\s*.-]+?)(?:\s*<br>|\s*<span)/i);
    const merchantService = body.match(/servicio\s+(.+?)\s+con cargo/i);
    const merchantStandard = body.match(/comercio\s+(.+?)\s+con tu tarjeta/i);

    if (merchantHTML) merchant = merchantHTML[1].trim();
    else if (merchantService) merchant = merchantService[1].trim();
    else if (merchantStandard) merchant = merchantStandard[1].trim();

    return {
      merchant: merchant.replace(/\n|\r/g, "").replace(/\s+/g, " ").trim(),
      amount: amount,
      account: account
    };
  },

  bebbia: function(bodyHtml) {
    const amountMatch = bodyHtml.match(/\$\s*([\d,.]+)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    return {
      merchant: "Bebbia",
      amount: amount,
      account: "4996"
    };
  },

  parco: function(bodyHtml) {
    // Parco uses a table cell with specific styling for merchant and amount
    const regex = /font-size:\s*20px;\s*font-weight:\s*bold[^>]*>([^<]+)<\/td>[\s\S]*?font-size:\s*20px;\s*font-weight:\s*bold[^>]*>\$([\d,.]+)/i;
    const match = bodyHtml.match(regex);
    
    let merchant = "Parco App";
    let amount = 0;
    
    if (match) {
      merchant = match[1].trim();
      amount = parseFloat(match[2].replace(/,/g, ''));
    } else {
      const fallbackAmountMatch = bodyHtml.match(/\$\s*([\d,.]+)/);
      if (fallbackAmountMatch) amount = parseFloat(fallbackAmountMatch[1].replace(/,/g, ''));
    }

    if (merchant !== "Parco App") merchant += " (Parco)";

    return {
      merchant: merchant,
      amount: amount,
      account: "4996"
    };
  }
};

/**
 * Deduplication & Write Logic
 */
class LedgerManager {
  constructor(sheet) {
    this.sheet = sheet;
    this.recentTransactions = [];
    this.loadRecent();
  }

  loadRecent() {
    const lastRow = this.sheet.getLastRow();
    if (lastRow <= 1) return;
    
    const startRow = Math.max(2, lastRow - CONFIG.DEDUPLICATION.LOOKBACK_ROWS + 1);
    const numRows = lastRow - startRow + 1;
    
    // Date (col 1), Type (col 2), Merchant (col 3), Item (col 4), Amount (col 5), Currency (col 6), Account (col 7)
    const data = this.sheet.getRange(startRow, 1, numRows, 7).getValues();
    
    this.recentTransactions = data.map(row => ({
      date: new Date(row[0]),
      type: row[1],
      merchant: row[2],
      item: row[3],
      amount: parseFloat(row[4]),
      currency: row[5]
    }));
  }

  isDuplicate(date, type, merchant, item, amount, currency) {
    if (type !== "Expense") return false; // Usually only expenses are duplicated via notifications
    
    const threshold = CONFIG.DEDUPLICATION.TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const targetDate = new Date(date);
    
    return this.recentTransactions.some(tx => {
      if (!tx.date || isNaN(tx.amount)) return false;
      if (tx.type !== type || tx.currency !== currency) return false;
      
      // Robust check for items from facturas
      if (tx.merchant !== merchant) return false;
      if (tx.item !== item) return false;
      
      const timeDiff = Math.abs(targetDate - tx.date);
      const isSameAmount = Math.abs(tx.amount - amount) < 0.01;
      
      return timeDiff <= threshold && isSameAmount;
    });
  }

  appendTransaction(date, type, merchant, item, amount, currency, account) {
    if (this.isDuplicate(date, type, merchant, item, amount, currency)) {
      console.log(`Skipping duplicate transaction: ${merchant} | ${item} for ${amount} ${currency}`);
      return false; // Not added
    }
    
    this.sheet.appendRow([date, type, merchant, item || "", amount, currency, account || ""]);
    
    // Add to recent memory so we don't duplicate within the same batch
    this.recentTransactions.push({ 
      date: new Date(date), 
      type: type, 
      merchant: merchant,
      item: item || "",
      amount: amount, 
      currency: currency 
    });
    
    return true; // Added successfully
  }
}

/**
 * Handles Merchant Mapping with Caching
 */
class MappingStore {
  constructor(sheet) {
    this.sheet = sheet;
    const existingData = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
    this.existingMerchants = new Set(
      existingData.map(row => `${row[0] || ""}|${row[1] || ""}`)
    );
    this.newMerchants = [];
  }

  addIfNeeded(merchant, item) {
    const key = `${merchant || ""}|${item || ""}`;
    if ((merchant || item) && !this.existingMerchants.has(key)) {
      this.newMerchants.push([merchant || "", item || "", "", ""]);
      this.existingMerchants.add(key);
    }
  }

  save() {
    if (this.newMerchants.length > 0) {
      this.sheet.getRange(this.sheet.getLastRow() + 1, 1, this.newMerchants.length, 4).setValues(this.newMerchants);
      console.log(`Added ${this.newMerchants.length} new merchants to mapping.`);
    }
  }
}

/**
 * Ensures Ledger sheet is initialized correctly
 */
function ensureLedgerHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    const headers = ["Date", "Type", "Merchant / Concept", "Item", "Amount", "Currency", "Account"];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, 7);
    headerRange.setFontWeight("bold").setBackground("#f3f3f3");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 300);
    sheet.setColumnWidth(4, 250);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 80);
    sheet.setColumnWidth(7, 80);
  }
}

/**
 * Final Disposition of Email
 */
function finalizeEmail(msg, thread, isNomina) {
  msg.markRead();
  if (isNomina) {
    fileToLabel(thread, CONFIG.LABELS.NOMINA);
  } else {
    msg.moveToTrash();
  }
}

function fileToLabel(thread, labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  label.addToThread(thread);
  thread.moveToArchive();
}
