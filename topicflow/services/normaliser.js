const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function evt(channel, event, payload) {
  return {
    channel,
    event,
    ts: new Date().toISOString(),
    source: channel,
    payload,
  };
}

function asList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.features)) return raw.features;
  if (Array.isArray(raw?.hits)) return raw.hits;
  if (Array.isArray(raw?.people)) return raw.people;
  return raw ? [raw] : [];
}

function normaliseRSS(channelId, text) {
  const parsed = parser.parse(text);
  const items = parsed?.rss?.channel?.item || [];
  const list = Array.isArray(items) ? items : [items];
  return evt(channelId, "rss_update", { items: list.slice(0, 10) });
}

function normalise(channelId, rawData, hint = "json") {
  if (hint === "xml") return normaliseRSS(channelId, rawData);
  if (hint === "text") return evt(channelId, "text_update", { text: String(rawData).slice(0, 5000) });

  switch (channelId) {
    case "crypto-btc":
    case "crypto-eth":
      return evt(channelId, "price_update", rawData);
    case "crypto-top10":
      return evt(channelId, "market_snapshot", { coins: asList(rawData).slice(0, 10) });
    case "crypto-global":
      return evt(channelId, "market_global", rawData?.data || rawData);
    case "forex-rates":
    case "forex-historical":
      return evt(channelId, "fx_rates", { base: rawData?.base, date: rawData?.date, rates: rawData?.rates || {} });
    case "earthquakes-global":
    case "earthquakes-significant":
      return evt(channelId, "earthquake", {
        count: rawData?.metadata?.count || 0,
        quakes: asList(rawData?.features).slice(0, 10).map((q) => ({
          mag: q?.properties?.mag,
          place: q?.properties?.place,
          time: q?.properties?.time,
          depth_km: q?.geometry?.coordinates?.[2],
        })),
      });
    case "weather-global":
      return evt(channelId, "weather", rawData?.current_weather || rawData);
    case "nasa-apod":
      return evt(channelId, "apod", { title: rawData?.title, date: rawData?.date, url: rawData?.url, explanation: rawData?.explanation });
    case "iss-location":
      return evt(channelId, "iss_location", {
        latitude: rawData?.iss_position?.latitude,
        longitude: rawData?.iss_position?.longitude,
      });
    case "near-earth-objects":
      return evt(channelId, "neo_update", { objects: rawData?.near_earth_objects || {} });
    case "covid-global":
      return evt(channelId, "health_update", rawData);
    case "hacker-news-top":
      return evt(channelId, "tech_news", { stories: asList(rawData?.hits || rawData).slice(0, 10) });
    case "flight-activity":
      return evt(channelId, "flight_activity", { flights: Array.isArray(rawData?.states) ? rawData.states.length : 0 });
    case "cat-facts":
      return evt(channelId, "fact", rawData);
    default:
      return evt(channelId, "update", Array.isArray(rawData) ? { items: rawData.slice(0, 20) } : rawData);
  }
}

module.exports = { normalise };
