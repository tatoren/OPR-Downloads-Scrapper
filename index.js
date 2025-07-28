// index.js
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https'); // For direct PDF downloads

// Configuration for the different game systems to download
const GAME_SYSTEMS = [
    { id: 2, name: 'Grimdark Future' },
    { id: 3, name: 'Grimdark Future Firefight' },
    { id: 4, name: 'Age of Fantasy' },
    { id: 5, name: 'Age of Fantasy Skirmish' },
    { id: 6, name: 'Age of Fantasy Regiments' },
    { isFtl: true, name: 'Warfleets FTL' },
];

// Base URLs
const SCRAPE_URL_BASE = 'https://army-forge.onepagerules.com';
const PREVIEW_URL_BASE = 'https://army-forge-studio.onepagerules.com';
const RESOURCES_URL = 'https://www.onepagerules.com/resources';

/**
 * A utility function to introduce a delay.
 * @param {number} ms - The delay time in milliseconds.
 */
const delay = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Sanitizes a filename by removing or replacing invalid characters.
 * @param {string} filename - The original filename.
 * @returns {string} The sanitized filename.
 */
const sanitizeFilename = (filename) => {
    return filename.replace(/[\/\\?%*:|"<>]/g, '-').trim();
};

/**
 * Downloads a file from a URL and saves it to a local path.
 * @param {string} url - The URL of the file to download.
 * @param {string} dest - The destination path to save the file.
 */
const downloadFile = (url, dest) => new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
        if (response.statusCode !== 200) {
            reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
            return;
        }
        response.pipe(file);
        file.on('finish', () => {
            file.close(resolve);
        });
    }).on('error', err => {
        fs.unlink(dest, () => reject(err));
    });
});


/**
 * Scrapes and downloads core rulebooks and resources.
 * @param {object} page - The Puppeteer page object.
 * @param {string} dateString - The current date string for folder naming.
 */
async function downloadCoreRulebooks(page, dateString) {
    console.log(`\n--- Processing Core Rulebooks & Resources from ${RESOURCES_URL} ---`);
    await page.goto(RESOURCES_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    const resourceListSelector = '.resourses__col-list';
    await page.waitForSelector(resourceListSelector, { timeout: 30000 });

    let pageNum = 1;
    while (true) {
        console.log(`Scraping resources page ${pageNum}...`);
        
        const resourceItems = await page.$$('.w-dyn-item');
        console.log(`Found ${resourceItems.length} resource items on this page.`);

        for (const item of resourceItems) {
            try {
                const pdfName = await item.$eval('._1rem-text', el => el.textContent.trim());
                const downloadUrl = await item.$eval('a.w-button', el => el.href);
                const gameNames = await item.$$eval('div[fs-cmsfilter-field="game"]', els => els.map(el => el.textContent.trim()));

                if (!downloadUrl) continue;

                for (const gameName of gameNames) {
                    const sanitizedGameName = sanitizeFilename(gameName);
                    const outputDir = path.join(__dirname, `${sanitizedGameName} - ${dateString}`);

                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir, { recursive: true });
                        console.log(`Created directory for core rulebooks: ${outputDir}`);
                    }

                    const sanitizedPdfName = sanitizeFilename(pdfName);
                    const pdfPath = path.join(outputDir, `${sanitizedPdfName}.pdf`);

                    if (fs.existsSync(pdfPath)) {
                        console.log(`   -> Skipping "${pdfName}" for "${gameName}" (already exists).`);
                        continue;
                    }

                    console.log(`   -> Downloading "${pdfName}" for "${gameName}"...`);
                    await downloadFile(downloadUrl, pdfPath);
                    console.log(`   -> Saved: ${pdfPath}`);
                }
            } catch (error) {
                // This might happen if an item is not a downloadable resource, which is fine.
            }
        }

        const nextButtonSelector = 'a.w-pagination-next';
        const nextButton = await page.$(nextButtonSelector);
        
        const isVisible = await page.evaluate(selector => {
            const btn = document.querySelector(selector);
            return btn && window.getComputedStyle(btn).display !== 'none';
        }, nextButtonSelector);

        if (nextButton && isVisible) {
            pageNum++;
            console.log('Navigating to next page...');
            
            // ** FIX: Wait for the content of the list to change, not the pagination button **
            // Get the text of the first item in the current list before clicking
            const firstItemSelector = '.w-dyn-item:first-child ._1rem-text';
            const firstItemTextBeforeClick = await page.$eval(firstItemSelector, el => el.textContent.trim()).catch(() => null);
            
            // Click the button to trigger the content load
            await nextButton.click();
            
            // Wait for the first item's text to be different, which confirms the new content is loaded
            await page.waitForFunction(
                (selector, oldText) => {
                    const firstItem = document.querySelector(selector);
                    // The condition is true if the first item exists and its text is different from the old text
                    return firstItem && firstItem.textContent.trim() !== oldText;
                },
                { timeout: 30000 },
                firstItemSelector,
                firstItemTextBeforeClick
            );

            await delay(1000); // Small delay for content to settle after load
        } else {
            console.log('No more pages to process.');
            break; // Exit the loop
        }
    }
}


/**
 * The main function to run the scraper.
 */
(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    await downloadCoreRulebooks(page, dateString);

    for (const gameSystem of GAME_SYSTEMS) {
        let armySelectionUrl;
        let idParam;
        let previewGameId;

        if (gameSystem.isFtl) {
            armySelectionUrl = `${SCRAPE_URL_BASE}/ftl/fleetSelection`;
            idParam = 'fleetId';
            previewGameId = 6;
        } else {
            armySelectionUrl = `${SCRAPE_URL_BASE}/armyBookSelection?gameSystem=${gameSystem.id}`;
            idParam = 'armyId';
            previewGameId = gameSystem.id;
        }

        const sanitizedGameName = sanitizeFilename(gameSystem.name);
        const outputDir = path.join(__dirname, `${sanitizedGameName} - ${dateString}`);
        const armiesToDownload = [];

        console.log(`\n--- Processing Army Books for: ${gameSystem.name} ---`);
        
        try {
            await page.goto(armySelectionUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            const cookieButtonSelector = '#onetrust-accept-btn-handler';
            try {
                await page.waitForSelector(cookieButtonSelector, { timeout: 5000 });
                console.log('Cookie banner found. Clicking "Accept"...');
                await page.click(cookieButtonSelector);
                await delay(1500);
            } catch (e) {
                console.log('Cookie banner not found or already accepted.');
            }

            const tileSelector = '.army-book-tile';
            await page.waitForSelector(tileSelector, { timeout: 30000 });
            
            const tileCount = await page.$$eval(tileSelector, tiles => tiles.length);
            console.log(`Found ${tileCount} army book tiles. Checking each for sub-factions...`);

            for (let i = 0; i < tileCount; i++) {
                await page.waitForSelector(tileSelector, { timeout: 30000 });
                
                const tileName = await page.evaluate((selector, index) => {
                    const tile = document.querySelectorAll(selector)[index];
                    return tile ? tile.querySelector('p').textContent.trim() : 'Unknown Tile';
                }, tileSelector, i);
                console.log(`Processing tile ${i + 1}/${tileCount}: "${tileName}"`);
                
                await page.evaluate((selector, index) => {
                    const tile = document.querySelectorAll(selector)[index];
                    if (tile) tile.click();
                }, tileSelector, i);

                const menuSelector = '.MuiMenu-list';
                
                try {
                    await page.waitForSelector(menuSelector, { timeout: 2000 });
                    const menuHandle = await page.$(menuSelector);

                    if (menuHandle) {
                        console.log('   -> Sub-faction menu found. Scraping menu items...');
                        const subFactions = await page.evaluate((selector, idParam) => {
                            const links = Array.from(document.querySelectorAll(`${selector} a`));
                            return links.map(link => {
                                const href = link.getAttribute('href');
                                if (!href) return null;
                                const idMatch = href.match(new RegExp(`${idParam}=([a-zA-Z0-9-_]+)`));
                                return { name: link.textContent.trim(), id: idMatch ? idMatch[1] : null };
                            }).filter(Boolean);
                        }, menuSelector, idParam);
                        
                        armiesToDownload.push(...subFactions);
                        console.log(`      -> Found ${subFactions.length} sub-factions.`);
                        await page.keyboard.press('Escape');
                        await delay(500);
                    }
                } catch (e) {
                    console.log('   -> No sub-faction menu. Page navigated, extracting info from URL.');
                    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
                    const currentUrl = page.url();
                    const urlParams = new URL(currentUrl).searchParams;
                    const armyId = urlParams.get(idParam);
                    const armyName = urlParams.get('armyName') || urlParams.get('fleetName');

                    if (armyId && armyName) {
                        armiesToDownload.push({ name: armyName, id: armyId });
                        console.log(`      -> Found single army: ${armyName}`);
                    }
                    
                    console.log('   -> Navigating back to army selection page...');
                    await page.goBack({ waitUntil: 'networkidle2', timeout: 60000 });
                }
            }
            
            console.log(`\nDiscovery complete. Total army books to download for ${gameSystem.name}: ${armiesToDownload.length}`);
            if (armiesToDownload.length === 0) continue;

            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
                console.log(`Created directory: ${outputDir}`);
            }

            for (let i = 0; i < armiesToDownload.length; i++) {
                const army = armiesToDownload[i];
                const sanitizedArmyName = sanitizeFilename(army.name);
                const pdfPath = path.join(outputDir, `${sanitizedArmyName} - ${dateString}.pdf`);

                if (fs.existsSync(pdfPath)) {
                    console.log(`(${i + 1}/${armiesToDownload.length}) Skipping "${army.name}" (already exists).`);
                    continue;
                }

                console.log(`(${i + 1}/${armiesToDownload.length}) Navigating to preview for "${army.name}"...`);
                const previewUrl = `${PREVIEW_URL_BASE}/army-books/view/${army.id}~${previewGameId}/preview`;
                
                await page.goto(previewUrl, { waitUntil: 'networkidle0', timeout: 60000 });
                
                await delay(2000); 

                console.log(`   -> Generating PDF for "${army.name}"...`);
                await page.pdf({
                    path: pdfPath,
                    format: 'A4',
                    printBackground: true,
                    margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
                });

                console.log(`   -> Saved: ${pdfPath}`);
            }

        } catch (error) {
            console.error(`An error occurred while processing army books for ${gameSystem.name}:`, error);
            continue; 
        }
    }

    console.log('\nClosing browser...');
    await browser.close();
    console.log('Process finished.');
})();
