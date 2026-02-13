const { test, expect } = require('@playwright/test');

/**
 * Helper to generate a valid PDF binary with specific page sizes.
 * Adds a filled rectangle to each page so content bounds are detected.
 */
function createPDF(pageSizes) {
    const objects = [];
    let objId = 1;
    
    const catalogId = objId++;
    const rootId = objId++;
    
    const pageIds = [];
    const pageObjects = [];
    const contentObjects = [];
    
    pageSizes.forEach(size => {
        const pageId = objId++;
        const contentId = objId++;
        pageIds.push(pageId);
        
        // Draw a rectangle slightly inside the page so it's not detected as background
        // Margin of 10 units on each side.
        const margin = 10;
        const rectW = size.w - (margin * 2);
        const rectH = size.h - (margin * 2);
        const stream = `${margin} ${margin} ${rectW} ${rectH} re f`;
        
        pageObjects.push({
            id: pageId,
            content: `<< /Type /Page /Parent ${rootId} 0 R /MediaBox [0 0 ${size.w} ${size.h}] /Contents ${contentId} 0 R /Resources << >> >>`
        });
        
        contentObjects.push({
            id: contentId,
            content: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
        });
    });
    
    objects.push({ id: catalogId, content: `<< /Type /Catalog /Pages ${rootId} 0 R >>` });
    objects.push({ id: rootId, content: `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageSizes.length} >>` });
    objects.push(...pageObjects);
    objects.push(...contentObjects);

    let body = `%PDF-1.7\n`;
    const xref = [`0000000000 65535 f \n`];
    let offset = body.length;
    
    // Sort by ID to ensure xref table is ordered
    objects.sort((a, b) => a.id - b.id);
    
    for (const obj of objects) {
        const entry = `${String(offset).padStart(10, '0')} 00000 n \n`;
        xref.push(entry);
        body += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
        offset = body.length;
    }
    
    const xrefOffset = offset;
    body += `xref\n0 ${objects.length + 1}\n${xref.join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
    body += `startxref\n${xrefOffset}\n%%EOF`;
    
    return Buffer.from(body);
}

/**
 * Helper to generate a PDF with a Form XObject containing content.
 * Used to test flattening/content detection logic.
 */
function createPDFWithXObject(pageSize, rect) {
    const objects = [];
    let objId = 1;
    
    const catalogId = objId++;
    const rootId = objId++;
    const pageId = objId++;
    const xobjectId = objId++;
    const contentId = objId++;
    
    // Draw rectangle inside XObject
    const xobjStream = `${rect.x} ${rect.y} ${rect.w} ${rect.h} re f`;
    
    // Draw XObject on Page
    const pageStream = `/F1 Do`;
    
    objects.push({ id: catalogId, content: `<< /Type /Catalog /Pages ${rootId} 0 R >>` });
    objects.push({ id: rootId, content: `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>` });
    
    objects.push({
        id: pageId,
        content: `<< /Type /Page /Parent ${rootId} 0 R /MediaBox [0 0 ${pageSize.w} ${pageSize.h}] /Contents ${contentId} 0 R /Resources << /XObject << /F1 ${xobjectId} 0 R >> >> >>`
    });

    // Note: BBox is set to full page size to verify that we detect the *actual* content (rect) 
    // inside the form, not just the form's bounding box.
    objects.push({
        id: xobjectId,
        content: `<< /Type /XObject /Subtype /Form /BBox [0 0 ${pageSize.w} ${pageSize.h}] /Length ${xobjStream.length} >>\nstream\n${xobjStream}\nendstream`
    });

    objects.push({
        id: contentId,
        content: `<< /Length ${pageStream.length} >>\nstream\n${pageStream}\nendstream`
    });

    let body = `%PDF-1.7\n`;
    const xref = [`0000000000 65535 f \n`];
    let offset = body.length;
    
    objects.sort((a, b) => a.id - b.id);
    
    for (const obj of objects) {
        const entry = `${String(offset).padStart(10, '0')} 00000 n \n`;
        xref.push(entry);
        body += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
        offset = body.length;
    }
    
    const xrefOffset = offset;
    body += `xref\n0 ${objects.length + 1}\n${xref.join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
    body += `startxref\n${xrefOffset}\n%%EOF`;
    
    return Buffer.from(body);
}

/**
 * Helper to generate a PDF with a specific grayscale color rectangle.
 * colorVal: 0.0 (Black) to 1.0 (White)
 */
function createPDFWithColor(pageSize, rect, colorVal) {
    const objects = [];
    let objId = 1;
    const catalogId = objId++;
    const rootId = objId++;
    const pageId = objId++;
    const contentId = objId++;

    // Set color (g = grayscale) and fill rect
    const stream = `${colorVal} g ${rect.x} ${rect.y} ${rect.w} ${rect.h} re f`;

    objects.push({ id: catalogId, content: `<< /Type /Catalog /Pages ${rootId} 0 R >>` });
    objects.push({ id: rootId, content: `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>` });
    objects.push({
        id: pageId,
        content: `<< /Type /Page /Parent ${rootId} 0 R /MediaBox [0 0 ${pageSize.w} ${pageSize.h}] /Contents ${contentId} 0 R /Resources << >> >>`
    });
    objects.push({
        id: contentId,
        content: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    });

    let body = `%PDF-1.7\n`;
    const xref = [`0000000000 65535 f \n`];
    let offset = body.length;
    objects.sort((a, b) => a.id - b.id);
    for (const obj of objects) {
        const entry = `${String(offset).padStart(10, '0')} 00000 n \n`;
        xref.push(entry);
        body += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
        offset = body.length;
    }
    const xrefOffset = offset;
    body += `xref\n0 ${objects.length + 1}\n${xref.join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
    body += `startxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(body);
}

test.describe('Worker Logic Unit Tests', () => {
    
    // Helper to run the worker in the browser context and parse results
    async function processPdfInWorker(page, pdfBuffer, config) {
        const dataArray = [...pdfBuffer];
        
        return await page.evaluate(async ({ data, config }) => {
            const worker = new Worker('worker.js');
            
            const resultPromise = new Promise((resolve, reject) => {
                worker.onmessage = (e) => {
                    if (e.data.type === 'COMPLETE') resolve(e.data.data);
                    else if (e.data.type === 'ERROR') reject(e.data.data);
                };
                worker.onerror = (e) => reject(e.message);
            });

            // Wait for worker readiness
            await new Promise(resolve => {
                const readyHandler = (e) => {
                    if (e.data.type === 'READY') {
                        worker.removeEventListener('message', readyHandler);
                        resolve();
                    }
                };
                worker.addEventListener('message', readyHandler);
            });

            worker.postMessage({ 
                type: 'PROCESS_PDF', 
                data: new Uint8Array(data), 
                config: config 
            });

            const result = await resultPromise;
            
            // Parse MediaBoxes from result PDF string using Regex
            const str = new TextDecoder('latin1').decode(result);
            const mediaBoxes = [];
            
            // Find all Page objects
            const objRegex = /\d+\s+0\s+obj[\s\S]*?endobj/g;
            const objs = str.match(objRegex) || [];
            
            for (const objStr of objs) {
                if (objStr.includes('/Type /Page') || objStr.includes('/Type/Page')) {
                    const mbMatch = /\/MediaBox\s*\[\s*([-\d\.]+)\s+([-\d\.]+)\s+([-\d\.]+)\s+([-\d\.]+)\s*\]/.exec(objStr);
                    if (mbMatch) {
                        mediaBoxes.push({
                            w: parseFloat(mbMatch[3]) - parseFloat(mbMatch[1]),
                            h: parseFloat(mbMatch[4]) - parseFloat(mbMatch[2])
                        });
                    }
                }
            }
            return mediaBoxes;
        }, { data: dataArray, config });
    }

    test('Long Page Handling: Should preserve width of normal pages but expand height for long pages', async ({ page }) => {
        await page.goto('/');

        // 1. Normal (600x800) -> Content 580x780
        // 2. Long (600x3000) -> Content 580x2980
        // 3. Normal (600x800) -> Content 580x780
        const inputSizes = [{ w: 600, h: 800 }, { w: 600, h: 3000 }, { w: 600, h: 800 }];
        const pdfData = createPDF(inputSizes);

        // Target: 1:1 aspect ratio (e.g. 1000x1000)
        const config = { tablet: { width: 1000, height: 1000, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);

        expect(outputSizes.length).toBe(3);
        // Base Height = 780 (Median). Base Width = 780 * 1.0 = 780.

        // Page 1: 780x780
        expect(outputSizes[0].w).toBeCloseTo(780, 0);
        expect(outputSizes[0].h).toBeCloseTo(780, 0);

        // Page 2: Width clamped to 780, Height expanded to 2980
        expect(outputSizes[1].w).toBeCloseTo(780, 0);
        expect(outputSizes[1].h).toBeCloseTo(2980, -1);
    });

    test('Proportions: Median calculation should ignore outliers (small and long pages)', async ({ page }) => {
        await page.goto('/');

        // 10 Small Title Pages (100x100), 20 Body Pages (600x800), 5 Long Pages (600x3000)
        const inputSizes = [];
        for (let i = 0; i < 10; i++) inputSizes.push({ w: 100, h: 100 }); // Content 80x80
        for (let i = 0; i < 20; i++) inputSizes.push({ w: 600, h: 800 }); // Content 580x780
        for (let i = 0; i < 5; i++) inputSizes.push({ w: 600, h: 3000 }); // Content 580x2980

        const pdfData = createPDF(inputSizes);
        // Target Ratio 0.5 (Width 500, Height 1000)
        const config = { tablet: { width: 500, height: 1000, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);

        // Median Height should be 780. Base Width = 780 * 0.5 = 390.
        
        // Verify distribution of page sizes (Order is not guaranteed by PDFium SaveAsCopy)
        
        // 1. Small Pages (10): Scaled to Base Height (780). Width 390.
        const smallPages = outputSizes.filter(p => Math.abs(p.w - 390) < 1 && Math.abs(p.h - 780) < 1);
        expect(smallPages.length).toBe(10);

        // 2. Body Pages (20): Height 780. Width expands to 580 (Content Width).
        const bodyPages = outputSizes.filter(p => Math.abs(p.w - 580) < 1 && Math.abs(p.h - 780) < 1);
        expect(bodyPages.length).toBe(20);

        // 3. Long Pages (5): Width 580. Height expands to 2980.
        const longPages = outputSizes.filter(p => Math.abs(p.w - 580) < 1 && Math.abs(p.h - 2980) < 5);
        expect(longPages.length).toBe(5);
    });

    test('Stress Test: 1000 Pages', async ({ page }) => {
        test.setTimeout(60000); // Increase timeout for large PDF
        await page.goto('/');

        const inputSizes = Array(1000).fill({ w: 600, h: 800 });
        const pdfData = createPDF(inputSizes);
        const config = { tablet: { width: 1000, height: 1000, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);
        expect(outputSizes.length).toBe(1000);
    });

    test('XObject Handling: Should detect content inside Form XObjects', async ({ page }) => {
        await page.goto('/');

        // Page 1000x1000.
        // XObject contains a rect at 100,100 200x200 (so ends at 300,300).
        // The XObject itself has a BBox of [0 0 1000 1000].
        // If flattening works, we detect the rect [100, 100, 300, 300].
        // If flattening fails, we likely detect the Form BBox [0, 0, 1000, 1000].
        
        const pageSize = { w: 1000, h: 1000 };
        const rect = { x: 100, y: 100, w: 200, h: 200 }; 
        
        const pdfData = createPDFWithXObject(pageSize, rect);
        const config = { tablet: { width: 500, height: 500, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);

        expect(outputSizes.length).toBe(1);
        // Expect tight crop around the 200x200 content
        expect(outputSizes[0].w).toBeCloseTo(200, 1);
        expect(outputSizes[0].h).toBeCloseTo(200, 1);
    });

    test('Noise Threshold: Should ignore very faint artifacts but detect light content', async ({ page }) => {
        await page.goto('/');
        const pageSize = { w: 1000, h: 1000 };
        const rect = { x: 100, y: 100, w: 200, h: 200 };
        const config = { tablet: { width: 500, height: 500, epsilon: 0 } };

        // 1. Very faint gray (0.99) -> Should be treated as white/noise (Empty Page)
        // 0.99 * 255 = 252.45. Threshold is 250. 252 > 250, so it's "white".
        const pdfFaint = createPDFWithColor(pageSize, rect, 0.99);
        const outputFaint = await processPdfInWorker(page, pdfFaint, config);
        // Empty page returns center point, so width/height should be 0 or minimal
        // Actually, logic returns isEmpty: true, so contentW=0, contentH=0.
        // Base Page 500x500.
        expect(outputFaint[0].w).toBeCloseTo(500, 1);

        // 2. Light gray (0.90) -> Should be detected
        // 0.90 * 255 = 229.5. 229 < 250, so it's "content".
        const pdfLight = createPDFWithColor(pageSize, rect, 0.90);
        const outputLight = await processPdfInWorker(page, pdfLight, config);
        expect(outputLight[0].w).toBeCloseTo(200, 1);
    });

    test('Invalid Config: Should handle zero/NaN dimensions gracefully', async ({ page }) => {
        await page.goto('/');
        const inputSizes = [{ w: 600, h: 800 }];
        const pdfData = createPDF(inputSizes);
        
        // Invalid width '0' -> would cause Infinity ratio if not handled
        const config = { tablet: { width: 0, height: 1000, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);
        
        // Should fallback to default 1000 or similar, producing valid PDF (length 1 means regex found valid MediaBox)
        expect(outputSizes.length).toBe(1);
        expect(outputSizes[0].w).toBeGreaterThan(0);
    });

    test('Error Handling: Should return error for invalid/garbage PDF data', async ({ page }) => {
        await page.goto('/');
        const garbageData = new Uint8Array([0, 1, 2, 3, 4, 5]); // Not a PDF
        const config = { tablet: { width: 1000, height: 1000, epsilon: 0 } };

        // Expect the worker to catch the load failure and return an ERROR message
        await expect(processPdfInWorker(page, garbageData, config)).rejects.toThrow(/FPDF_LoadMemDocument failed/);
    });
});