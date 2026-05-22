// ══════════════════════════════════════════════════════════
// OFLIX Video Proxy Worker — Clean (no dashboard/KV)
// ══════════════════════════════════════════════════════════

const REFERERS = {
    default: { origin: "https://123movienow.cc", referer: "https://123movienow.cc/" },
    okru: { origin: "https://ok.ru", referer: "https://ok.ru/" },
    anichin: { origin: "https://anichin.cafe", referer: "https://anichin.cafe/" },
    dailymotion: { origin: "https://www.dailymotion.com", referer: "https://www.dailymotion.com/" },
    hakunay: { origin: "https://123movienow.cc", referer: "https://123movienow.cc/" },
};

function getReferer(url) {
    const u = url.toLowerCase();
    if (u.includes("ok.ru") || u.includes("okcdn")) return REFERERS.okru;
    if (u.includes("anichin") || u.includes("sankavo")) return REFERERS.anichin;
    if (u.includes("dailymotion")) return REFERERS.dailymotion;
    if (u.includes("hakunay") || u.includes("bcdnxw") || u.includes("bcdnw")) return REFERERS.hakunay;
    return REFERERS.default;
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Origin, X-Requested-With",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type",
    "Access-Control-Max-Age": "86400",
};

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const videoUrl = url.searchParams.get("url");

        if (!videoUrl) {
            return new Response("OFLIX Video Proxy", { status: 200 });
        }

        const ref = getReferer(videoUrl);
        const headers = {
            "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Connection": "keep-alive",
            "Referer": ref.referer,
            "Origin": ref.origin,
            "Sec-Fetch-Dest": "video",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
        };

        const range = request.headers.get("Range");
        if (range) headers["Range"] = range;

        try {
            const upstream = await fetch(videoUrl, {
                method: "GET",
                headers,
                cf: { cacheTtl: 31536000, cacheEverything: true },
            });

            if (!upstream.ok && upstream.status !== 206) {
                return new Response(
                    JSON.stringify({ error: "Upstream error", status: upstream.status }),
                    { status: upstream.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
                );
            }

            const newHeaders = new Headers();
            for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
                const v = upstream.headers.get(h);
                if (v) newHeaders.set(h, v);
            }
            // Force video/mp4 to prevent browsers from rejecting octet-streams
            if (videoUrl.includes('.m3u8')) {
                newHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
            } else {
                newHeaders.set('Content-Type', 'video/mp4');
            }
            newHeaders.set('Accept-Ranges', 'bytes');
            Object.entries(CORS_HEADERS).forEach(([k, v]) => newHeaders.set(k, v));
            newHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
            newHeaders.set("X-Accel-Buffering", "no");

            return new Response(upstream.body, { status: upstream.status, headers: newHeaders });
        } catch (e) {
            return new Response(
                JSON.stringify({ error: "Fetch failed", message: e.message }),
                { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
            );
        }
    },
};