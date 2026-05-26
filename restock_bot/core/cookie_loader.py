import json
import os
from typing import Dict
from core.logger import get_logger

log = get_logger("cookie_loader")

# Shopee region → base URL map
SHOPEE_REGIONS: Dict[str, str] = {
    "MY": "https://shopee.com.my",
    "SG": "https://shopee.sg",
    "PH": "https://shopee.ph",
    "ID": "https://shopee.co.id",
    "TH": "https://shopee.co.th",
    "TW": "https://shopee.tw",
    "VN": "https://shopee.vn",
    "BR": "https://shopee.com.br",
}


def load_cookies(cookies_file: str) -> Dict[str, str]:
    """Load cookies from a JSON file exported by a browser extension like EditThisCookie."""
    if not os.path.exists(cookies_file):
        log.warning(
            f"Cookies file '{cookies_file}' not found. "
            "Export your browser cookies using EditThisCookie or Cookie-Editor extension and save as JSON."
        )
        return {}
    with open(cookies_file, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # Support both list-of-dicts format (EditThisCookie) and simple dict format
    if isinstance(raw, list):
        return {c["name"]: c["value"] for c in raw if "name" in c and "value" in c}
    if isinstance(raw, dict):
        return raw
    return {}


def get_shopee_base_url(region: str) -> str:
    return SHOPEE_REGIONS.get(region.upper(), "https://shopee.com.my")
