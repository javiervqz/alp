# SYSTEM ENGINE V12: The "Private Accountant"

An automated financial tracking system built with Google Apps Script. It orchestrates the process of fetching bank transactions from Gmail, recording them in a Google Sheet, and automatically categorizing them using Gemini AI.

## Features

- **Automated Parsing**: Extracts transaction details (Date, Merchant, Amount, Currency) from Gmail notifications (Santander, Capital One, CTIMEX).
- **Payroll Handling**: Specialized logic for "Nómina" (Payroll) emails, including automatic recording of net pay and deductions (e.g., Infonavit).
- **Smart Categorization**: Uses the Gemini Pro API to automatically categorize new merchants based on a master list of categories and subcategories.
- **Merchant Mapping**: Maintains a `Mapping` sheet to cache merchant names and their assigned categories for consistency.
- **Label Management**: Automatically labels processed emails and archives them.

## Prerequisites

- A Google Spreadsheet with the following sheets:
  - `Ledger`: Where transactions are recorded.
  - `Mapping`: Where merchant keywords and categories are stored.
  - `Master_Categories`: A list of valid categories and subcategories.
- A Google Cloud Project with the Gemini API enabled.

## Configuration

The system relies on the following **Script Properties** (File > Project settings > Script Properties):

| Property | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Your Google AI Studio API Key. |
| `NOMINA` | The Gmail label name used for filing payroll (Nómina) emails. |

## File Structure

- `Ledger.js`: The main engine that handles Gmail searching, transaction parsing, and spreadsheet updates.
- `Clasifier.js`: The AI-powered categorization engine that interacts with the Gemini API.
- `appsscript.json`: Manifest file for the Google Apps Script project.

## Setup

1. Create a new Google Apps Script project.
2. Copy the contents of `Ledger.js` and `Clasifier.js` into the project.
3. Configure the **Script Properties** as mentioned above.
4. Set up a time-based trigger for `automateSpendingRecord` to run periodically (e.g., every hour).
5. (Optional) Run `fillMissingMappingCategories` manually or via trigger to categorize new merchants.

## License

MIT
