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
      status: 'error',
      message: 'action wajib diisi',
      endpoints: {
        populer: '?action=populer&page=1',
        search: '?action=search&q=naruto',
        detail: '?action=detail&detailManga={slug}',
        baca: '?action=baca&bacaManga={slug}',
      },
    });
  }

  const KOMIKU_BASE = 'https://komiku.org';
  const KOMIKU_API = 'https://api.komiku.org';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  async function komikuFetch(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
          'Referer': `${KOMIKU_BASE}/`,
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return KOMIKU_BASE + url;
    return url;
  }

  function parseItems(html) {
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();

    $('.bge').each((i, el) => {
      const a = $(el).find('a').first();
      const link = fixUrl(a.attr('href'));
      if (!link || seen.has(link)) return;
      seen.add(link);

      const slug = link.replace(/\/$/, '').split('/').pop();
      const img = $(el).find('img').first();
      const poster = fixUrl(img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src'));

      let title = $(el).find('h2 a, h3 a, h4 a').first().text().trim() ||
                  $(el).find('h2, h3, h4').first().text().trim() ||
                  img.attr('alt') ||
                  slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

      const tpe = $(el).find('.tpe1_inf').first();
      const bText = tpe.find('b').text().trim();
      const type = bText || '';
      const genre = tpe.text().replace(bText, '').trim();

      const lastChapter = $(el).find('.new1').text().trim();
      const info = $(el).find('.judul2').text().trim();

      items.push({
        title,
        slug,
        link,
        detailManga: slug,
        poster,
        lastChapter,
        type,
        genre,
        info,
      });
    });
    return items;
  }

  try {
    let result = null;
    let cacheTTL = 21600;

    switch (action) {
      case 'populer':
        const page = parseInt(query.page || '1', 10);
        const startApi = (page - 1) * 5 + 1;
        const endApi = startApi + 4;
        const populerItems = [];
        const seenPop = new Set();
        const errors = [];

        for (let p = startApi; p <= endApi; p++) {
          const url = p === 1 ? `${KOMIKU_API}/other/hot/` : `${KOMIKU_API}/other/hot/page/${p}/`;
          const html = await komikuFetch(url);
          if (!html) {
            errors.push(`page ${p}: fetch failed`);
            continue;
          }
          const parsed = parseItems(html);
          for (const item of parsed) {
            if (!seenPop.has(item.link)) {
              seenPop.add(item.link);
              populerItems.push(item);
            }
          }
        }
        result = { status: 'ok', action: 'populer', page, totalItems: populerItems.length, errors: errors.length ? errors : undefined, data: populerItems };
        cacheTTL = 21600;
        break;

      case 'search':
        const q = query.q || '';
        if (!q) return res.status(400).json({ status: 'error', message: 'q required' });
        const sUrl = `${KOMIKU_API}/?post_type=manga&s=${encodeURIComponent(q)}`;
        const sHtml = await komikuFetch(sUrl);
        if (!sHtml) return res.status(502).json({ status: 'error', message: 'Gagal fetch search' });
        const sItems = parseItems(sHtml);
        result = { status: 'ok', action: 'search', query: q, totalItems: sItems.length, data: sItems };
        cacheTTL = 21600;
        break;

      case 'detail':
        const detailSlug = query.detailManga || '';
        if (!detailSlug) return res.status(400).json({ status: 'error', message: 'detailManga required' });
        const dUrl = `${KOMIKU_BASE}/manga/${detailSlug}/`;
        const dHtml = await komikuFetch(dUrl);
        if (!dHtml) return res.status(502).json({ status: 'error', message: 'Gagal fetch detail' });

        const $d = cheerio.load(dHtml);
        const info = { meta: {} };

        info.title = $d('#Informasi h1').text().trim() || $d('h1').first().text().trim();
        const posterImg = $d('#Informasi img').first();
        info.poster = fixUrl(posterImg.attr('data-src') || posterImg.attr('src'));
        info.description = $d('#sinopsis, .sinopsis').first().text().trim();

        $d('#Informasi tr').each((i, el) => {
          const tds = $d(el).find('td');
          if (tds.length >= 2) {
            const k = $d(tds[0]).text().trim().replace(/:$/, '');
            const v = $d(tds[1]).text().trim();
            if (k && v && k.length < 30) info.meta[k] = v;
          }
        });

        const chapters = [];
        $d('#Daftar_Chapter tr, #daftarChapter tr, [data-test="chapter-table"] tr, tr[itemprop="itemListElement"]').each((i, el) => {
          const a = $d(el).find('a[href]').first();
          if (!a.length) return;
          const link = fixUrl(a.attr('href'));
          const chSlug = link.replace(/\/$/, '').split('/').pop();
          const title = $d(el).find('.judulseries, [itemprop="name"]').first().text().trim() || a.text().trim();
          if (!title) return;
          let date = $d(el).find('.tanggalseries').first().text().trim();
          if (!date) {
            const tds = $d(el).find('td');
            if (tds.length >= 2) {
              const last = $d(tds[tds.length - 1]).text().trim();
              if (last !== title && /\d/.test(last)) date = last;
            }
          }
          chapters.push({ title, slug: chSlug, link, bacaManga: chSlug, date });
        });

        result = { status: 'ok', action: 'detail', detailManga: detailSlug, url: dUrl, info, totalChapter: chapters.length, chapters };
        cacheTTL = 43200;
        break;

      case 'baca':
        const bacaSlug = query.bacaManga || '';
        if (!bacaSlug) return res.status(400).json({ status: 'error', message: 'bacaManga required' });
        const bUrl = `${KOMIKU_BASE}/${bacaSlug}/`;
        const bHtml = await komikuFetch(bUrl);
        if (!bHtml) return res.status(502).json({ status: 'error', message: 'Gagal fetch baca' });

        const $b = cheerio.load(bHtml);
        const images = [];
        $b('#Baca_Komik img, .chapter-content img, .reader img').each((i, el) => {
          const src = fixUrl($b(el).attr('data-src') || $b(el).attr('data-lazy-src') || $b(el).attr('data-original') || $b(el).attr('src'));
          if (!src || src.toLowerCase().includes('blank') || src.toLowerCase().includes('placeholder')) return;
          const id = $b(el).attr('id') || String(i + 1);
          const alt = $b(el).attr('alt') || `Page ${i + 1}`;
          images.push({ id, src, alt });
        });

        result = { status: 'ok', action: 'baca', bacaManga: bacaSlug, url: bUrl, firstImage: images[0]?.src || '', totalPages: images.length, images };
        cacheTTL = 2592000;
        break;

      default:
        return res.status(400).json({ status: 'error', message: 'action tidak dikenal: ' + action });
    }

    if (result && result.status === 'ok') {
      res.setHeader('Cache-Control', `s-maxage=${cacheTTL}, stale-while-revalidate=86400`);
    }
    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Internal Server Error', detail: error.message });
  }
}
