import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { MapsScraper, BusinessData } from './maps-scraper';
import { EmailFinder } from './email-finder';

interface Checkpoint {
  professionIndex: number;
  cityIndex: number;
}

const checkpointPath = path.join(__dirname, 'checkpoint.json');

async function main() {
  console.log('--- Starting Comprehensive Google Maps Scraper ---');
  console.log(`Targeting ${config.professions.length} professions across ${config.cities.length} cities.`);

  const mapsScraper = new MapsScraper();
  const emailFinder = new EmailFinder();
  await mapsScraper.init();

  const allData: BusinessData[] = [];
  const seenKeys = new Set<string>();

  // Load existing data if file exists to resume or avoid duplicates
  if (fs.existsSync(config.outputFile)) {
    try {
      const wb = xlsx.readFile(config.outputFile);
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        throw new Error('No sheets found in the Excel file.');
      }
      const existing: any[] = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
      existing.forEach(item => {
        const key = `${item.Name}|${item.Phone}`.toLowerCase();
        seenKeys.add(key);
        
        // Map back to our internal structure for memory
        allData.push({
          name: item.Name,
          category: item['Business Activity'],
          phone: item.Phone,
          website: item.Website,
          emails: item['Email Address'] ? item['Email Address'].split(', ').map((e: string) => e.trim()) : [],
          city: item.City,
          address: item.Address,
        });
      });
      console.log(`Successfully loaded ${seenKeys.size} existing records from ${config.outputFile}`);
    } catch (e) {
      console.error('CRITICAL ERROR: Could not read existing Excel file. It might be open in another program or corrupted.');
      console.error('To prevent data loss, the script will stop now. Please close Excel and try again.');
      console.error(`Error details: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  // Load checkpoint
  let checkpoint: Checkpoint = { professionIndex: 0, cityIndex: 0 };
  if (fs.existsSync(checkpointPath)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      console.log(`Resuming from checkpoint: Profession ${checkpoint.professionIndex}, City ${checkpoint.cityIndex}`);
    } catch (e) {
      console.warn('Could not load checkpoint. Starting from beginning.');
    }
  }

  try {
    for (let pIdx = checkpoint.professionIndex; pIdx < config.professions.length; pIdx++) {
      const profession = config.professions[pIdx];
      
      // Start from cityIndex if we are in the checkpointed profession, else start from 0
      const startCityIdx = (pIdx === checkpoint.professionIndex) ? checkpoint.cityIndex : 0;
      
      for (let cIdx = startCityIdx; cIdx < config.cities.length; cIdx++) {
        const city = config.cities[cIdx];
        console.log(`\nStarting Job: "${profession}" in ${city} (Prof ${pIdx+1}/${config.professions.length}, City ${cIdx+1}/${config.cities.length})`);
        
        await mapsScraper.searchCategory(profession, city, async (business) => {
          const key = `${business.name}|${business.phone}`.toLowerCase();
          if (seenKeys.has(key)) return;

          // Find email if website exists 
          if (business.website) {
            console.log(`   Searching email for: ${business.website}`);
            const webEmails = await emailFinder.findEmails(business.website);
            if (webEmails && webEmails.length > 0) {
              console.log(`   Found ${webEmails.length} emails from website`);
              // Combine and unique
              const combined = Array.from(new Set([...(business.emails || []), ...webEmails]));
              business.emails = combined;
            }
          }
          
          if (business.emails && business.emails.length > 0) {
            console.log(`   Final emails: ${business.emails.join(', ')}`);
          }

          allData.push(business);
          seenKeys.add(key);

          // Save after EACH business
          saveToExcel(allData);
        });

        // Save checkpoint after each city/profession combo finishes
        checkpoint = { professionIndex: pIdx, cityIndex: cIdx + 1 };
        // If we finished all cities for this profession, move to next profession
        if (checkpoint.cityIndex >= config.cities.length) {
          checkpoint = { professionIndex: pIdx + 1, cityIndex: 0 };
        }
        fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
      }
    }
  } catch (err) {
    console.error('Fatal error in main loop:', err);
  } finally {
    await mapsScraper.close();
    console.log('--- Scraping Job Finished ---');
  }
}

function saveToExcel(data: BusinessData[]) {
  if (data.length === 0) return;

  // Simple backup mechanism
  try {
    if (fs.existsSync(config.outputFile)) {
      fs.copyFileSync(config.outputFile, `${config.outputFile}.bak`);
    }
  } catch (e) {
    console.warn('Warning: Could not create backup file.');
  }

  const rowData = data.map(b => ({
    'Name': b.name,
    'Business Activity': b.category,
    'Phone': b.phone,
    'Website': b.website,
    'Email Address': b.emails ? b.emails.join(', ') : '',
    'City': b.city,
    'Address': b.address,
  }));

  const ws = xlsx.utils.json_to_sheet(rowData);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Leads');
  
  xlsx.writeFile(wb, config.outputFile);
}

main().catch(console.error);
