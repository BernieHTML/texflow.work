import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '_' });

/**
 * Returns { eventName, payload } for a given channel slug and raw API response.
 * rawData is the parsed JSON (or string for text/csv) from the source API.
 */
export function normalise(slug, rawData) {
  const ts = new Date().toISOString();

  switch (slug) {
    case 'crypto-btc':
    case 'crypto-eth': {
      const m = rawData?.market_data;
      return {
        eventName: 'price_update',
        payload: {
          channel: slug,
          event: 'price_update',
          ts,
          source: rawData?.name ? `CoinGecko /coins/${rawData.id}` : 'CoinGecko',
          payload: {
            symbol: rawData?.symbol?.toUpperCase(),
            name: rawData?.name,
            price_usd: m?.current_price?.usd ?? null,
            market_cap_usd: m?.market_cap?.usd ?? null,
            volume_24h_usd: m?.total_volume?.usd ?? null,
            circulating_supply: rawData?.market_data?.circulating_supply ?? null,
            change_1h_pct: m?.price_change_percentage_1h_in_currency?.usd ?? null,
            change_24h_pct: m?.price_change_percentage_24h ?? null,
            change_7d_pct: m?.price_change_percentage_7d ?? null,
            ath_usd: m?.ath?.usd ?? null,
            ath_date: m?.ath_date?.usd?.split('T')[0] ?? null,
            rank: rawData?.market_cap_rank ?? null,
          },
        },
      };
    }

    case 'crypto-top10': {
      return {
        eventName: 'market_update',
        payload: {
          channel: slug,
          event: 'market_update',
          ts,
          source: 'CoinGecko /coins/markets',
          payload: (Array.isArray(rawData) ? rawData : []).map((c, i) => ({
            rank: i + 1,
            symbol: c.symbol?.toUpperCase(),
            name: c.name,
            price_usd: c.current_price ?? null,
            market_cap_usd: c.market_cap ?? null,
            volume_24h_usd: c.total_volume ?? null,
            change_1h_pct: c.price_change_percentage_1h_in_currency ?? null,
            change_24h_pct: c.price_change_percentage_24h ?? null,
            change_7d_pct: c.price_change_percentage_7d_in_currency ?? null,
          })),
        },
      };
    }

    case 'crypto-global': {
      const d = rawData?.data;
      const mc = d?.total_market_cap;
      const vol = d?.total_volume;
      return {
        eventName: 'market_overview',
        payload: {
          channel: slug,
          event: 'market_overview',
          ts,
          source: 'CoinGecko /global',
          payload: {
            total_market_cap_usd: mc?.usd ?? null,
            total_volume_usd: vol?.usd ?? null,
            btc_dominance_pct: d?.market_cap_percentage?.btc ?? null,
            eth_dominance_pct: d?.market_cap_percentage?.eth ?? null,
            active_cryptocurrencies: d?.active_cryptocurrencies ?? null,
            markets: d?.markets ?? null,
            market_cap_change_24h_pct: d?.market_cap_change_percentage_24h_usd ?? null,
          },
        },
      };
    }

    case 'crypto-news': {
      const articles = Array.isArray(rawData)
        ? rawData
        : Array.isArray(rawData?.articles)
        ? rawData.articles
        : Array.isArray(rawData?.data)
        ? rawData.data
        : [];
      return {
        eventName: 'news_update',
        payload: {
          channel: slug,
          event: 'news_update',
          ts,
          source: 'cryptocurrency.cv',
          payload: articles.slice(0, 10).map((a) => ({
            title: a.title ?? a.name ?? null,
            source: a.source ?? a.source_info?.name ?? null,
            url: a.url ?? a.link ?? null,
            published_at: a.published_at ?? a.publishedAt ?? a.created_at ?? null,
            tickers: a.tickers ?? a.currencies?.map((c) => c.code) ?? [],
          })),
        },
      };
    }

    case 'forex-rates': {
      return {
        eventName: 'fx_update',
        payload: {
          channel: slug,
          event: 'fx_update',
          ts,
          source: 'Frankfurter /latest',
          payload: {
            base: rawData?.base ?? 'USD',
            date: rawData?.date ?? ts.split('T')[0],
            rates: rawData?.rates ?? {},
          },
        },
      };
    }

    case 'commodities-metals': {
      const spots = Array.isArray(rawData) ? rawData : [];
      const find = (sym) => spots.find((s) => s.name?.toLowerCase() === sym || s.symbol?.toLowerCase() === sym);
      const gold = find('gold') || find('xau') || spots[0];
      const silver = find('silver') || find('xag') || spots[1];
      const platinum = find('platinum') || find('xpt') || spots[2];
      const palladium = find('palladium') || find('xpd') || spots[3];
      return {
        eventName: 'metals_update',
        payload: {
          channel: slug,
          event: 'metals_update',
          ts,
          source: 'metals.live /v1/spot',
          payload: {
            gold_usd_oz: gold?.price ?? gold?.ask ?? null,
            silver_usd_oz: silver?.price ?? silver?.ask ?? null,
            platinum_usd_oz: platinum?.price ?? platinum?.ask ?? null,
            palladium_usd_oz: palladium?.price ?? palladium?.ask ?? null,
            ts,
          },
        },
      };
    }

    case 'stocks-movers': {
      const items = Array.isArray(rawData) ? rawData : [];
      return {
        eventName: 'movers_update',
        payload: {
          channel: slug,
          event: 'movers_update',
          ts,
          source: 'Financial Modeling Prep /actives',
          payload: items.slice(0, 20).map((s) => ({
            symbol: s.ticker ?? s.symbol,
            name: s.companyName ?? s.name,
            price: s.price ?? s.lastSalePrice ?? null,
            change_pct: s.changesPercentage ?? s.changePercentage ?? null,
            volume: s.volume ?? null,
          })),
        },
      };
    }

    case 'macro-world-bank': {
      const records = Array.isArray(rawData) ? rawData[1] ?? [] : [];
      return {
        eventName: 'gdp_update',
        payload: {
          channel: slug,
          event: 'gdp_update',
          ts,
          source: 'World Bank NY.GDP.MKTP.CD',
          payload: records
            .filter((r) => r?.value !== null)
            .map((r) => ({
              country: r?.country?.value ?? null,
              country_code: r?.countryiso3code ?? null,
              year: r?.date ?? null,
              gdp_usd: r?.value ?? null,
            })),
        },
      };
    }

    case 'exchange-status': {
      const items = Array.isArray(rawData) ? rawData : [];
      return {
        eventName: 'exchange_update',
        payload: {
          channel: slug,
          event: 'exchange_update',
          ts,
          source: 'CoinGecko /exchanges',
          payload: items.map((e) => ({
            id: e.id,
            name: e.name,
            trust_score: e.trust_score ?? null,
            volume_24h_btc: e.trade_volume_24h_btc ?? null,
            country: e.country ?? null,
            year_established: e.year_established ?? null,
            has_trading_incentive: e.has_trading_incentive ?? null,
          })),
        },
      };
    }

    case 'earthquakes-live':
    case 'earthquakes-significant': {
      const features = rawData?.features ?? [];
      return {
        eventName: 'earthquake_update',
        payload: {
          channel: slug,
          event: 'earthquake_update',
          ts,
          source: 'USGS Earthquake Hazards Program',
          payload: {
            count: features.length,
            events: features.map((f) => ({
              id: f.id,
              magnitude: f.properties?.mag ?? null,
              place: f.properties?.place ?? null,
              depth_km: f.geometry?.coordinates?.[2] ?? null,
              lat: f.geometry?.coordinates?.[1] ?? null,
              lon: f.geometry?.coordinates?.[0] ?? null,
              ts: f.properties?.time ? new Date(f.properties.time).toISOString() : null,
              url: f.properties?.url ?? null,
              felt_reports: f.properties?.felt ?? null,
            })),
          },
        },
      };
    }

    case 'volcanoes': {
      const parsed = typeof rawData === 'string' ? xmlParser.parse(rawData) : rawData;
      const items = parsed?.rss?.channel?.item ?? [];
      const arr = Array.isArray(items) ? items : [items];
      return {
        eventName: 'volcano_update',
        payload: {
          channel: slug,
          event: 'volcano_update',
          ts,
          source: 'Smithsonian GVP Weekly Report',
          payload: arr.slice(0, 10).map((item) => ({
            name: extractVolcanoName(item?.title),
            country: null,
            lat: null,
            lon: null,
            activity_summary: stripHtml(String(item?.description ?? '')).slice(0, 300),
            alert_level: null,
            reported_date: item?.pubDate ?? null,
          })),
        },
      };
    }

    case 'weather-global': {
      const cw = rawData?.current_weather;
      return {
        eventName: 'weather_update',
        payload: {
          channel: slug,
          event: 'weather_update',
          ts,
          source: 'Open-Meteo /forecast',
          payload: {
            location: 'London (51.5°N, 0°E)',
            temperature_c: cw?.temperature ?? null,
            windspeed_kmh: cw?.windspeed ?? null,
            winddirection_deg: cw?.winddirection ?? null,
            weathercode: cw?.weathercode ?? null,
            is_day: cw?.is_day === 1,
          },
        },
      };
    }

    case 'air-quality': {
      // Handles both OpenAQ v2 (results[].measurements) and v3 (results[].sensors/latest)
      const results = rawData?.results ?? [];
      return {
        eventName: 'air_quality_update',
        payload: {
          channel: slug,
          event: 'air_quality_update',
          ts,
          source: 'OpenAQ',
          payload: results.slice(0, 20).map((r) => {
            const pm = (r.measurements ?? r.sensors ?? []).find(
              (m) => m.parameter === 'pm25' || m.parameter?.name === 'pm25',
            );
            return {
              city: r.city ?? r.locality ?? null,
              country: r.country ?? r.country?.code ?? null,
              parameter: 'pm25',
              value: pm?.value ?? pm?.latest?.value ?? null,
              unit: pm?.unit ?? 'µg/m³',
              last_updated: pm?.lastUpdated ?? pm?.latest?.datetime ?? null,
              lat: r.coordinates?.latitude ?? null,
              lon: r.coordinates?.longitude ?? null,
            };
          }),
        },
      };
    }

    case 'wildfires': {
      if (typeof rawData === 'string') {
        const lines = rawData.trim().split('\n').slice(1);
        const fires = lines.slice(0, 50).map((line) => {
          const cols = line.split(',');
          return {
            lat: parseFloat(cols[0]) || null,
            lon: parseFloat(cols[1]) || null,
            brightness: parseFloat(cols[2]) || null,
            scan: parseFloat(cols[3]) || null,
            track: parseFloat(cols[4]) || null,
            acq_date: cols[5] ?? null,
            acq_time: cols[6] ?? null,
            confidence: cols[8] ?? null,
            frp: parseFloat(cols[13]) || null,
          };
        });
        return {
          eventName: 'wildfire_update',
          payload: {
            channel: slug,
            event: 'wildfire_update',
            ts,
            source: 'NASA FIRMS VIIRS SNPP NRT',
            payload: fires,
          },
        };
      }
      return { eventName: 'source_error', payload: { channel: slug, error: 'unexpected format', ts } };
    }

    case 'co2-levels': {
      if (typeof rawData === 'string') {
        const lines = rawData.split('\n').filter((l) => !l.startsWith('#') && l.trim());
        const recent = lines.slice(-4);
        const parse = (line) => {
          const parts = line.trim().split(/\s+/);
          return parts.length >= 5 ? parseFloat(parts[4]) : null;
        };
        const latest = recent[recent.length - 1];
        const latestParts = latest?.trim().split(/\s+/) ?? [];
        return {
          eventName: 'co2_update',
          payload: {
            channel: slug,
            event: 'co2_update',
            ts,
            source: 'NOAA GML Mauna Loa',
            payload: {
              date: latestParts.length >= 4 ? `${latestParts[0]}-${String(latestParts[1]).padStart(2,'0')}-${String(latestParts[2]).padStart(2,'0')}` : null,
              co2_ppm: latestParts[4] ? parseFloat(latestParts[4]) : null,
              one_year_ago_ppm: recent.length >= 2 ? parse(recent[recent.length - 2]) : null,
              ten_years_ago_ppm: null,
              since_1800_ppm: null,
            },
          },
        };
      }
      return { eventName: 'source_error', payload: { channel: slug, error: 'unexpected format', ts } };
    }

    case 'arctic-ice': {
      const d = Array.isArray(rawData) ? rawData[0] : rawData;
      return {
        eventName: 'ice_update',
        payload: {
          channel: slug,
          event: 'ice_update',
          ts,
          source: 'NSIDC Sea Ice Index',
          payload: {
            date: d?.date ?? ts.split('T')[0],
            extent_million_km2: d?.extent ?? d?.value ?? null,
            area_million_km2: d?.area ?? null,
            anomaly_million_km2: d?.anomaly ?? null,
          },
        },
      };
    }

    case 'ocean-sst': {
      return {
        eventName: 'sst_update',
        payload: {
          channel: slug,
          event: 'sst_update',
          ts,
          source: 'NOAA ERDDAP SST',
          payload: {
            date: ts.split('T')[0],
            global_mean_anomaly_c: rawData?.value ?? null,
            hottest_region: null,
            coldest_region: null,
            note: 'Endpoint variability — check source for latest data',
          },
        },
      };
    }

    case 'uv-index': {
      const daily = rawData?.daily;
      const uvVals = daily?.uv_index_max ?? [];
      const dates = daily?.time ?? [];
      const latest = uvVals[0] ?? null;
      return {
        eventName: 'uv_update',
        payload: {
          channel: slug,
          event: 'uv_update',
          ts,
          source: 'Open-Meteo UV',
          payload: {
            date: dates[0] ?? ts.split('T')[0],
            uv_index_max: latest,
            uv_category: uvCategory(latest),
          },
        },
      };
    }

    case 'iss-location': {
      const pos = rawData?.iss_position;
      return {
        eventName: 'iss_position',
        payload: {
          channel: slug,
          event: 'iss_position',
          ts,
          source: 'Open Notify /iss-now',
          payload: {
            lat: pos ? parseFloat(pos.latitude) : null,
            lon: pos ? parseFloat(pos.longitude) : null,
            altitude_km: 408,
            velocity_kmh: 27600,
            ts: rawData?.timestamp ? new Date(rawData.timestamp * 1000).toISOString() : ts,
          },
        },
      };
    }

    case 'iss-crew': {
      const people = rawData?.people ?? [];
      return {
        eventName: 'crew_update',
        payload: {
          channel: slug,
          event: 'crew_update',
          ts,
          source: 'Open Notify /astros',
          payload: {
            total_count: rawData?.number ?? people.length,
            people: people.map((p) => ({ name: p.name, craft: p.craft })),
          },
        },
      };
    }

    case 'space-weather': {
      const records = Array.isArray(rawData) ? rawData : [];
      const latest = records[records.length - 1] ?? {};
      const kp = parseFloat(latest.kp_index ?? latest.Kp ?? 0);
      return {
        eventName: 'space_weather_update',
        payload: {
          channel: slug,
          event: 'space_weather_update',
          ts,
          source: 'NOAA SWPC Planetary K-index',
          payload: {
            kp_index: kp,
            observed_time: latest.time_tag ?? latest.observed_time ?? ts,
            status: kpStatus(kp),
          },
        },
      };
    }

    case 'solar-flares': {
      const records = Array.isArray(rawData) ? rawData : [];
      const latest = records[records.length - 1] ?? {};
      const flux = parseFloat(latest.flux ?? 0);
      return {
        eventName: 'solar_flux_update',
        payload: {
          channel: slug,
          event: 'solar_flux_update',
          ts,
          source: 'NOAA SWPC GOES X-ray',
          payload: {
            flux,
            flux_class: fluxClass(flux),
            time_tag: latest.time_tag ?? ts,
            satellite: latest.satellite ?? null,
          },
        },
      };
    }

    case 'nasa-apod': {
      return {
        eventName: 'apod_update',
        payload: {
          channel: slug,
          event: 'apod_update',
          ts,
          source: 'NASA APOD',
          payload: {
            date: rawData?.date ?? ts.split('T')[0],
            title: rawData?.title ?? null,
            explanation: rawData?.explanation?.slice(0, 500) ?? null,
            url: rawData?.url ?? null,
            media_type: rawData?.media_type ?? null,
            copyright: rawData?.copyright ?? null,
          },
        },
      };
    }

    case 'covid-global': {
      return {
        eventName: 'covid_update',
        payload: {
          channel: slug,
          event: 'covid_update',
          ts,
          source: 'disease.sh /v3/covid-19/all',
          payload: {
            cases: rawData?.cases ?? null,
            deaths: rawData?.deaths ?? null,
            recovered: rawData?.recovered ?? null,
            active: rawData?.active ?? null,
            critical: rawData?.critical ?? null,
            cases_per_million: rawData?.casesPerOneMillion ?? null,
            deaths_per_million: rawData?.deathsPerOneMillion ?? null,
            last_updated: rawData?.updated ? new Date(rawData.updated).toISOString() : ts,
          },
        },
      };
    }

    case 'covid-countries': {
      const countries = Array.isArray(rawData) ? rawData : [];
      return {
        eventName: 'covid_countries_update',
        payload: {
          channel: slug,
          event: 'covid_countries_update',
          ts,
          source: 'disease.sh /v3/covid-19/countries',
          payload: countries.map((c) => ({
            country: c.country,
            cases: c.cases ?? null,
            deaths: c.deaths ?? null,
            recovered: c.recovered ?? null,
            active: c.active ?? null,
            cases_per_million: c.casesPerOneMillion ?? null,
          })),
        },
      };
    }

    case 'flu-us': {
      const rows = Array.isArray(rawData) ? rawData : [];
      return {
        eventName: 'flu_update',
        payload: {
          channel: slug,
          event: 'flu_update',
          ts,
          source: 'CDC Socrata Flu Surveillance',
          payload: rows.map((r) => ({
            week_end: r.week_end ?? null,
            region: r.region ?? null,
            percent_positive: r.percent_positive != null ? parseFloat(r.percent_positive) : null,
            total_specimens: r.total_specimens != null ? parseInt(r.total_specimens) : null,
            ili_activity_level: r.activity_level_label ?? r.ili_activity_level ?? null,
          })),
        },
      };
    }

    case 'hacker-news': {
      const hits = rawData?.hits ?? [];
      return {
        eventName: 'hn_update',
        payload: {
          channel: slug,
          event: 'hn_update',
          ts,
          source: 'HN Algolia /search',
          payload: hits.map((h, i) => ({
            rank: i + 1,
            title: h.title ?? null,
            url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
            score: h.points ?? null,
            comments: h.num_comments ?? null,
            author: h.author ?? null,
            age_hours: h.created_at ? Math.round((Date.now() - new Date(h.created_at).getTime()) / 3600000) : null,
          })),
        },
      };
    }

    case 'github-trending': {
      const repos = Array.isArray(rawData) ? rawData : [];
      return {
        eventName: 'trending_update',
        payload: {
          channel: slug,
          event: 'trending_update',
          ts,
          source: 'Gitterapp /repositories',
          payload: repos.slice(0, 20).map((r) => ({
            name: r.name ?? null,
            owner: r.owner ?? null,
            description: r.description ?? null,
            language: r.language ?? null,
            stars: r.stars ?? r.stargazers_count ?? null,
            forks: r.forks ?? r.forks_count ?? null,
            stars_today: r.currentPeriodStars ?? r.stars_today ?? null,
            url: r.url ?? (r.owner && r.name ? `https://github.com/${r.owner}/${r.name}` : null),
          })),
        },
      };
    }

    case 'arxiv-ai':
    case 'arxiv-physics': {
      const parsed = typeof rawData === 'string' ? xmlParser.parse(rawData) : rawData;
      const items = parsed?.rdf?.item ?? parsed?.rss?.channel?.item ?? [];
      const arr = Array.isArray(items) ? items : [items];
      return {
        eventName: 'papers_update',
        payload: {
          channel: slug,
          event: 'papers_update',
          ts,
          source: `arXiv RSS ${slug === 'arxiv-ai' ? 'cs.AI' : 'physics'}`,
          payload: arr.slice(0, 10).map((item) => {
            const link = item?.link ?? item?.['dc:identifier'] ?? '';
            return {
              id: link.split('/abs/')[1] ?? null,
              title: stripHtml(String(item?.title ?? '')),
              authors: String(item?.['dc:creator'] ?? item?.author ?? '').split(', ').slice(0, 5),
              abstract_truncated: stripHtml(String(item?.description ?? '')).slice(0, 400),
              submitted: item?.['dc:date'] ?? item?.pubDate ?? null,
              url: link,
            };
          }),
        },
      };
    }

    case 'pubmed-ai-health': {
      const ids = rawData?.esearchresult?.idlist ?? [];
      return {
        eventName: 'pubmed_update',
        payload: {
          channel: slug,
          event: 'pubmed_update',
          ts,
          source: 'PubMed E-utilities',
          payload: ids.map((id) => ({
            pmid: id,
            title: null,
            journal: null,
            pub_date: null,
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          })),
        },
      };
    }

    case 'pypi-new': {
      const parsed = typeof rawData === 'string' ? xmlParser.parse(rawData) : rawData;
      const items = parsed?.rss?.channel?.item ?? [];
      const arr = Array.isArray(items) ? items : [items];
      return {
        eventName: 'pypi_update',
        payload: {
          channel: slug,
          event: 'pypi_update',
          ts,
          source: 'PyPI RSS',
          payload: arr.slice(0, 15).map((item) => {
            const titleStr = String(item?.title ?? '');
            const parts = titleStr.split(' ');
            return {
              name: parts[0] ?? null,
              version: parts[1] ?? null,
              description: stripHtml(String(item?.description ?? '')).slice(0, 200),
              author: item?.['dc:creator'] ?? item?.author ?? null,
              published_at: item?.pubDate ?? null,
              url: item?.link ?? null,
            };
          }),
        },
      };
    }

    case 'open-fda-recalls': {
      const results = rawData?.results ?? [];
      return {
        eventName: 'recall_update',
        payload: {
          channel: slug,
          event: 'recall_update',
          ts,
          source: 'OpenFDA /food/enforcement',
          payload: results.map((r) => ({
            recall_number: r.recall_number ?? null,
            product_description: r.product_description?.slice(0, 200) ?? null,
            reason: r.reason_for_recall?.slice(0, 200) ?? null,
            classification: r.classification ?? null,
            status: r.status ?? null,
            report_date: r.report_date ?? null,
            recalling_firm: r.recalling_firm ?? null,
            distribution_pattern: r.distribution_pattern?.slice(0, 200) ?? null,
          })),
        },
      };
    }

    case 'us-patents': {
      const patents = rawData?.patents ?? [];
      return {
        eventName: 'patents_update',
        payload: {
          channel: slug,
          event: 'patents_update',
          ts,
          source: 'PatentsView API',
          payload: patents.map((p) => ({
            patent_number: p.patent_number ?? null,
            title: p.patent_title ?? null,
            date: p.patent_date ?? null,
            assignee: (p.assignees ?? [])[0]?.assignee_organization ?? null,
          })),
        },
      };
    }

    case 'eu-regulations': {
      const items = rawData?.result?.results ?? rawData?.results ?? [];
      return {
        eventName: 'eu_regulations_update',
        payload: {
          channel: slug,
          event: 'eu_regulations_update',
          ts,
          source: 'EU Publications Office',
          payload: (Array.isArray(items) ? items : []).slice(0, 5).map((item) => ({
            title: item?.title ?? item?.label ?? null,
            type: 'Regulation',
            date: item?.issued ?? item?.date ?? null,
            url: item?.accessURL ?? item?.['@id'] ?? null,
            summary: null,
          })),
        },
      };
    }

    case 'un-comtrade': {
      const d = Array.isArray(rawData) ? rawData[0] : rawData;
      return {
        eventName: 'trade_update',
        payload: {
          channel: slug,
          event: 'trade_update',
          ts,
          source: 'UN Comtrade Public API',
          payload: {
            period: d?.period ?? null,
            reporter_count: d?.reporterCount ?? null,
            total_trade_usd_preview: d?.totalValue ?? null,
            last_updated: ts,
          },
        },
      };
    }

    case 'world-population': {
      const records = Array.isArray(rawData) ? rawData[1] ?? [] : [];
      return {
        eventName: 'population_update',
        payload: {
          channel: slug,
          event: 'population_update',
          ts,
          source: 'World Bank SP.POP.TOTL',
          payload: records.filter((r) => r?.value !== null).map((r) => ({
            country: r?.country?.value ?? null,
            country_code: r?.countryiso3code ?? null,
            year: r?.date ?? null,
            population: r?.value ?? null,
          })),
        },
      };
    }

    case 'eia-electricity': {
      const data = rawData?.response?.data ?? [];
      return {
        eventName: 'electricity_update',
        payload: {
          channel: slug,
          event: 'electricity_update',
          ts,
          source: 'EIA API v2',
          payload: data.map((d) => ({
            period: d.period ?? null,
            region: d.respondent ?? d.region ?? null,
            value_mwh: d.value ?? null,
            type: d.type ?? d['type-name'] ?? null,
          })),
        },
      };
    }

    case 'power-grid-au': {
      const regions = Array.isArray(rawData) ? rawData : rawData?.regions ?? [];
      const first = regions[0] ?? {};
      return {
        eventName: 'aemo_update',
        payload: {
          channel: slug,
          event: 'aemo_update',
          ts,
          source: 'AEMO ELEC_NEM_SUMMARY',
          payload: {
            region: first.regionid ?? first.REGIONID ?? null,
            demand_mw: first.totaldemand ?? first.TOTALDEMAND ?? null,
            generation_mw: first.productionfrom ?? first.PRODUCTIONFROM ?? null,
            price_aud_mwh: first.price ?? first.PRICE ?? null,
            renewable_pct: first.renewablefraction ? first.renewablefraction * 100 : null,
            ts,
          },
        },
      };
    }

    case 'flights-live': {
      const states = rawData?.states ?? [];
      return {
        eventName: 'flights_update',
        payload: {
          channel: slug,
          event: 'flights_update',
          ts,
          source: 'OpenSky Network /states/all',
          payload: {
            region: 'Europe (48-55°N, -5-15°E)',
            aircraft_count: states.length,
            ts,
          },
        },
      };
    }

    case 'shipping-ports': {
      return {
        eventName: 'ports_update',
        payload: {
          channel: slug,
          event: 'ports_update',
          ts,
          source: 'MarineTraffic',
          payload: Array.isArray(rawData) ? rawData.slice(0, 20) : [],
        },
      };
    }

    case 'flight-delays-us': {
      const programs = Array.isArray(rawData)
        ? rawData
        : rawData?.Programs ?? rawData?.programs ?? [];
      return {
        eventName: 'delays_update',
        payload: {
          channel: slug,
          event: 'delays_update',
          ts,
          source: 'FAA NASSTATUS',
          payload: programs.slice(0, 20).map((p) => ({
            airport: p.ARPT ?? p.airport ?? null,
            status: p.Status ?? p.status ?? null,
            delay_avg_minutes: p['Avg/Delay'] ?? p.delay_avg ?? null,
            delay_type: p.Reason ?? p.delay_type ?? null,
            conditions: p.Trend ?? p.conditions ?? null,
          })),
        },
      };
    }

    case 'wikipedia-trending': {
      const articles = rawData?.items?.[0]?.articles ?? [];
      return {
        eventName: 'wikipedia_update',
        payload: {
          channel: slug,
          event: 'wikipedia_update',
          ts,
          source: 'Wikimedia Pageviews API',
          payload: articles.slice(0, 20).map((a) => ({
            rank: a.rank,
            article: a.article?.replace(/_/g, ' '),
            views: a.views,
          })),
        },
      };
    }

    case 'open-library': {
      const changes = Array.isArray(rawData) ? rawData : [];
      return {
        eventName: 'library_update',
        payload: {
          channel: slug,
          event: 'library_update',
          ts,
          source: 'Open Library /recentchanges',
          payload: changes.slice(0, 10).map((c) => ({
            title: c.comment ?? null,
            author: c.author?.key ?? null,
            kind: c.kind ?? null,
            timestamp: c.timestamp ?? null,
            url: `https://openlibrary.org${c.key ?? ''}`,
          })),
        },
      };
    }

    case 'this-day-history': {
      const events = rawData?.data?.Events ?? [];
      return {
        eventName: 'history_update',
        payload: {
          channel: slug,
          event: 'history_update',
          ts,
          source: 'history.muffinlabs.com',
          payload: events.slice(0, 5).map((e) => ({
            year: e.year,
            event: e.text?.slice(0, 300),
          })),
        },
      };
    }

    case 'exchange-rates-ecb': {
      try {
        const series = rawData?.dataSets?.[0]?.series ?? {};
        const structure = rawData?.structure?.dimensions?.series ?? [];
        const currencyDim = structure.find((d) => d.id === 'CURRENCY');
        const currencies = currencyDim?.values?.map((v) => v.id) ?? ['USD', 'GBP', 'JPY', 'AUD'];
        const timePeriods = rawData?.structure?.dimensions?.observation?.[0]?.values ?? [];
        const latestDate = timePeriods[timePeriods.length - 1]?.id ?? ts.split('T')[0];
        const rates = {};
        Object.keys(series).forEach((key, i) => {
          const obs = series[key]?.observations ?? {};
          const lastIdx = String(Object.keys(obs).length - 1);
          rates[currencies[i]] = obs[lastIdx]?.[0] ?? null;
        });
        return {
          eventName: 'ecb_rates_update',
          payload: {
            channel: slug,
            event: 'ecb_rates_update',
            ts,
            source: 'ECB Data Portal',
            payload: { base: 'EUR', date: latestDate, rates },
          },
        };
      } catch (_) {
        return { eventName: 'source_error', payload: { channel: slug, error: 'parse error', ts } };
      }
    }

    case 'near-earth-objects': {
      const dateMap = rawData?.near_earth_objects ?? {};
      const neos = Object.values(dateMap).flat().slice(0, 10);
      return {
        eventName: 'neo_update',
        payload: {
          channel: slug,
          event: 'neo_update',
          ts,
          source: 'NASA NeoWs',
          payload: neos.map((n) => {
            const ca = (n.close_approach_data ?? [])[0] ?? {};
            return {
              name: n.name,
              id: n.id,
              estimated_diameter_m: n.estimated_diameter?.meters?.estimated_diameter_max ?? null,
              is_potentially_hazardous: n.is_potentially_hazardous_asteroid ?? false,
              close_approach_date: ca.close_approach_date ?? null,
              miss_distance_km: ca.miss_distance?.kilometers ? parseFloat(ca.miss_distance.kilometers) : null,
              relative_velocity_kmh: ca.relative_velocity?.kilometers_per_hour ? parseFloat(ca.relative_velocity.kilometers_per_hour) : null,
            };
          }),
        },
      };
    }

    case 'dev-status': {
      return {
        eventName: 'service_status_update',
        payload: {
          channel: slug,
          event: 'service_status_update',
          ts,
          source: 'Statuspage.io public APIs',
          payload: Array.isArray(rawData) ? rawData : [],
        },
      };
    }

    default:
      return {
        eventName: 'update',
        payload: {
          channel: slug,
          event: 'update',
          ts,
          source: 'unknown',
          payload: rawData,
        },
      };
  }
}

function uvCategory(uv) {
  if (uv === null || uv === undefined) return null;
  if (uv <= 2) return 'low';
  if (uv <= 5) return 'moderate';
  if (uv <= 7) return 'high';
  if (uv <= 10) return 'very_high';
  return 'extreme';
}

function kpStatus(kp) {
  if (kp < 4) return 'quiet';
  if (kp < 5) return 'unsettled';
  if (kp < 6) return 'active';
  if (kp < 7) return 'minor_storm';
  return 'major_storm';
}

function fluxClass(flux) {
  if (flux < 1e-7) return 'A';
  if (flux < 1e-6) return 'B';
  if (flux < 1e-5) return 'C';
  if (flux < 1e-4) return 'M';
  return 'X';
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function extractVolcanoName(title) {
  if (!title) return null;
  const str = String(title);
  const match = str.match(/^([^(]+)/);
  return match ? match[1].trim() : str;
}
