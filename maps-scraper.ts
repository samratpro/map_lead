import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { config } from './config';

export interface BusinessData {
  name: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  category: string;
  emails?: string[];
}

export class MapsScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async init() {
    this.browser = await chromium.launch({
      executablePath: config.chromePath,
      headless: config.headless,
    });
    this.context = await this.browser.newContext({
      locale: 'fr-FR',
      viewport: { width: 1280, height: 800 },
    });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  async searchCategory(searchTerm: string, city: string, onBusinessScraped?: (data: BusinessData) => Promise<void>): Promise<BusinessData[]> {
    const page = await this.context!.newPage();
    const results: BusinessData[] = [];
    const query = `${searchTerm} in ${city}, France`;
    const searchUrl = `https://www.google.fr/maps/search/${encodeURIComponent(query)}?hl=fr`;

    console.log(`Searching for: ${query}`);
    
    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
      
      // Accept cookies if prompt appears
      try {
        const acceptBtn = await page.waitForSelector('button[aria-label="Tout accepter"]', { timeout: 5000 });
        if (acceptBtn) await acceptBtn.click();
      } catch (e) { /* ignore */ }

      // Scroll the sidebar to load up to 50 results
      await this.scrollSidebar(page, 50);

      // Get result items (up to 50)
      const itemSelectors = 'a.hfpxzc';
      const allItems = await page.$$(itemSelectors);
      const items = allItems.slice(0, 50);
      console.log(`Found ${allItems.length} results, processing top ${items.length} for ${query}`);

      for (let i = 0; i < items.length; i++) {
        // Refresh items list to avoid stale handles and scroll the item into view
        const currentItems = await page.$$(itemSelectors);
        const item = currentItems[i];
        if (!item) continue;

        try {
          await item.scrollIntoViewIfNeeded();
          await item.click();
          // Extreme speed: reduced to 400ms
          await page.waitForTimeout(400);

          const data = await this.extractDetails(page, city);
          if (data.name) {
            console.log(`   [${i + 1}/${items.length}] Scraped: ${data.name} | Phone: ${data.phone || 'N/A'} | Address: ${data.address || 'N/A'}`);
            results.push(data);
            
            if (onBusinessScraped) {
              await onBusinessScraped(data);
            }
          }
        } catch (err) {
          console.error(`   Error scraping item ${i + 1}:`, (err as Error).message);
        }
      }

    } catch (err) {
      console.error(`Error searching ${query}:`, (err as Error).message);
    } finally {
      await page.close();
    }

    return results;
  }

  private async scrollSidebar(page: Page, limit: number) {
    const sidebarSelector = 'div[role="feed"]';
    const itemSelectors = 'a.hfpxzc';
    await page.waitForSelector(sidebarSelector, { timeout: 10000 }).catch(() => null);
    
    let lastHeight = 0;
    let retries = 0;
    
    while (retries < 3) {
      // Check if we already have enough items
      const itemsCount = await page.$$eval(itemSelectors, items => items.length);
      if (itemsCount >= limit) break;

      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop = el.scrollHeight;
      }, sidebarSelector);
      
      await page.waitForTimeout(500); // Reduced to 500ms
      
      const currentHeight = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.scrollHeight : 0;
      }, sidebarSelector);

      if (currentHeight === lastHeight) {
        // Check if the "end of list" message is visible
        const endOfList = await page.evaluate(() => {
          return document.body.innerText.includes("Vous avez atteint la fin de la liste") || 
                 document.body.innerText.includes("Plus de résultats");
        });
        if (endOfList) break;
        retries++;
      } else {
        lastHeight = currentHeight;
        retries = 0;
      }
    }
  }

  private async extractDetails(page: Page, city: string): Promise<BusinessData> {
    const data: BusinessData = {
      name: '',
      phone: '',
      website: '',
      address: '',
      city: city,
      category: '',
    };

    try {
      // Use evaluate for faster extraction in one go
      const details = await page.evaluate(() => {
        const getText = (sel: string) => document.querySelector(sel)?.textContent?.trim() || "";
        const getAttr = (sel: string, attr: string) => document.querySelector(sel)?.getAttribute(attr) || "";

        // Fast extraction of what's visible
        const results = {
          name: getText('h1.DUwDvf'),
          category: getText('button.DkEaL'),
          address: getText('button[data-item-id="address"]'),
          website: getAttr('a[data-item-id="authority"]', 'href'),
          phone: getText('button[data-item-id^="phone:tel:"]') || getAttr('button[data-item-id^="phone:tel:"]', 'data-item-id')?.replace('phone:tel:', ''),
          emails: [] as string[]
        };

        // On-page email extraction (fastest source)
        try {
          const bodyText = document.body.innerText;
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const matches = bodyText.match(emailRegex);
          if (matches) {
            results.emails = Array.from(new Set(matches.map(m => m.toLowerCase())));
          }
        } catch (e) { /* ignore */ }

        return results;
      });

      data.name = details.name;
      data.category = details.category;
      // Clean address: remove leading icon characters (like )
      data.address = details.address.replace(/^[^\w\d]+/, '').trim();
      data.website = details.website;
      // Clean phone: remove leading icon characters (like )
      data.phone = details.phone.replace(/^[^\d+]+/, '').trim();
      data.emails = details.emails;

    } catch (err) {
       // Extraction failed for some fields
    }

    return data;
  }
}
