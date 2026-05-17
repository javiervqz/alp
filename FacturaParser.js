/**
 * XML and Factura Parsing Engine
 * Consolidates all email attachment XML parsing logic.
 */

function processNomina(context) {
  const xmlFile = context.attachments.find(attachment => attachment.getName().toLowerCase().endsWith('.xml'));
  if (!xmlFile) return { success: false };

  const xmlContent = xmlFile.getDataAsString();
  const totalMatch = xmlContent.match(/\sTotal="([\d.]+)"/);
  const netAmount = totalMatch ? parseFloat(totalMatch[1]) : 0;
  
  const infonavitRegex = /Concepto="DESCUENTO INFONAVIT CUOTA"\s+Importe="([\d.]+)"/;
  const infonavitMatch = xmlContent.match(infonavitRegex);
  const infonavitAmount = infonavitMatch ? parseFloat(infonavitMatch[1]) : 0;

  if (netAmount > 0) {
    const rows = [
      { type: "Income", merchant: "Nómina CTIMEX (Net Pay)", amount: netAmount, currency: "MXN" }
    ];
    if (infonavitAmount > 0) {
      rows.push({ type: "Expense", merchant: "Deducción Infonavit", amount: infonavitAmount, currency: "MXN" });
    }
    return { success: true, isNomina: true, multiRow: true, rows: rows };
  }
  return { success: false };
}

function processFactura(context) {
  const xmlFile = context.attachments.find(attachment => attachment.getName().toLowerCase().endsWith('.xml'));
  if (!xmlFile) return { success: false };

  try {
    const xmlContent = xmlFile.getDataAsString();
    
    const emisorRegex = /<cfdi:Emisor[^>]*Nombre="([^"]+)"/;
    const emisorMatch = xmlContent.match(emisorRegex);
    const merchantName = emisorMatch ? emisorMatch[1] : "Factura";

    // Split by <cfdi:Concepto to isolate each item and its nested taxes
    const conceptoBlocks = xmlContent.split(/<cfdi:Concepto\s/i).slice(1);
    const items = [];
    
    for (const block of conceptoBlocks) {
      const descMatch = block.match(/Descripcion="([^"]+)"/i);
      const importeMatch = block.match(/Importe="([\d.]+)"/i);
      
      if (descMatch && importeMatch) {
        let descripcion = descMatch[1];
        let importe = parseFloat(importeMatch[1]);
        
        // Find IVA inside this specific block
        const ivaRegex = /<cfdi:Traslado[^>]*Impuesto="002"[^>]*Importe="([\d.]+)"/gi;
        let ivaMatch;
        let totalIva = 0;
        while ((ivaMatch = ivaRegex.exec(block)) !== null) {
          totalIva += parseFloat(ivaMatch[1]);
        }
        
        items.push({
          descripcion: descripcion,
          importe: importe + totalIva
        });
      }
    }
    
    if (items.length === 0) return { success: false };

    // Create rows for the Ledger (one per item)
    const rows = items.map(item => ({
      type: "Expense",
      merchant: merchantName,
      item: item.descripcion,
      amount: item.importe,
      currency: "MXN",
      account: ""
    }));

    return { success: true, isNomina: false, multiRow: true, rows: rows };
    
  } catch (error) {
    console.error(`Error parsing factura XML: ${error}`);
  }
  
  return { success: false };
}