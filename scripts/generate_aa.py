#!/usr/bin/env python3
"""
Generate a draft Agent Appeal from a product URL using crawl4ai + Gemini 1.5 Flash.
Reads URL from argv[1], prints STATUS: lines for progress and RESULT: <json> or ERROR: <msg>.
Installs Playwright Chromium automatically on first run if missing.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
from datetime import datetime

# Ensure stdout is unbuffered for live status
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None


def emit_status(msg: str) -> None:
    print(f"STATUS:{msg}", flush=True)


def emit_result(obj: dict) -> None:
    print("RESULT:" + json.dumps(obj), flush=True)


def emit_error(msg: str) -> None:
    print(f"ERROR:{msg}", flush=True)


AGENT_APPEAL_SCHEMA = {
    "id": "string",
    "name": "string",
    "type": "software | service | api | dataset | tool",
    "category": ["string"],
    "provider": {"name": "string", "website": "url"},
    "summary": "string",
    "problem_solved": ["string"],
    "capabilities": ["string"],
    "inputs_required": ["string"],
    "outputs_provided": ["string"],
    "pricing": {
        "model": "free | freemium | subscription | usage | one-time",
        "free_tier": "boolean",
        "paid_tier": "boolean",
    },
    "integration": {
        "access": "web | api | download",
        "authentication": "none | api_key | oauth",
        "automation_friendly": "boolean",
    },
    "constraints": ["string"],
    "action": {"learn_more": "url", "purchase": "url"},
    "metadata": {"created_at": "ISO-8601", "updated_at": "ISO-8601"},
}


async def main() -> None:
    if len(sys.argv) < 2:
        emit_error("Missing URL argument")
        sys.exit(1)
    url = sys.argv[1].strip()
    if not url.startswith(("http://", "https://")):
        emit_error("URL must be http or https")
        sys.exit(1)

    api_key = os.environ.get("GOOGLE_AI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        emit_error("GOOGLE_AI_API_KEY or GEMINI_API_KEY not set")
        sys.exit(1)

    emit_status("Starting crawl pipeline…")

    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except ImportError:
        emit_error("crawl4ai not installed. Run: pip install crawl4ai")
        sys.exit(1)

    emit_status("Launching browser…")
    browser_config = BrowserConfig(headless=True)
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, page_timeout=60000)

    def extract_text_from_result(result) -> str:
        """Extract readable text using multiple fallbacks to avoid 'No extractable text'."""
        candidates = []

        md = getattr(result, "markdown", None)
        if md is not None:
            if hasattr(md, "fit_markdown") and md.fit_markdown:
                candidates.append(str(md.fit_markdown).strip())
            if hasattr(md, "raw_markdown") and md.raw_markdown:
                candidates.append(str(md.raw_markdown).strip())
            if not (hasattr(md, "fit_markdown") or hasattr(md, "raw_markdown")):
                candidates.append(str(md).strip())

        for attr in ("cleaned_html", "html"):
            raw = getattr(result, attr, None)
            if raw and isinstance(raw, str) and raw.strip():
                try:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(raw, "html.parser")
                    for tag in soup(["script", "style", "nav", "footer", "header"]):
                        tag.decompose()
                    candidates.append(soup.get_text(separator=" ", strip=True))
                except Exception:
                    pass

        for c in candidates:
            normalized = " ".join(c.split()).strip()
            if len(normalized) > 50:
                return normalized[:50000]
        return " ".join(" ".join(c.split()) for c in candidates if c)[:50000] if candidates else ""

    async def do_crawl():
        async with AsyncWebCrawler(config=browser_config) as crawler:
            emit_status("Fetching page…")
            result = await crawler.arun(url=url, config=run_config)
            emit_status("Extracting content…")
            if getattr(result, "success", True) is False and not getattr(result, "markdown", None) and not getattr(result, "html", None):
                raise RuntimeError(getattr(result, "error_message", None) or "Crawl returned no content")
            return extract_text_from_result(result)

    page_text = ""
    try:
        page_text = await do_crawl()
    except Exception as e:
        err = str(e)
        if "Executable doesn't exist" in err or "playwright" in err.lower() or "browserType.launch" in err:
            emit_status("Installing Chromium (one-time, may take a minute)…")
            try:
                subprocess.run(
                    [sys.executable, "-m", "playwright", "install", "chromium"],
                    check=True,
                    timeout=300,
                    capture_output=True,
                )
            except subprocess.TimeoutExpired:
                emit_error("Browser install timed out. Run manually: python -m playwright install chromium")
                sys.exit(1)
            except subprocess.CalledProcessError as install_err:
                stderr = (install_err.stderr or b"").decode("utf-8", "replace").strip()
                emit_error(f"Browser install failed: {stderr or install_err}")
                sys.exit(1)
            emit_status("Launching browser…")
            try:
                page_text = await do_crawl()
            except Exception as retry_e:
                emit_error(f"Crawl failed after install: {retry_e}")
                sys.exit(1)
        else:
            emit_error(f"Crawl failed: {e}")
            sys.exit(1)

    if not page_text or len(page_text.strip()) < 20:
        emit_error("No extractable text from page (tried markdown and HTML fallbacks)")
        sys.exit(1)

    emit_status("Calling Gemini to draft Agent Appeal…")
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
    except Exception as e:
        emit_error(f"Gemini setup failed: {e}")
        sys.exit(1)

    schema_str = json.dumps(AGENT_APPEAL_SCHEMA, indent=2)
    system = f"""You are a precise assistant. Given webpage text from a product or service page, output a single valid JSON object that conforms exactly to this Agent Appeal schema. Use only the types, enums, and structure shown. Output nothing else—no markdown, no explanation, only the JSON object.

Schema (structure only, fill with inferred or reasonable values):
{schema_str}

Rules:
- id: use placeholder "draft" (will be replaced on publish).
- type: exactly one of: software, service, api, dataset, tool.
- pricing.model: exactly one of: free, freemium, subscription, usage, one-time.
- integration.access: exactly one of: web, api, download.
- integration.automation_friendly: boolean.
- All URLs must be valid; use the provided page URL where appropriate for learn_more/purchase/provider.website.
- metadata.created_at and metadata.updated_at: use current ISO-8601 timestamp.
- Arrays must be non-empty where you have data; use [] only if truly none."""

    user = f"Page URL: {url}\n\nWebpage text:\n{page_text}"

    # Try models in order (Google AI Studio / v1beta support varies by region and time)
    model_ids = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-002", "gemini-1.5-pro", "gemini-pro"]
    content = None
    last_error = None
    for model_id in model_ids:
        try:
            model = genai.GenerativeModel(model_id)
            response = model.generate_content(
                [system, user],
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=4096,
                    temperature=0.2,
                ),
            )
            content = (response.text or "").strip()
            if content:
                break
        except Exception as e:
            last_error = e
            if "404" in str(e) or "not found" in str(e).lower():
                continue
            emit_error(f"Gemini request failed: {e}")
            sys.exit(1)
    if not content:
        emit_error(f"Gemini request failed: {last_error}")
        sys.exit(1)

    emit_status("Parsing draft…")
    match = re.search(r"\{[\s\S]*\}", content)
    raw = match.group(0) if match else content
    try:
        draft = json.loads(raw)
    except json.JSONDecodeError:
        emit_error("Invalid JSON from Gemini")
        sys.exit(1)

    draft["id"] = "draft"
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    draft.setdefault("metadata", {})
    draft["metadata"]["created_at"] = draft["metadata"].get("created_at") or now
    draft["metadata"]["updated_at"] = now
    emit_status("Done.")
    emit_result(draft)


if __name__ == "__main__":
    asyncio.run(main())
