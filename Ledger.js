/**
 * SYSTEM ENGINE V12: The "Private Accountant"
 * Optimized for performance and modularity.
 */

const CONFIG = {
  SHEETS: {
    LEDGER: "Ledger",
    MAPPING: "Mapping",
    CATEGORIES: "Master_Categories"
  },
  GMAIL_QUERY: 'is:unread (from:santander@envio.santander.com.mx OR from:notificaciones@notificaciones.santander.com.mx OR from:nomina@ctimex.com OR from:capitalone@notification.capitalone.com)',
  LABELS: {
    NOMINA: "Tala"
  },
  COLUMNS: {
    DATE: 1,
    TYPE: 2,
    MERCHANT: 3,
    AMOUNT: 4,
    CURRENCY: 5
  }
};

/**
 * Main Orchestrator
 */
function automateSpendingRecord() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName(CONFIG.SHEETS.LEDGER);
  const mappingSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPING);
  
  ensureLedgerHeaders(ledgerSheet);
  const mappingStore = new MappingStore(mappingSheet);

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
        ledgerSheet.appendRow([
          context.date, 
          result.type, 
          result.merchant, 
          result.amount, 
          result.currency
        ]);
        
        if (result.type === "Expense") {
          mappingStore.addIfNeeded(result.merchant);
        }

        finalizeEmail(msg, thread, result.isNomina);
      } else {
        msg.markRead(); // Still mark as read even if failed to parse, to avoid loops
      }
    });
  });

  // Save any new mapping entries in bulk
  mappingStore.save();
  
  // Call classifier
  fillMissingMappingCategories();
}

/**
 * Ensures Ledger sheet is initialized correctly
 */
function ensureLedgerHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    const headers = ["Date", "Type", "Merchant / Concept", "Amount", "Currency"];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, 5);
    headerRange.setFontWeight("bold").setBackground("#f3f3f3");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 300);
    sheet.setColumnWidth(4, 100);
    sheet.setColumnWidth(5, 80);
  }
}

/**
 * Transaction Parsing Logic
 */
function parseTransaction(ctx) {
  if (ctx.from.includes("nomina@ctimex.com")) {
    return processNomina(ctx);
  } 
  
  if (ctx.from.includes("capitalone")) {
    const result = Parsers.capitalOne(ctx.body);
    return { 
      success: result.amount > 0, 
      type: "Expense", 
      merchant: result.merchant, 
      amount: result.amount, 
      currency: "USD",
      isNomina: false 
    };
  } 
  
  if (ctx.from.includes("santander")) {
    const result = Parsers.santander(ctx.body, ctx.bodyHtml);
    return { 
      success: result.amount > 0, 
      type: "Expense", 
      merchant: result.merchant, 
      amount: result.amount, 
      currency: "MXN",
      isNomina: false 
    };
  }

  return { success: false };
}

const Parsers = {
  capitalOne: function(body) {
    const merchantMatch = body.match(/Merchant:\s*(.*)/i);
    const amountMatch = body.match(/Amount:\s*\$([\d,.]+)/i);
    return {
      merchant: merchantMatch ? merchantMatch[1].trim() : "Capital One Purchase",
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0
    };
  },

  santander: function(body, bodyHtml) {
    const amountMatch = bodyHtml.match(/[Mm]onto:?(?:<\/span>)?(?:<br>)?\s*(?:de\s+)?\$?([\d,.]+)/) || 
                       bodyHtml.match(/[Mm]onto:?(?:<[^>]+>)*\s*\$?([\d,.]+)/i) || 
                       bodyHtml.match(/monto\s+de\s+(?:<[^>]+>)*\$?([\d,.]+)(?:<[^>]+>)*\s+pesos/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    let merchant = "Santander Merchant";
    const merchantHTML = bodyHtml.match(/Comercio:?(?:<\/span>)?(?:<br>)?\s*([\w\s*.-]+?)(?:\s*<br>|\s*<span)/i);
    const merchantService = body.match(/servicio\s+(.+?)\s+con cargo/i);
    const merchantStandard = body.match(/comercio\s+(.+?)\s+con tu tarjeta/i);

    if (merchantHTML) merchant = merchantHTML[1].trim();
    else if (merchantService) merchant = merchantService[1].trim();
    else if (merchantStandard) merchant = merchantStandard[1].trim();

    return {
      merchant: merchant.replace(/\n|\r/g, "").replace(/\s+/g, " ").trim(),
      amount: amount
    };
  }
};

function processNomina(ctx) {
  const xmlFile = ctx.attachments.find(a => a.getName().toLowerCase().endsWith('.xml'));
  if (!xmlFile) return { success: false };

  const xmlContent = xmlFile.getDataAsString();
  const totalMatch = xmlContent.match(/\sTotal="([\d.]+)"/);
  const netAmount = totalMatch ? parseFloat(totalMatch[1]) : 0;
  
  const infonavitRegex = /Concepto="DESCUENTO INFONAVIT CUOTA"\s+Importe="([\d.]+)"/;
  const infonavitMatch = xmlContent.match(infonavitRegex);
  const infonavitAmount = infonavitMatch ? parseFloat(infonavitMatch[1]) : 0;

  if (netAmount > 0) {
    // Note: processNomina currently appends its own rows because it might add TWO rows (Income + Infonavit)
    // To maintain consistency, we return success and handle the special case
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ledger = ss.getSheetByName(CONFIG.SHEETS.LEDGER);
    ledger.appendRow([ctx.date, "Income", "Nómina CTIMEX (Net Pay)", netAmount, "MXN"]);
    if (infonavitAmount > 0) {
      ledger.appendRow([ctx.date, "Expense", "Deducción Infonavit", infonavitAmount, "MXN"]);
    }
    return { success: true, isNomina: true, multiRow: true };
  }
  return { success: false };
}

/**
 * Handles Merchant Mapping with Caching
 */
class MappingStore {
  constructor(sheet) {
    this.sheet = sheet;
    this.existingMerchants = new Set(
      sheet.getRange("A:A").getValues().flat().filter(String)
    );
    this.newMerchants = [];
  }

  addIfNeeded(merchant) {
    if (merchant && !this.existingMerchants.has(merchant)) {
      this.newMerchants.push([merchant, "", ""]);
      this.existingMerchants.add(merchant);
    }
  }

  save() {
    if (this.newMerchants.length > 0) {
      this.sheet.getRange(this.sheet.getLastRow() + 1, 1, this.newMerchants.length, 3).setValues(this.newMerchants);
      console.log(`Added ${this.newMerchants.length} new merchants to mapping.`);
    }
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