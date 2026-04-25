# Google Maps Leads Scraper

A powerful automation tool to extract business leads from Google Maps and discover email addresses from their websites.

## Features
- **Targeted Search**: Searches for specific professions across multiple cities in France.
- **Data Extracted**: Name, Category, Phone, Website, Address, City.
- **Email Discovery**: Automatically visits business websites and contact pages to find email addresses.
- **Excel Export**: Saves all data to `scraped_leads.xlsx` in real-time.

## Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [TypeScript](https://www.typescript.org/)
- Google Chrome (already included in the `browser` folder)

## Installation

1. Install dependencies:
   ```powershell
   npm install
   ```

2. (Optional) If you get permission errors on Windows, use:
   ```powershell
   npm.cmd install
   ```

## Configuration

- **Professions**: Edit `target_profession.txt` and add one profession per line.
- **Cities**: Open `config.ts` and modify the `cities` array to target different areas.
- **Headless Mode**: Change `headless: true` in `config.ts` to run the browser in the background.

## How to Run

To start the map scraping process:
```powershell
npx.cmd ts-node index.ts
```

To start the pagesjaunes scraping process:
```powershell
npx ts-node scrap_pagesjaunes.ts --proxy
npx ts-node scrap_pagesjaunes.ts --no-proxy
```



To run a quick test (limited search):
```powershell
npx.cmd ts-node test-run.ts
```

## Output
The results are saved to `scraped_leads.xlsx` in the root directory. The file is updated after every successful city/profession job.

## Troubleshooting
- **Chrome Path**: Ensure the `browser` folder contains the correct Chrome executable as defined in `config.ts`.
- **Rate Limiting**: If Google Maps shows a captcha, the script might slow down. It includes random delays to mitigate this.
