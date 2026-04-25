const xlsx = require('xlsx');
try {
    const wb = xlsx.readFile('scraped_leads.xlsx');
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    console.log(`Total rows: ${data.length}`);
    if (data.length > 0) {
        console.log('First row:', JSON.stringify(data[0]));
        console.log('Last row:', JSON.stringify(data[data.length - 1]));
    }
} catch (e) {
    console.error('Error reading file:', e.message);
}
