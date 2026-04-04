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

  // Recorremos desde la fila 2 (índice 1) para saltar encabezados
  for (let i = 1; i < data.length; i++) {
    // Check for timeout
    if (new Date().getTime() - startTime > CLASSIFIER_CONFIG.MAX_EXECUTION_TIME_MS) {
      console.log("Approaching execution limit. Stopping for now.");
      break;
    }

    const merchant = data[i][0]; // Columna A: Merchant Keyword
    const category = data[i][1]; // Columna B: Category
    const subcategory = data[i][2]; // Columna C: Subcategory

    // Si el Merchant existe pero la Categoría O Subcategoría están vacías
    if (merchant && (!category || !subcategory)) {
      console.log(`Clasificando: ${merchant}...`);
      
      try {
        const aiResult = askGeminiForCategory(merchant, schema);
        
        if (aiResult) {
          mappingSheet.getRange(i + 1, 2).setValue(aiResult.category);
          mappingSheet.getRange(i + 1, 3).setValue(aiResult.subcategory);
          console.log(`Resultado: ${aiResult.category} > ${aiResult.subcategory}`);
        }
        
        Utilities.sleep(CLASSIFIER_CONFIG.SAFE_SLEEP_MS); 
      } catch (e) {
        console.error(`Error en fila ${i + 1} (${merchant}): ${e}`);
        Utilities.sleep(CLASSIFIER_CONFIG.SAFE_SLEEP_MS);
      }
    }
  }
  console.log("Proceso de clasificación completado.");
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
function askGeminiForCategory(merchant, schema) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("GEMINI_API_KEY not found in Script Properties.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CLASSIFIER_CONFIG.MODEL}:generateContent?key=${apiKey}`;

  const prompt = `
    Analyze this bank merchant: "${merchant}".
    
    TASK:
    Assign the best Category and Subcategory from the PROVIDED LIST below.
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