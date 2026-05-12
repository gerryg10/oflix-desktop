import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query;
  const action = query.action || '';

  if (!action) {
    return res.status(400).json({
      success: false,
      error: 'action wajib diisi',
      endpoints: {
        populer: '?action=populer&page=1',
        search: '?action=search&q=Tales&page=1',
        detail: '?action=detail&slug={slug}',
        play: '?action=play&ep={episode-slug}',
      },
    });
  }

  const ANICHIN_BASE = 'https://anichin.watch';
  const CF_COOKIE = process.env.ANICHIN_CF_CLEARANCE || '';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  function cfError() {
    return {
      error: 'Cloudflare block — cf_clearance cookie mungkin expired',
      hint: 'Update env var ANICHIN_CF_CLEARANCE di Vercel',
      cf_cookie_set: CF_COOKIE !== '',
    };
  }

  async function anichinFetch(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
          'Cookie': `cf_clearance=${CF_COOKIE}`,
          'Referer': `${ANICHIN_BASE}/`,
          'DNT': '1',
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      if (html.toLowerCase().includes('just a moment') || html.toLowerCase().includes('cf-challenge')) {
        return null;
      }
      return html;
    } catch {
      return null;
    }
  }

  function parseListPage(html, category, page) {
    const $ = cheerio.load(html);
    const items = [];

    $('.listupd .bs').each((i, el) => {
      const a = $(el).find('a[href]').first();
      if (!a.length) return;
      const href = a.attr('href');
      const title = a.attr('title') || a.text().trim();
      const slug = href.replace(/\/$/, '').split('/').pop();
      const poster = $(el).find('img').first().attr('src') || '';
      const status = $(el).find('.epx').text().trim();
      const type = $(el).find('.typez').text().trim().toLowerCase() || 'donghua';

      items.push({ title, detailPath: slug, poster, status, type });
    });

    if (items.length === 0) {
      return { error: 'listupd not found or empty', cf_ok: !html.includes('cf-challenge') };
    }

    return { category, page, items };
  }

  try {
    let result = null;
    let cacheTTL = 21600;

    switch (action) {
      case 'populer':
        const pPop = parseInt(query.page || '1', 10);
        const urlPop = `${ANICHIN_BASE}/donghua/?page=${pPop}&status=&type=&order=popular`;
        const htmlPop = await anichinFetch(urlPop);
        if (!htmlPop) result = cfError();
        else result = parseListPage(htmlPop, 'populer', pPop);
        cacheTTL = 21600;
        break;

      case 'search':
        const qSearch = query.q || '';
        const pSearch = parseInt(query.page || '1', 10);
        if (!qSearch) return res.status(400).json({ error: 'q required' });
        const urlSearch = `${ANICHIN_BASE}/page/${pSearch}/?s=${encodeURIComponent(qSearch)}`;
        const htmlSearch = await anichinFetch(urlSearch);
        if (!htmlSearch) result = cfError();
        else {
          result = parseListPage(htmlSearch, 'search', pSearch);
          result.query = qSearch;
        }
        cacheTTL = 21600;
        break;

      case 'detail':
        const slugDetail = query.slug || '';
        if (!slugDetail) return res.status(400).json({ error: 'slug required' });
        const urlDetail = `${ANICHIN_BASE}/donghua/${slugDetail}/`;
        const htmlDetail = await anichinFetch(urlDetail);
        if (!htmlDetail) result = cfError();
        else {
          const $ = cheerio.load(htmlDetail);
          const data = { detailPath: slugDetail, country: 'China', type: 'donghua', subtitles: 'Indonesia', genre: [], episodes: [] };

          data.title = $('.entry-title').text().trim();
          data.poster = $('.thumbook img').attr('src') || '';
          data.rating = $('.rating strong').text().trim() || $('.num').first().text().trim();
          
          $('.spe span').each((i, el) => {
            const text = $(el).text().trim();
            const lower = text.toLowerCase();
            if (lower.includes('durasi') || lower.includes('duration')) data.duration = text.replace(/^(Durasi|Duration)\s*:?\s*/i, '').trim();
            else if (lower.includes('dirilis') || lower.includes('released') || lower.includes('rilis')) {
              data.releaseDate = text.replace(/^(Dirilis|Released|Rilis|Tanggal Rilis)\s*:?\s*/i, '').trim();
              const match = data.releaseDate.match(/(\d{4})/);
              if (match) data.year = match[1];
            }
            else if (lower.includes('negara') || lower.includes('country')) data.country = text.replace(/^(Negara|Country)\s*:?\s*/i, '').trim() || 'China';
          });

          $('.genxed a').each((i, el) => data.genre.push($(el).text().trim()));

          data.description = $('.bixbox.synp .entry-content').text().trim() || $('.entry-content').first().text().trim();

          $('.eplister li').each((i, el) => {
            const a = $(el).find('a').first();
            if (!a.length) return;
            const playUrl = a.attr('href').replace(/\/$/, '').split('/').pop();
            const episode = $(el).find('.epl-num').text().trim() || ($(el).text().match(/episode\s*(\d+)/i) || [])[1] || '';
            const title = $(el).find('.epl-title').text().trim() || '';
            data.episodes.push({ playUrl, episode, title });
          });

          result = { data };
        }
        cacheTTL = 43200;
        break;

      case 'play':
        const epSlug = query.ep || '';
        if (!epSlug) return res.status(400).json({ error: 'ep required' });
        const urlPlay = `${ANICHIN_BASE}/${epSlug}/`;
        const htmlPlay = await anichinFetch(urlPlay);
        if (!htmlPlay) result = cfError();
        else {
          const $ = cheerio.load(htmlPlay);
          let playerUrl = '';

          const iframe1 = $('.video-content iframe').attr('data-src') || $('.video-content iframe').attr('src');
          if (iframe1 && !iframe1.includes('about:blank')) playerUrl = iframe1;

          if (!playerUrl) {
            $('iframe').each((i, el) => {
              const src = $(el).attr('data-src') || $(el).attr('src');
              if (src && !src.includes('about:blank')) {
                playerUrl = src;
                return false; // break
              }
            });
          }

          if (!playerUrl) {
            const match = htmlPlay.match(/(?:src|url|file)\s*[:=]\s*["']([^"']+(?:embed|player|video)[^"']*)["']/i);
            if (match) playerUrl = match[1];
          }

          result = { data: { playerUrl } };
        }
        cacheTTL = 2592000;
        break;

      default:
        return res.status(400).json({ error: 'action tidak dikenal: ' + action });
    }

    if (result && !result.error) {
      res.setHeader('Cache-Control', `s-maxage=${cacheTTL}, stale-while-revalidate=86400`);
    }
    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', detail: error.message });
  }
}
