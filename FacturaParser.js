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
      // Isolate the Concepto block to avoid matching global taxes at the end of the file
      const isolatedBlock = block.split(/<\/cfdi:Concepto>/i)[0];
      
      const descMatch = isolatedBlock.match(/Descripcion="([^"]+)"/i);
      const importeMatch = isolatedBlock.match(/Importe="([\d.]+)"/i);
      const descuentoMatch = isolatedBlock.match(/Descuento="([\d.]+)"/i);
      
      if (descMatch && importeMatch) {
        let descripcion = descMatch[1];
        let importe = parseFloat(importeMatch[1]);
        let descuento = descuentoMatch ? parseFloat(descuentoMatch[1]) : 0;
        
        // Find all taxes (Traslados like IVA and IEPS) inside this specific block
        const taxRegex = /<cfdi:Traslado[^>]*Importe="([\d.]+)"/gi;
        let taxMatch;
        let totalTaxes = 0;
        while ((taxMatch = taxRegex.exec(isolatedBlock)) !== null) {
          totalTaxes += parseFloat(taxMatch[1]);
        }
        
        items.push({
          descripcion: descripcion,
          importe: importe - descuento + totalTaxes
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

    return { success: true, isNomina: false, isFactura: true, multiRow: true, rows: rows };
    
  } catch (error) {
    console.error(`Error parsing factura XML: ${error}`);
  }
  
  return { success: false };
}