/**
 * XML and Factura Parsing Engine
 * Consolidates all email attachment XML parsing logic.
 */

function processNomina(context) {
  const xmlFile = context.attachments.find(attachment => attachment.getName().toLowerCase().endsWith('.xml'));
  if (!xmlFile) return { success: false };

  try {
    const xmlContent = xmlFile.getDataAsString();
    // Strip BOM or any characters before the XML declaration/root
    const cleanXml = xmlContent.substring(xmlContent.indexOf('<'));
    const document = XmlService.parse(cleanXml);
    const root = document.getRootElement();
    
    const totalAttr = root.getAttribute('Total');
    const netAmount = totalAttr ? parseFloat(totalAttr.getValue()) : 0;
    
    let infonavitAmount = 0;
    
    const descendants = root.getDescendants();
    for (let i = 0; i < descendants.length; i++) {
      const node = descendants[i];
      if (node.getType() === XmlService.ContentTypes.ELEMENT) {
        const element = node.asElement();
        const conceptoAttr = element.getAttribute('Concepto');
        if (conceptoAttr && conceptoAttr.getValue().toUpperCase() === "DESCUENTO INFONAVIT CUOTA") {
          const importeAttr = element.getAttribute('Importe');
          if (importeAttr) {
            infonavitAmount = parseFloat(importeAttr.getValue());
            break; 
          }
        }
      }
    }

    if (netAmount > 0) {
      const rows = [
        { type: "Income", merchant: "Nómina CTIMEX (Net Pay)", amount: netAmount, currency: "MXN" }
      ];
      if (infonavitAmount > 0) {
        rows.push({ type: "Expense", merchant: "Deducción Infonavit", amount: infonavitAmount, currency: "MXN" });
      }
      return { success: true, isNomina: true, multiRow: true, rows: rows };
    }
  } catch (error) {
    console.error(`Error parsing nomina XML with XmlService: ${error}`);
  }
  return { success: false };
}

function processFactura(context) {
  const xmlFile = context.attachments.find(attachment => attachment.getName().toLowerCase().endsWith('.xml'));
  if (!xmlFile) return { success: false };

  try {
    const xmlContent = xmlFile.getDataAsString();
    // Strip BOM or any characters before the XML declaration/root
    const cleanXml = xmlContent.substring(xmlContent.indexOf('<'));
    const document = XmlService.parse(cleanXml);
    const root = document.getRootElement();
    const ns = root.getNamespace();
    
    let merchantName = "Factura";
    const emisorElement = root.getChild('Emisor', ns);
    if (emisorElement) {
      const nombreAttr = emisorElement.getAttribute('Nombre');
      if (nombreAttr) merchantName = nombreAttr.getValue();
    }

    const items = [];
    const conceptosElement = root.getChild('Conceptos', ns);
    
    if (conceptosElement) {
      const conceptosList = conceptosElement.getChildren('Concepto', ns);
      
      for (let i = 0; i < conceptosList.length; i++) {
        const concepto = conceptosList[i];
        
        const descripcionAttr = concepto.getAttribute('Descripcion');
        const importeAttr = concepto.getAttribute('Importe');
        const descuentoAttr = concepto.getAttribute('Descuento');
        
        if (descripcionAttr && importeAttr) {
          let descripcion = descripcionAttr.getValue();
          let importe = parseFloat(importeAttr.getValue());
          let descuento = descuentoAttr ? parseFloat(descuentoAttr.getValue()) : 0;
          
          let totalTaxes = 0;
          const impuestosElement = concepto.getChild('Impuestos', ns);
          if (impuestosElement) {
            const trasladosElement = impuestosElement.getChild('Traslados', ns);
            if (trasladosElement) {
              const trasladosList = trasladosElement.getChildren('Traslado', ns);
              for (let j = 0; j < trasladosList.length; j++) {
                const traslado = trasladosList[j];
                const impuestoImporteAttr = traslado.getAttribute('Importe');
                if (impuestoImporteAttr) {
                  totalTaxes += parseFloat(impuestoImporteAttr.getValue());
                }
              }
            }
          }
          
          items.push({
            descripcion: descripcion,
            importe: importe - descuento + totalTaxes
          });
        }
      }
    }
    
    if (items.length === 0) return { success: false };

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
    console.error(`Error parsing factura XML with XmlService: ${error}`);
  }
  
  return { success: false };
}