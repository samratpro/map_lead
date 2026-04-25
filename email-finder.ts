import axios from 'axios';
import * as cheerio from 'cheerio';

export class EmailFinder {
  private visitedUrls: Set<string> = new Set();

  /**
   * Attempts to find email addresses on a given website.
   * @param baseUrl The website URL to start searching from.
   * @returns A promise that resolves to an array of unique email addresses.
   */
  async findEmails(baseUrl: string): Promise<string[]> {
    if (!baseUrl || !baseUrl.startsWith('http')) return [];
    
    this.visitedUrls.clear();
    const emails: Set<string> = new Set();

    try {
      // 1. Check Homepage
      await this.scrapePage(baseUrl, emails);

      // 2. If no emails found, try common contact sub-pages
      if (emails.size === 0) {
        const homepageHtml = await this.getPageHtml(baseUrl);
        if (homepageHtml) {
          const $ = cheerio.load(homepageHtml);
          const contactLinks: string[] = [];

          $('a').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
              const text = $(element).text().toLowerCase();
              if (
                text.includes('contact') || 
                text.includes('propos') || 
                text.includes('about') || 
                text.includes('mentions') ||
                href.toLowerCase().includes('contact')
              ) {
                const absoluteUrl = this.makeAbsolute(baseUrl, href);
                if (absoluteUrl) contactLinks.push(absoluteUrl);
              }
            }
          });

          // Limit to first 3 potential contact pages to avoid deep crawling
          for (const url of contactLinks.slice(0, 3)) {
            await this.scrapePage(url, emails);
          }
        }
      }
    } catch (error) {
      console.warn(`Error finding emails for ${baseUrl}:`, (error as Error).message);
    }

    return Array.from(emails);
  }

  private async scrapePage(url: string, emailSet: Set<string>) {
    if (this.visitedUrls.has(url)) return;
    this.visitedUrls.add(url);

    const html = await this.getPageHtml(url);
    if (!html) return;

    const discovered = this.extractEmails(html);
    discovered.forEach(email => emailSet.add(email.toLowerCase()));
  }

  private async getPageHtml(url: string): Promise<string | null> {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        validateStatus: () => true, // Don't throw on 404/500
      });
      return typeof response.data === 'string' ? response.data : null;
    } catch (error) {
      return null;
    }
  }

  private extractEmails(text: string): string[] {
    // Basic email regex
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
    const matches = text.match(emailRegex);
    if (!matches) return [];

    // Filter out common false positives (like images)
    return matches.filter(email => {
      const lower = email.toLowerCase();
      return !lower.endsWith('.png') && 
             !lower.endsWith('.jpg') && 
             !lower.endsWith('.jpeg') && 
             !lower.endsWith('.gif') &&
             !lower.endsWith('.webp') &&
             lower.includes('.');
    });
  }

  private makeAbsolute(base: string, relative: string): string | null {
    try {
      const url = new URL(relative, base);
      // Ensure we stay on the same domain
      const baseHost = new URL(base).hostname.replace('www.', '');
      const urlHost = url.hostname.replace('www.', '');
      if (urlHost === baseHost) {
        return url.toString();
      }
      return null;
    } catch {
      return null;
    }
  }
}
