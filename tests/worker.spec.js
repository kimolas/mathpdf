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

            let result;
            try {
                result = await resultPromise;
            } finally {
                worker.terminate();
            }
            
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
                            x: parseFloat(mbMatch[1]),
                            y: parseFloat(mbMatch[2]),
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

        // Page 2: Long Page (2980h). Target Ratio 1.0.
        // Too Tall (Ratio < 1.0). Width expands to match height (2980) to prevent scrolling.
        expect(outputSizes[1].w).toBeCloseTo(2980, -1);
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
        // Ratio: 580 / 780 = 0.74 > 0.5 (Target).
        // Too Wide -> No Correction (Fit-to-width handles it).
        const bodyPages = outputSizes.filter(p => Math.abs(p.w - 580) < 1 && Math.abs(p.h - 780) < 1);
        expect(bodyPages.length).toBe(20);

        // 3. Long Pages (5): Height 2980. Target Ratio 0.5.
        // Too Tall (Ratio 0.19 < 0.5). Width expands to 2980 * 0.5 = 1490.
        const longPages = outputSizes.filter(p => Math.abs(p.w - 1490) < 5 && Math.abs(p.h - 2980) < 5);
        expect(longPages.length).toBe(5);
    });

    test('Aspect Ratio: Should ensure pages are not too tall, but allow too wide', async ({ page }) => {
        await page.goto('/');

        const targetW = 1000;
        const targetH = 1000;
        const targetRatio = 1.0;

        // 1. Too Tall: 500x800. Ratio 0.625 < 1.0. Should expand Width.
        // 2. Too Wide: 800x500. Ratio 1.6 > 1.0. Should remain Wide.
        // 3. Small: 100x100. Ensures median height is low (480) so Page 2 is treated as "Wide" relative to base.
        const inputSizes = [{ w: 500, h: 800 }, { w: 800, h: 500 }, { w: 100, h: 100 }];
        const pdfData = createPDF(inputSizes);
        const config = { tablet: { width: targetW, height: targetH, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);

        // Page 1: Tall -> Expanded Width to match ratio
        expect(outputSizes[0].w).toBeCloseTo(outputSizes[0].h * targetRatio, 1);
        expect(Math.abs((outputSizes[0].w / outputSizes[0].h) - targetRatio)).toBeLessThan(0.001);

        // Page 2: Wide -> Remains Wide (Height not expanded)
        // Content 780x480. Base Height ~480. Width 780.
        // If we forced ratio, Height would be 780.
        // We expect Height to be close to content height (plus epsilon/base), not expanded.
        expect(outputSizes[1].w).toBeGreaterThan(outputSizes[1].h * targetRatio);
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

    test('Randomized Input: Should handle variable page sizes and content', async ({ page }) => {
        await page.goto('/');
        
        // Generate 5-20 pages
        const numPages = Math.floor(Math.random() * 15) + 5;
        const inputSizes = [];
        
        for (let i = 0; i < numPages; i++) {
            // Random dimensions between 200 and 1000
            const w = Math.floor(Math.random() * 800) + 200;
            const h = Math.floor(Math.random() * 800) + 200;
            inputSizes.push({ w, h });
        }

        const pdfData = createPDF(inputSizes);
        const config = { tablet: { width: 1000, height: 1400, epsilon: 5 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);
        
        expect(outputSizes.length).toBe(numPages);
        outputSizes.forEach(size => {
            expect(size.w).toBeGreaterThan(0);
            expect(size.h).toBeGreaterThan(0);
            expect(Number.isFinite(size.w)).toBe(true);
            expect(Number.isFinite(size.h)).toBe(true);
        });
    });

    test('Randomized Stress Test: Verify Aspect Ratios and Dimensions', async ({ page }) => {
        test.setTimeout(120000); // Increase timeout for multiple runs
        await page.goto('/');

        const numRuns = 20; 

        for (let run = 0; run < numRuns; run++) {
            const numPages = Math.floor(Math.random() * 10) + 3; // At least 3 pages for median calculation
            const inputSizes = [];
            
            // Generate random page sizes
            for (let j = 0; j < numPages; j++) {
                // Mix of shapes
                const shape = Math.random();
                let w, h;
                if (shape < 0.1) { // Long page (web capture)
                    w = 600;
                    h = 2000 + Math.random() * 1000;
                } else if (shape < 0.2) { // Wide page (slide)
                    w = 1000 + Math.random() * 500;
                    h = 600;
                } else { // Normalish
                    w = 300 + Math.random() * 500;
                    h = 300 + Math.random() * 500;
                }
                inputSizes.push({ w: Math.floor(w), h: Math.floor(h) });
            }

            const pdfData = createPDF(inputSizes);
            
            // Random target config
            const targetW = 1000 + Math.floor(Math.random() * 1000);
            const targetH = 1000 + Math.floor(Math.random() * 1000);
            const epsilon = Math.floor(Math.random() * 20);
            const config = { tablet: { width: targetW, height: targetH, epsilon: epsilon } };
            const targetRatio = targetW / targetH;

            const outputSizes = await processPdfInWorker(page, pdfData, config);
            
            // Verification Logic
            const contentSizes = inputSizes.map(s => ({ w: s.w - 20, h: s.h - 20 }));
            const heights = contentSizes.map(s => s.h).sort((a, b) => a - b);
            const mid = Math.floor(heights.length / 2);
            const typicalContentHeight = heights[mid];
            
            let effectiveEpsilon = epsilon;
            if (typicalContentHeight > 200 && epsilon > 0 && epsilon < 5) {
                effectiveEpsilon = epsilon * 72;
            }

            const basePageHeight = typicalContentHeight + (effectiveEpsilon * 2);
            const basePageWidth = basePageHeight * targetRatio;

            expect(outputSizes.length).toBe(numPages);
            
            for (let i = 0; i < numPages; i++) {
                const contentH = contentSizes[i].h;
                const contentW = contentSizes[i].w;
                
                let expectedH = Math.max(basePageHeight, contentH + (effectiveEpsilon * 2));
                let expectedW = Math.max(basePageWidth, contentW + (effectiveEpsilon * 2));
                
                // Aspect Ratio Correction
                // Only correct if too tall
                if (expectedW / expectedH < targetRatio) {
                    expectedW = expectedH * targetRatio;
                }
                
                const tolerance = 5.0; // Allow for PDFium rasterization/rounding differences

                expect(Math.abs(outputSizes[i].w - expectedW)).toBeLessThan(tolerance);
                expect(Math.abs(outputSizes[i].h - expectedH)).toBeLessThan(tolerance);
                
                const actualRatio = outputSizes[i].w / outputSizes[i].h;
                // Ratio should be >= Target Ratio (within tolerance)
                expect(actualRatio).toBeGreaterThanOrEqual(targetRatio - 0.002);
            }
        }
    });

    test('Padding (Epsilon): Should be included in dimension calculations and preserve aspect ratio', async ({ page }) => {
        await page.goto('/');

        // 1. Standard Page: 500x500 content. Epsilon 50.
        // 2. Wide Page: 800x500 content. Epsilon 50.
        const inputSizes = [{ w: 520, h: 520 }, { w: 820, h: 520 }];
        const pdfData = createPDF(inputSizes);

        // Target: 1:1 Ratio
        const config = { tablet: { width: 1000, height: 1000, epsilon: 50 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);

        // Page 1: Content 500x500.
        // Base Height = 500 + (50*2) = 600.
        // Base Width = 600 * 1.0 = 600.
        expect(Math.abs(outputSizes[0].w - 600)).toBeLessThan(2.5);
        expect(Math.abs(outputSizes[0].h - 600)).toBeLessThan(2.5);

        // Page 2: Content 800x500.
        // Width = 800 + 100 = 900.
        // Height (initial) = 600.
        // Ratio 900/600 = 1.5 > 1.0.
        // New Logic: Allow wide pages (Fit-to-width). Height remains 600.
        expect(Math.abs(outputSizes[1].w - 900)).toBeLessThan(2.5);
        expect(Math.abs(outputSizes[1].h - 600)).toBeLessThan(2.5);
    });

    test('Zero Vertical Padding: Should still provide horizontal safety margin if space allows', async ({ page }) => {
        await page.goto('/');

        // Input: 500x800. Content is drawn at x=10 (margin=10 in createPDF).
        // Target: 1000x1000 (Ratio 1.0). Epsilon 0.
        const inputSizes = [{ w: 500, h: 800 }];
        const pdfData = createPDF(inputSizes);
        const config = { tablet: { width: 1000, height: 1000, epsilon: 0 } };

        const outputSizes = await processPdfInWorker(page, pdfData, config);

        // Calculations:
        // Content Height = 800 - 20 = 780.
        // Base Height = 780 + 0 = 780.
        // Base Width = 780 * 1.0 = 780.
        // Content Width = 500 - 20 = 480.
        // Excess Width = 780 - 480 = 300.
        // Bezel Padding = Max(0, 300 * 0.05) = 15.
        // Original L = 10. New L = 10 - 15 = -5.
        expect(Math.abs(outputSizes[0].x - (-5))).toBeLessThan(2.5);
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