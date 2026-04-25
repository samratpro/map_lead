import { MapsScraper } from './maps-scraper';
import { EmailFinder } from './email-finder';
import * as xlsx from 'xlsx';

async function test() {
  console.log('--- Starting Test Run ---');
  const mapsScraper = new MapsScraper();
  const emailFinder = new EmailFinder();
  
  await mapsScraper.init();
  
  try {
    const results = await mapsScraper.searchCategory('wedding venues', 'Paris');
    
    if (results.length > 0) {
      const sample = results[0];
      console.log('Sample Result:', sample);
      
      if (sample.website) {
        console.log('Testing Email Discovery for:', sample.website);
        const emails = await emailFinder.findEmails(sample.website);
        console.log('Emails found:', emails);
      }
    } else {
      console.log('No results found in search.');
    }
    
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await mapsScraper.close();
    console.log('--- Test Run Finished ---');
  }
}

test();
