import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { EmailFinder } from './email-finder';

interface PagesJaunesData {
  'Company Name': string;
  'Service Category': string;
  'Location': string;
  'Phone Number': string;
  'Website': string;
  'Emails': string;
}

interface Checkpoint {
  currentIndex: number;
}

const checkpointPath = path.join(__dirname, 'track_pagesjaunes.json');
const outputPath = path.join(__dirname, 'scrapped_pagesjaunes_data.xlsx');

class PagesJaunesScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private emailFinder: EmailFinder;

  constructor() {
    this.emailFinder = new EmailFinder();
  }

  async init() {
    this.browser = await chromium.launch({
      executablePath: config.chromePath,
      headless: config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
      ]
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      proxy: config.useProxy ? config.proxy : undefined,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });

    // Stealth: Hide webdriver and mimic real browser features
    await this.context.addInitScript(() => {
      // @ts-ignore
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // @ts-ignore
      Object.defineProperty(navigator, 'plugins', { get: () => [
        { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chrome PDF Viewer" },
        { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chromium PDF Viewer" },
        { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Microsoft Edge PDF Viewer" }
      ] });
      // @ts-ignore
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      // @ts-ignore
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    // Verify Proxy IP
    if (config.useProxy) {
      try {
        const page = await this.context.newPage();
        await page.goto('https://api.ipify.org', { timeout: 15000 });
        const ip = await page.innerText('body');
        console.log(`\x1b[34m[PROXY]\x1b[0m External IP: \x1b[32m${ip}\x1b[0m`);
        await page.close();
      } catch (e: any) {
        console.warn(`\x1b[31m[PROXY WARN]\x1b[0m Could not verify IP: ${e.message}`);
      }
    }
  }

  private async randomDelay(min: number, max: number) {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  async scrape(professions: string[], startIndex: number) {
    const allScrapedData: PagesJaunesData[] = this.loadExistingData();
    const seenKeys = new Set(allScrapedData.map(d => `${d['Company Name']}|${d['Phone Number']}`.toLowerCase()));
    
    console.log(`\n\x1b[36m>>> Starting scrap session for ${professions.length - startIndex} professions\x1b[0m`);

    for (let i = startIndex; i < professions.length; i++) {
      const profession = professions[i];
      console.log(`\n\x1b[33m[${i + 1}/${professions.length}] Current Profession: ${profession}\x1b[0m`);
      
      try {
        await this.scrapeProfession(profession, (data) => {
          const key = `${data['Company Name']}|${data['Phone Number']}`.toLowerCase();
          if (!seenKeys.has(key)) {
            allScrapedData.push(data);
            seenKeys.add(key);
            this.saveToExcel(allScrapedData);
            console.log(`   \x1b[32m[SAVED]\x1b[0m ${data['Company Name']} | ${data['Phone Number']}`);
          } else {
            console.log(`   \x1b[90m[SKIP]\x1b[0m ${data['Company Name']} (already exists)`);
          }
        });

        // Save checkpoint after each profession
        this.saveCheckpoint(i + 1);
        console.log(`\x1b[34m>>> Checkpoint saved: Index ${i + 1}\x1b[0m`);
        
        // Random pause between professions to look human
        await this.randomDelay(3000, 7000);
      } catch (err) {
        console.error(`\x1b[31mError processing ${profession}:\x1b[0m`, err);
      }
    }
    console.log(`\n\x1b[36m>>> Scrap session completed! Total records: ${allScrapedData.length}\x1b[0m`);
  }

  private async scrapeProfession(profession: string, onData: (data: PagesJaunesData) => void) {
    const page = await this.context!.newPage();
    const searchUrl = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(profession)}&ou=Paris+%2875000%29&univers=pagesjaunes&idOu=`;
    
    try {
      console.log(`   Navigating to search results...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.randomDelay(3000, 6000);
      
      const title = await page.title();
      if (title.includes('Denied') || title.includes('Security') || title.includes('Vérification')) {
        console.error(`   \x1b[31m[BLOCKED]\x1b[0m Site returned a security challenge: "${title}"`);
        await page.screenshot({ path: 'blocked_search.png' });
        return;
      }

      // Mimic human mouse move
      await page.mouse.move(Math.random() * 500, Math.random() * 500);

      // Handle cookie consent
      try {
        const acceptBtn = await page.waitForSelector('#sp-cc-accept', { timeout: 4000 });
        if (acceptBtn) {
          await acceptBtn.click();
          console.log(`   Cookies accepted.`);
          await this.randomDelay(1000, 2000);
        }
      } catch (e) {}

      let hasNextPage = true;
      let pageNum = 1;

      while (hasNextPage) {
        console.log(`   Scanning Page ${pageNum}...`);
        await this.randomDelay(2000, 4000); // Wait for results to settle

        // Wait for results list or "no results" indicator
        const res = await page.waitForSelector('ul.bi-list, .no-results, .zone-no-results, #captcha', { timeout: 20000 }).catch(() => null);
        
        if (!res) {
          console.error(`   \x1b[31m[ERROR]\x1b[0m Page structure not recognized. Might be a CAPTCHA.`);
          await page.screenshot({ path: `error_page_${pageNum}.png` });
          break;
        }

        // Check if no results
        const noResults = await page.$('.no-results, .zone-no-results');
        if (noResults) {
          console.log(`   No results found for this profession.`);
          break;
        }

        const detailLinks = await page.$$eval('ul.bi-list a.pj-link', (links: any[]) => 
          links.map(l => ({ href: l.href, text: l.textContent?.trim() || '' }))
               .filter(l => {
                 // Real pros always have a numeric ID at the end of the /pros/ URL
                 const hasNumericId = /\/\d{8}/.test(l.href); 
                 const isPros = l.href && l.href.includes('/pros/') && !l.href.includes('#');
                 const isCategory = l.text.includes(' à ') || l.text.includes('(') || l.text.includes('Professionnels') || l.text.length > 60;
                 return isPros && hasNumericId && !isCategory;
               })
               .map(l => l.href)
        );
        
        // Remove duplicates and ensure we only have actual pros
        const uniqueLinks = [...new Set(detailLinks)].filter(link => link.includes('/pros/'));
        console.log(`   Found ${uniqueLinks.length} unique pros on page ${pageNum}.`);

        for (const link of uniqueLinks) {
          const data = await this.scrapeDetail(link);
          if (data) {
            onData(data);
          }
          await this.randomDelay(1000, 2500); // Wait between each pro
        }

        // Check for next page
        const nextButton = await page.$('a#pagination-next');
        if (nextButton) {
          console.log(`   \x1b[35mNavigating to page ${pageNum + 1}...\x1b[0m`);
          // Smooth scroll to bottom before clicking next
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          await this.randomDelay(500, 1500);
          await nextButton.click();
          await page.waitForLoadState('domcontentloaded');
          await this.randomDelay(2000, 4000);
          pageNum++;
        } else {
          hasNextPage = false;
          console.log(`   Reached end of results for this profession.`);
        }
      }
    } catch (err) {
      console.error(`   Error in scrapeProfession:`, err);
    } finally {
      await page.close();
    }
  }

  private async scrapeDetail(url: string): Promise<PagesJaunesData | null> {
    const page = await this.context!.newPage();
    const slug = url.split('/').pop() || 'pro';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.randomDelay(2000, 4000); // Critical: wait for redirects/security to finish
      
      // 1. Reveal phone number
      try {
        const revealBtn = await page.$('a[title*="Afficher le n"], a.hidden-phone, .teaser-item [class*="phone"]');
        if (revealBtn) {
          await revealBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch (e) {}

      const details = await page.evaluate(() => {
        const getText = (sel: string) => document.querySelector(sel)?.textContent?.trim() || '';
        const teaserItems = Array.from(document.querySelectorAll('.teaser-item'));
        
        let phone = '';
        let website = '';
        let address = '';
        
        teaserItems.forEach(item => {
          const text = item.textContent?.trim() || '';
          const title = item.getAttribute('title') || '';
          const html = item.innerHTML;
          
          if (html.includes('icon-phone') || title.toLowerCase().includes('téléphone') || item.classList.contains('hidden-phone')) {
            if (text.match(/\d/)) phone = text.replace(/Numéro de Téléphone|Tél|:|[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
          } 
          else if (title.toLowerCase().includes('site internet') || text.match(/^www\./) || (text.includes('.') && !text.includes(' ') && text.length > 5)) {
            if (!website) website = text;
          } 
          else if (item.classList.contains('address') || item.classList.contains('streetAddress') || html.includes('icon-location')) {
            if (!address) address = text;
          }
        });

        if (!address) address = getText('.address-container') || getText('.address');
        if (!phone) {
          const rawPhone = getText('.pj-lb-tel strong') || getText('.phone-number') || getText('span.num');
          phone = rawPhone.replace(/Numéro de Téléphone|Tél|:|[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (!website) {
          const webLink = document.querySelector('a.SITE_EXTERNE, a[title*="Site internet"]');
          if (webLink) {
             const href = (webLink as HTMLAnchorElement).href;
             website = (href && href !== '#') ? href : webLink.textContent?.trim() || '';
          }
        }

        return {
          name: getText('h1'),
          category: getText('.activite') || getText('.profession'),
          location: address.replace(/Localisation|Y aller|Voir le plan/g, '').trim(),
          phone: phone,
          website: website
        };
      });

      if (!details.name || details.name.includes('PagesJaunes') || details.name.length < 2) {
        return null;
      }

      let finalWebsite = details.website;
      if (finalWebsite && !finalWebsite.startsWith('http')) {
        finalWebsite = 'https://' + finalWebsite;
      }
      
      if (finalWebsite.includes('redir')) {
        try {
          const urlObj = new URL(finalWebsite);
          const paramUrl = urlObj.searchParams.get('url');
          if (paramUrl) finalWebsite = paramUrl;
        } catch (e) {}
      }

      if (finalWebsite.includes('pagesjaunes.fr') && !finalWebsite.includes('redir')) {
        finalWebsite = '';
      }

      return {
        'Company Name': details.name,
        'Service Category': details.category,
        'Location': details.location.replace(/\s+/g, ' '),
        'Phone Number': details.phone,
        'Website': finalWebsite,
        'Emails': ''
      };
    } catch (err: any) {
      console.log(`      \x1b[31m[FAILED]\x1b[0m ${slug}: ${err.message}`);
      return null;
    } finally {
      await page.close();
    }
  }

  private loadExistingData(): PagesJaunesData[] {
    if (fs.existsSync(outputPath)) {
      try {
        const wb = xlsx.readFile(outputPath);
        return xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  private saveToExcel(data: PagesJaunesData[]) {
    try {
      const ws = xlsx.utils.json_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'PagesJaunes Leads');
      xlsx.writeFile(wb, outputPath);
    } catch (e: any) {
      if (e.code === 'EBUSY') {
        console.error(`   \x1b[31m[LOCK ERROR]\x1b[0m Please CLOSE '${path.basename(outputPath)}' so the script can save data!`);
      } else {
        console.error(`   \x1b[31m[SAVE ERROR]\x1b[0m`, e.message);
      }
    }
  }

  private saveCheckpoint(index: number) {
    fs.writeFileSync(checkpointPath, JSON.stringify({ currentIndex: index }, null, 2));
  }
}

async function main() {
  const scraper = new PagesJaunesScraper();
  
  // Check command line arguments for proxy override BEFORE init
  const args = process.argv.slice(2);
  if (args.includes('--no-proxy')) {
    config.useProxy = false;
  } else if (args.includes('--proxy')) {
    config.useProxy = true;
  }

  await scraper.init();
  
  if (config.useProxy) {
    console.log('\x1b[33m[CONFIG]\x1b[0m Using Proxy: \x1b[32mENABLED\x1b[0m');
  } else {
    console.log('\x1b[33m[CONFIG]\x1b[0m Using Proxy: \x1b[31mDISABLED\x1b[0m');
  }

  const professions = config.professions;
  let startIndex = 0;
  if (fs.existsSync(checkpointPath)) {
    try {
      const checkpoint: Checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      startIndex = checkpoint.currentIndex;
      console.log(`\x1b[34m[INFO]\x1b[0m Resuming from profession index ${startIndex}`);
    } catch (e) {}
  }

  try {
    await scraper.scrape(professions, startIndex);
  } finally {
    await scraper.close();
  }
}

main().catch(console.error);
