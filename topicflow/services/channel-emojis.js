/**
 * Emoji per channel slug (directory UI).
 * Stored as Unicode code points to avoid source encoding issues.
 */
const CHANNEL_EMOJI = {
  "crypto-btc": "\u{1FA99}",
  "crypto-eth": "\u{1F48E}",
  "crypto-top10": "\u{1F4B0}",
  "crypto-global": "\u{1F30D}",
  "crypto-news": "\u{1F4F0}",
  "forex-rates": "\u{1F4B1}",
  "forex-historical": "\u{1F4C5}",
  "commodities-metals": "\u{1FA99}",
  "stocks-movers": "\u{1F4C8}",
  "macro-world-bank": "\u{1F30D}",
  "earthquakes-global": "\u{1F30A}",
  "earthquakes-significant": "\u{1F5FC}",
  "volcanoes": "\u{1F30B}",
  "weather-global": "\u{2601}\u{FE0F}",
  "air-quality-global": "\u{1F32A}\u{FE0F}",
  "wildfires": "\u{1F525}",
  "space-weather": "\u{1F319}",
  "nasa-apod": "\u{1F680}",
  "iss-location": "\u{1F6F0}\u{FE0F}",
  "iss-crew": "\u{1F468}\u{200D}\u{1F680}",
  "solar-flares": "\u{2600}\u{FE0F}",
  "near-earth-objects": "\u{1F47D}",
  "ocean-temp": "\u{1F30A}",
  "co2-levels": "\u{1F4A7}",
  "arctic-ice": "\u{2744}\u{FE0F}",
  "covid-global": "\u{1F9A0}",
  "covid-countries": "\u{1F3F4}",
  "flu-surveillance": "\u{1F9A0}",
  "news-headlines": "\u{1F4F0}",
  "hacker-news-top": "\u{1F4A1}",
  "github-trending": "\u{1F525}",
  "pypi-new-packages": "\u{1F40D}",
  "npm-downloads": "\u{1F4E6}",
  "arxiv-ai": "\u{1F9E0}",
  "arxiv-physics": "\u{269B}\u{FE0F}",
  "pubmed-new": "\u{1F52C}",
  "open-fda-recalls": "\u{26A0}\u{FE0F}",
  "us-patents": "\u{1F4DC}",
  "eu-regulations": "\u{2696}\u{FE0F}",
  "un-comtrade": "\u{1F6E3}\u{FE0F}",
  "world-pop": "\u{1F465}",
  "internet-stats": "\u{1F310}",
  "power-grid-au": "\u{26A1}",
  "power-grid-us": "\u{1F4A1}",
  "shipping-ports": "\u{2693}",
  "flight-activity": "\u{2708}\u{FE0F}",
  "wikipedia-trending": "\u{1F4D6}",
  "open-library-new": "\u{1F4DA}",
  "cat-facts": "\u{1F431}",
  "exchange-status": "\u{1F4CA}",
};

function emojiForSlug(slug) {
  return CHANNEL_EMOJI[slug] || "\u{1F4E1}";
}

module.exports = { CHANNEL_EMOJI, emojiForSlug };
