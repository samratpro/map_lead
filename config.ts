import * as fs from 'fs';
import * as path from 'path';

export interface ScraperConfig {
  professions: string[];
  cities: string[];
  outputFile: string;
  headless: boolean;
  chromePath: string;
  useProxy: boolean;
  proxy: {
    server: string;
    username?: string;
    password?: string;
  };
}

function loadProfessions(): string[] {
  const filePath = path.join(__dirname, 'target_profession.txt');
  if (!fs.existsSync(filePath)) {
    console.warn('target_profession.txt not found. Using empty list.');
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export const config: ScraperConfig = {
  professions: loadProfessions(),
  cities: [
    'Paris'
  ],
  outputFile: 'scraped_leads.xlsx',
  headless: false,
  chromePath: path.join(__dirname, 'browser', 'chrome', 'chrome.exe'),
  useProxy: true,
  proxy: {
    server: 'http://gw.dataimpulse.com:823',
    username: '844868024ff3b5490035__cr.us',
    password: 'f12a53b339a5ea3c'
  }
};
