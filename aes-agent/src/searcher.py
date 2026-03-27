"""
searcher.py — Tavily + Serper ile web araması.
"""
import os
from typing import Optional
from tenacity import retry, stop_after_attempt, wait_exponential

try:
    from tavily import TavilyClient
    TAVILY_OK = True
except ImportError:
    TAVILY_OK = False

try:
    import httpx
    HTTPX_OK = True
except ImportError:
    HTTPX_OK = False


def _tavily_client():
    key = os.getenv("TAVILY_API_KEY", "")
    if not key or key == "tvly-BURAYA_YAZ":
        return None
    if not TAVILY_OK:
        return None
    return TavilyClient(api_key=key)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=8))
def search(query: str, max_results: int = 8) -> list[dict]:
    """
    Web araması yap. Önce Tavily, yoksa Serper dene.
    Her sonuç: {"title", "url", "content", "score"}
    """
    client = _tavily_client()
    if client:
        return _tavily_search(client, query, max_results)

    serper_key = os.getenv("SERPER_API_KEY", "")
    if serper_key and serper_key != "BURAYA_YAZ" and HTTPX_OK:
        return _serper_search(serper_key, query, max_results)

    raise RuntimeError(
        "Arama API'si bulunamadı. .env dosyasında TAVILY_API_KEY veya SERPER_API_KEY tanımlı değil."
    )


def _tavily_search(client, query: str, max_results: int) -> list[dict]:
    resp = client.search(
        query=query,
        max_results=max_results,
        search_depth="advanced",
        include_answer=False,
        include_raw_content=False,
    )
    results = []
    for r in resp.get("results", []):
        results.append({
            "title":   r.get("title", ""),
            "url":     r.get("url", ""),
            "content": r.get("content", ""),
            "score":   r.get("score", 0.0),
        })
    return results


def _serper_search(api_key: str, query: str, max_results: int) -> list[dict]:
    resp = httpx.post(
        "https://google.serper.dev/search",
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        json={"q": query, "num": max_results, "gl": "de", "hl": "de"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    results = []
    for r in data.get("organic", []):
        results.append({
            "title":   r.get("title", ""),
            "url":     r.get("link", ""),
            "content": r.get("snippet", ""),
            "score":   0.5,
        })
    return results


def search_daad(field: str, degree: str = "Master", language: str = "any") -> list[dict]:
    """DAAD için özelleşmiş arama."""
    lang_map = {"Almanca": "German", "İngilizce": "English", "any": ""}
    lang_en = lang_map.get(language, "")
    query = f'DAAD "{field}" {degree} Germany university program admission requirements {lang_en}'
    return search(query, max_results=10)


def search_university_requirements(university: str, program: str) -> list[dict]:
    """Belirli üniversite + bölüm için başvuru şartları ara."""
    query = f'{university} "{program}" Bewerbung Zulassungsvoraussetzungen Sprachkenntnisse Bewerbungsfrist'
    return search(query, max_results=5)


def search_nc_value(university: str, program: str, year: int = 0) -> list[dict]:
    """NC değeri ara."""
    from datetime import datetime
    if not year:
        year = datetime.now().year
    query = f'Numerus Clausus {university} {program} {year} NC Wartesemester'
    return search(query, max_results=5)
