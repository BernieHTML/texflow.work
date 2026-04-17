const { readJson, writeJson } = require("./store");

const BUILTIN_CHANNELS = [
  ["crypto-btc", "Bitcoin price", "crypto", "60s", "coingecko", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true", "normaliseCoinGeckoSimple"],
  ["crypto-eth", "Ethereum price", "crypto", "60s", "coingecko", "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true", "normaliseCoinGeckoSimple"],
  ["crypto-top10", "Top 10 coins by market cap", "crypto", "5min", "coingecko", "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10", "normaliseCoinGeckoMarkets"],
  ["crypto-global", "Global crypto market stats", "crypto", "5min", "coingecko", "https://api.coingecko.com/api/v3/global", "normaliseCoinGeckoGlobal"],
  ["crypto-news", "Crypto news headlines", "crypto", "10min", "cryptocurrency.cv", "https://cryptocurrency.cv/api/news?limit=10", "normaliseList"],
  ["forex-rates", "Major forex rates (USD base)", "finance", "1hr", "frankfurter", "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CAD,CHF,CNY", "normaliseForexRates"],
  ["forex-historical", "Daily forex OHLC", "finance", "1hr", "frankfurter", "https://api.frankfurter.app/latest", "normaliseForexRates"],
  ["commodities-metals", "Gold & silver spot price", "finance", "5min", "metals.live", "https://api.metals.live/v1/spot", "normaliseList"],
  ["stocks-movers", "US market top movers", "finance", "5min", "fmp", "https://financialmodelingprep.com/api/v3/actives?apikey={FMP_API_KEY}", "normaliseList"],
  ["macro-world-bank", "World Bank key macro indicators", "economics", "daily", "worldbank", "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&mrv=1", "normaliseList"],
  ["earthquakes-global", "Earthquakes M2.5+ last 24h", "geoscience", "5min", "usgs", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", "normaliseUSGSEarthquake"],
  ["earthquakes-significant", "Significant earthquakes (M4.5+)", "geoscience", "5min", "usgs", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", "normaliseUSGSEarthquake"],
  ["volcanoes", "Smithsonian volcano activity", "geoscience", "daily", "smithsonian", "https://volcano.si.edu/gvp_api/", "normaliseList"],
  ["weather-global", "Open-Meteo global weather snapshot", "weather", "30min", "open-meteo", "https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current_weather=true", "normaliseWeather"],
  ["air-quality-global", "Global air quality index", "environment", "30min", "openaq", "https://api.openaq.org/v2/latest?limit=10&order_by=lastUpdated&sort=desc", "normaliseList"],
  ["wildfires", "Active global wildfires (NASA FIRMS)", "environment", "1hr", "firms", "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_API_KEY}/VIIRS_SNPP_NRT/world/1", "normaliseCSV"],
  ["space-weather", "Solar wind, Kp index, geomagnetic", "space", "5min", "swpc", "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json", "normaliseList"],
  ["nasa-apod", "NASA astronomy photo of the day", "space", "daily", "nasa", "https://api.nasa.gov/planetary/apod?api_key={NASA_API_KEY}", "normaliseNasaApod"],
  ["iss-location", "International Space Station live location", "space", "30s", "open-notify", "http://api.open-notify.org/iss-now.json", "normaliseIssLocation"],
  ["iss-crew", "People currently in space", "space", "1hr", "open-notify", "http://api.open-notify.org/astros.json", "normaliseList"],
  ["solar-flares", "GOES solar flare events", "space", "5min", "swpc", "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json", "normaliseList"],
  ["near-earth-objects", "NEOs passing Earth this week", "space", "daily", "nasa", "https://api.nasa.gov/neo/rest/v1/feed?api_key={NASA_API_KEY}", "normaliseNeoWs"],
  ["ocean-temp", "Sea surface temperature anomalies", "environment", "daily", "noaa", "https://www.ncei.noaa.gov/erddap/tabledap/", "normaliseRaw"],
  ["co2-levels", "Atmospheric CO2 (Mauna Loa)", "environment", "daily", "noaa", "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.txt", "normaliseRaw"],
  ["arctic-ice", "Arctic sea ice extent", "environment", "daily", "nsidc", "https://nsidc.org/api/seaice/", "normaliseRaw"],
  ["covid-global", "Global COVID-19 stats", "health", "1hr", "disease.sh", "https://disease.sh/v3/covid-19/all", "normaliseCovidGlobal"],
  ["covid-countries", "COVID stats by country", "health", "1hr", "disease.sh", "https://disease.sh/v3/covid-19/countries?sort=cases", "normaliseList"],
  ["flu-surveillance", "CDC flu activity (US)", "health", "weekly", "cdc", "https://data.cdc.gov/resource/pkqy-w4ch.json?$limit=10&$order=week_end DESC", "normaliseList"],
  ["news-headlines", "Top global news (RSS normalised)", "news", "15min", "newsdata", "https://newsdata.io/api/1/latest?apikey={NEWSDATA_API_KEY}&language=en", "normaliseList"],
  ["hacker-news-top", "Hacker News top 10 stories", "tech", "15min", "hn", "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10", "normaliseHNFrontPage"],
  ["github-trending", "GitHub trending repos today", "tech", "1hr", "gitterapp", "https://api.gitterapp.com/repositories?since=daily", "normaliseList"],
  ["pypi-new-packages", "Newest PyPI packages", "tech", "30min", "pypi", "https://pypi.org/rss/packages.xml", "normaliseRSS"],
  ["npm-downloads", "npm top packages weekly downloads", "tech", "daily", "npm", "https://api.npmjs.org/downloads/point/last-week", "normaliseRaw"],
  ["arxiv-ai", "New arXiv AI/ML papers", "research", "daily", "arxiv", "https://export.arxiv.org/rss/cs.AI", "normaliseRSS"],
  ["arxiv-physics", "New arXiv physics papers", "research", "daily", "arxiv", "https://export.arxiv.org/rss/physics", "normaliseRSS"],
  ["pubmed-new", "Latest PubMed publications", "research", "daily", "pubmed", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=pub+date&retmax=5&term=AI+health", "normaliseRaw"],
  ["open-fda-recalls", "US FDA product recalls", "regulatory", "1hr", "openfda", "https://api.fda.gov/food/enforcement.json?limit=5&sort=report_date:desc", "normaliseList"],
  ["us-patents", "Recent USPTO patent grants", "regulatory", "daily", "patentsview", "https://api.patentsview.org/patents/query?q={\"_gte\":{\"patent_date\":\"2026-01-01\"}}&f=[\"patent_number\",\"patent_title\"]&o={\"per_page\":5}", "normaliseRaw"],
  ["eu-regulations", "EU Official Journal new acts", "regulatory", "daily", "eu", "https://data.europa.eu/api/hub/repo/distributions.json?filter=type:Regulation&sort=issued:desc&limit=5", "normaliseRaw"],
  ["un-comtrade", "Global trade flows (UN Comtrade)", "economics", "daily", "un", "https://comtradeapi.un.org/public/v1/preview/C/A/HS", "normaliseRaw"],
  ["world-pop", "World population milestones", "demographics", "daily", "worldbank", "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&mrv=1", "normaliseList"],
  ["internet-stats", "Internet live stats snapshot", "tech", "1hr", "internet", "https://api.allorigins.win/raw?url=https://www.internetlivestats.com/", "normaliseRaw"],
  ["power-grid-au", "Australian electricity grid frequency", "energy", "5min", "aemo", "https://visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY", "normaliseRaw"],
  ["power-grid-us", "US EIA weekly electricity data", "energy", "daily", "eia", "https://api.eia.gov/v2/electricity/rto/region-data/data/?api_key={EIA_API_KEY}", "normaliseRaw"],
  ["shipping-ports", "Global vessel AIS positions (sample)", "logistics", "15min", "marinetraffic", "https://services.marinetraffic.com/api/getvessel/v:3/{MARINE_TRAFFIC_API_KEY}", "normaliseRaw"],
  ["flight-activity", "OpenSky live flight count", "logistics", "5min", "opensky", "https://opensky-network.org/api/states/all?lamin=50&lomin=0&lamax=51&lomax=2", "normaliseOpenSky"],
  ["wikipedia-trending", "Wikipedia most-read articles today", "culture", "daily", "wikipedia", "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/04/17", "normaliseRaw"],
  ["open-library-new", "New Open Library additions", "culture", "1hr", "openlibrary", "https://openlibrary.org/recentchanges.json?limit=5", "normaliseList"],
  ["cat-facts", "Random cat facts (test/dev channel)", "misc", "5min", "catfact", "https://catfact.ninja/fact", "normaliseCatFact"],
  ["exchange-status", "Major exchange operational status", "finance", "15min", "coingecko", "https://api.coingecko.com/api/v3/exchanges?per_page=10", "normaliseList"],
];

function resolveSourceUrl(template) {
  return template
    .replace("{NASA_API_KEY}", process.env.NASA_API_KEY || "DEMO_KEY")
    .replace("{EIA_API_KEY}", process.env.EIA_API_KEY || "DEMO")
    .replace("{NEWSDATA_API_KEY}", process.env.NEWSDATA_API_KEY || "FREE_KEY")
    .replace("{FMP_API_KEY}", process.env.FMP_API_KEY || "demo")
    .replace("{MARINE_TRAFFIC_API_KEY}", process.env.MARINE_TRAFFIC_API_KEY || "DEMO_KEY")
    .replace("{FIRMS_API_KEY}", process.env.FIRMS_API_KEY || "FIRMS_KEY");
}

async function seedChannels() {
  const existing = await readJson("channels.json", []);
  if (existing.length > 0) return existing;
  const now = new Date().toISOString();
  const seeded = BUILTIN_CHANNELS.map(([slug, name, category, cadence, sourceApi, sourceUrl, normaliserFn]) => ({
    id: slug,
    slug,
    name,
    description: `${name} feed`,
    category,
    cadence,
    source_type: "builtin",
    source_api: sourceApi,
    source_url: resolveSourceUrl(sourceUrl),
    normaliser_fn: normaliserFn,
    event_type: "update",
    subscriber_count: 0,
    owner_user_id: null,
    verified: true,
    created_at: now,
  }));
  await writeJson("channels.json", seeded);
  return seeded;
}

module.exports = { seedChannels, BUILTIN_CHANNELS };
