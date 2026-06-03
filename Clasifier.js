/**
 * CLASSIFIER ENGINE V2: Gemini-Powered Categorization
 */

const CLASSIFIER_CONFIG = {
  MODEL: "gemini-flash-latest",
  SAFE_SLEEP_MS: 12000,
  MAX_EXECUTION_TIME_MS: 300000, // 5 minutes (GAS limit is 6)
  RETRY_ATTEMPTS: 2
};

/**
 * Main Classifier Function
 */
function fillMissingMappingCategories() {
  const startTime = new Date().getTime();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const mappingSheet = spreadsheet.getSheetByName(CONFIG.SHEETS.MAPPING);
  if (!mappingSheet) return;

  const data = mappingSheet.getDataRange().getValues();
  const schema = getMMCategorySchema();
  
  console.log("Starting merchant classification...");

  const batchSize = 15; // Process 15 items per API call
  let batch = [];
  let updated = false;

  for (let i = 1; i < data.length; i++) {
    // Check for timeout
    if (new Date().getTime() - startTime > CLASSIFIER_CONFIG.MAX_EXECUTION_TIME_MS) {
      console.log("Approaching execution limit. Stopping for now.");
      break;
    }

    const merchant = data[i][0]; // Col A: Merchant Keyword
    const item = data[i][1]; // Col B: Item
    const category = data[i][2]; // Col C: Category
    const subcategory = data[i][3]; // Col D: Subcategory

    if ((merchant || item) && (!category || !subcategory)) {
      batch.push({ index: i, merchant, item });
    }
    
    // If we reached batch size, or we are at the last row and have items in the batch
    if (batch.length === batchSize || (i === data.length - 1 && batch.length > 0)) {
      console.log(`Classifying batch of ${batch.length} items...`);
      
      try {
        const aiResults = askGeminiForCategories(batch, schema);
        
        for (let j = 0; j < aiResults.length; j++) {
          const res = aiResults[j];
          const target = batch[res.id] || batch[j]; // Fallback to array index if AI omitted ID
          
          if (target && res.category) {
             data[target.index][2] = res.category;
             data[target.index][3] = res.subcategory || "";
             updated = true;
             console.log(`Result for ${target.merchant}: ${res.category} > ${res.subcategory}`);
          }
        }
        
        if (i < data.length - 1) {
           Utilities.sleep(CLASSIFIER_CONFIG.SAFE_SLEEP_MS); 
        }
      } catch (error) {
        console.error(`Error processing batch: ${error}`);
        
        // Stop execution entirely if we hit a quota limit or 429 error
        const errorString = error.toString().toLowerCase();
        if (errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted")) {
          console.warn("Gemini API Quota exceeded. Halting classification immediately.");
          break;
        }
        
        Utilities.sleep(CLASSIFIER_CONFIG.SAFE_SLEEP_MS);
      }
      
      batch = [];
    }
  }

  // Bulk write back to the spreadsheet for performance
  if (updated) {
    mappingSheet.getDataRange().setValues(data);
  }

  console.log("Classification completed.");
}

/**
 * Builds the category schema for the prompt
 */
function getMMCategorySchema() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const catSheet = spreadsheet.getSheetByName(CONFIG.SHEETS.CATEGORIES);
  if (!catSheet) return "No schema found";

  const data = catSheet.getDataRange().getValues();
  let schemaString = "";
  let currentCat = "";

  for (let i = 0; i < data.length; i++) {
    let categoryName = data[i][0] ? data[i][0].toString().trim() : "";
    let subcategoryName = data[i][1] ? data[i][1].toString().trim() : "";
    
    if (categoryName !== "") {
      currentCat = categoryName;
      schemaString += `\n- ${currentCat}: `;
    }
    if (subcategoryName !== "" && currentCat !== "") {
      schemaString += `${subcategoryName}, `;
    }
  }
  return schemaString;
}

/**
 * Calls Gemini API with batch structured output handling
 */
function askGeminiForCategories(itemsToClassify, schema) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("GEMINI_API_KEY not found in Script Properties.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CLASSIFIER_CONFIG.MODEL}:generateContent?key=${apiKey}`;

  // Format the items into a numbered list
  const itemsList = itemsToClassify.map((it, index) => 
    `ID: ${index} | Merchant: "${it.merchant}" | Item: "${it.item || 'N/A'}"`
  ).join("\n");

  const prompt = `
    Analyze the following list of transactions.
    
    ${itemsList}
    
    TASK 1: Determine what each transaction actually is based on the merchant name and/or item description.
    
    TASK 2: Assign the best Category and Subcategory from the PROVIDED LIST below based on the actual service or product.
    - Match the Category name EXACTLY (including emojis).
    - Match the Subcategory name EXACTLY.
    - If unsure, pick the most logical one.
    
    LIST OF VALID OPTIONS:
    ${schema}

    Return ONLY a JSON array of objects, where each object corresponds to a transaction in the exact order they were provided.
    The output MUST match this JSON schema:
    [
      { "id": 0, "category": "Category Name", "subcategory": "Subcategory Name" },
      { "id": 1, "category": "Category Name", "subcategory": "Subcategory Name" }
    ]
  `;

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({ 
      "contents": [{ "parts": [{ "text": prompt }] }],
      "generationConfig": {
        "temperature": 0.1,
        "responseMimeType": "application/json"
      }
    }),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini API Error (${responseCode}): ${responseText}`);
  }

  const json = JSON.parse(responseText);
  
  if (!json.candidates || json.candidates.length === 0) {
    throw new Error("No candidates returned from Gemini.");
  }

  return JSON.parse(json.candidates[0].content.parts[0].text);
}