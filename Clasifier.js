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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mappingSheet = ss.getSheetByName(CONFIG.SHEETS.MAPPING);
  if (!mappingSheet) return;

  const data = mappingSheet.getDataRange().getValues();
  const schema = getMMCategorySchema();
  
  console.log("Starting merchant classification...");


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
      console.log(`Classifying: ${merchant} | ${item}...`);
      
      try {
        const aiResult = askGeminiForCategory(merchant, item, schema);
        
        if (aiResult) {
          mappingSheet.getRange(i + 1, 3).setValue(aiResult.category);
          mappingSheet.getRange(i + 1, 4).setValue(aiResult.subcategory);
          console.log(`Result: ${aiResult.category} > ${aiResult.subcategory}`);
        }
        
        Utilities.sleep(CLASSIFIER_CONFIG.SAFE_SLEEP_MS); 
      } catch (e) {
        console.error(`Error in row ${i + 1} (${merchant}): ${e}`);
        
        // Stop execution entirely if we hit a quota limit or 429 error
        const errorString = e.toString().toLowerCase();
        if (errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted")) {
          console.warn("Gemini API Quota exceeded. Halting classification immediately.");
          break;
        }
        
        Utilities.sleep(CLASSIFIER_CONFIG.SAFE_SLEEP_MS);
      }
    }
  }
  console.log("Classification completed.");
}

/**
 * Builds the category schema for the prompt
 */
function getMMCategorySchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const catSheet = ss.getSheetByName(CONFIG.SHEETS.CATEGORIES);
  if (!catSheet) return "No schema found";

  const data = catSheet.getDataRange().getValues();
  let schemaString = "";
  let currentCat = "";

  for (let i = 0; i < data.length; i++) {
    let cat = data[i][0] ? data[i][0].toString().trim() : "";
    let sub = data[i][1] ? data[i][1].toString().trim() : "";
    
    if (cat !== "") {
      currentCat = cat;
      schemaString += `\n- ${currentCat}: `;
    }
    if (sub !== "" && currentCat !== "") {
      schemaString += `${sub}, `;
    }
  }
  return schemaString;
}

/**
 * Calls Gemini API with robust error handling
 */
function askGeminiForCategory(merchant, item, schema) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("GEMINI_API_KEY not found in Script Properties.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CLASSIFIER_CONFIG.MODEL}:generateContent?key=${apiKey}`;

  const prompt = `
    Analyze this transaction.
    Merchant: "${merchant}"
    Item Description (if available): "${item || 'N/A'}"
    
    TASK 1: Determine what this transaction actually is based on the merchant name and/or item description.
    
    TASK 2: Assign the best Category and Subcategory from the PROVIDED LIST below based on the actual service or product.
    - Match the Category name EXACTLY (including emojis).
    - Match the Subcategory name EXACTLY.
    - If unsure, pick the most logical one.
    - Return ONLY a JSON object: {"category": "Category Name", "subcategory": "Subcategory Name"}.

    LIST OF VALID OPTIONS:
    ${schema}
  `;

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({ 
      "contents": [{ "parts": [{ "text": prompt }] }],
      "generationConfig": {
        "temperature": 0.1 // Lower temperature for more consistent results
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

  let resultText = json.candidates[0].content.parts[0].text;
  
  // Robust JSON extraction (handles markdown blocks)
  const jsonMatch = resultText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  } else {
    throw new Error(`Could not parse JSON from Gemini response: ${resultText}`);
  }
}