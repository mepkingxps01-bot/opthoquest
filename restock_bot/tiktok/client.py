import time
import random
import requests
from typing import Optional, Dict, Any
from core.config import TikTokConfig, TikTokItem
from core.cookie_loader import load_cookies
from core.logger import get_logger

log = get_logger("tiktok")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.tiktok.com",
    "Referer": "https://www.tiktok.com/",
}

# TikTok Shop API base (webstore API used by the TikTok shop web interface)
TIKTOK_SHOP_API = "https://www.tiktok.com/api/shop"


class TikTokClient:
    def __init__(self, cfg: TikTokConfig):
        self.cfg = cfg
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        cookies = load_cookies(cfg.cookies_file)
        self.session.cookies.update(cookies)
        self._logged_in = bool(cookies)

    def _get(self, path: str, params: Dict = None) -> Optional[Dict[str, Any]]:
        url = f"{TIKTOK_SHOP_API}/{path}"
        try:
            r = self.session.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            log.error(f"TikTok API error [{path}]: {e}")
            return None

    def _post(self, path: str, payload: Dict) -> Optional[Dict[str, Any]]:
        url = f"{TIKTOK_SHOP_API}/{path}"
        try:
            r = self.session.post(url, json=payload, timeout=15)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            log.error(f"TikTok POST error [{path}]: {e}")
            return None

    def check_stock(self, item: TikTokItem) -> Optional[Dict[str, Any]]:
        """Check product stock via TikTok Shop product detail API."""
        data = self._get(
            "product/detail",
            params={
                "product_id": item.product_id,
                "shop_id": item.shop_id,
            },
        )
        if not data:
            return None

        product = data.get("data", {}).get("product", {})
        skus = product.get("skus", [])

        stock = 0
        price = 0.0
        in_stock = False

        for sku in skus:
            if sku.get("id") == item.sku_id:
                stock = sku.get("stock", {}).get("available_stock", 0)
                raw_price = sku.get("price", {}).get("sale_price", 0)
                # TikTok price is in cents
                price = raw_price / 100 if raw_price > 100 else raw_price
                in_stock = stock > 0 and sku.get("status", "") == "published"
                break

        return {
            "in_stock": in_stock,
            "stock": stock,
            "price": price,
            "name": product.get("title", item.name),
        }

    def add_to_cart(self, item: TikTokItem, quantity: int = 1) -> bool:
        if not self._logged_in:
            log.error("Not logged in — cannot add to cart. Please provide TikTok cookies.")
            return False

        result = self._post(
            "cart/add",
            {
                "product_id": item.product_id,
                "sku_id": item.sku_id,
                "quantity": quantity,
                "shop_id": item.shop_id,
            },
        )
        if result and result.get("status_code") == 0:
            log.info(f"Added to TikTok cart: {item.name}")
            return True
        log.warning(f"Add to TikTok cart failed: {result}")
        return False

    def checkout(self, item: TikTokItem, quantity: int = 1) -> bool:
        """
        TikTok Shop checkout — creates an order via the checkout API.
        Requires valid session cookies with a saved default address and payment method.
        """
        if not self._logged_in:
            log.error("Not logged in — cannot checkout.")
            return False

        # Step 1: Pre-order check
        pre_order = self._post(
            "order/pre_create",
            {
                "product_id": item.product_id,
                "sku_id": item.sku_id,
                "quantity": quantity,
                "shop_id": item.shop_id,
            },
        )
        if not pre_order or pre_order.get("status_code") != 0:
            log.error(f"Pre-order check failed: {pre_order}")
            return False

        # Step 2: Create order
        order_token = pre_order.get("data", {}).get("order_token", "")
        result = self._post(
            "order/create",
            {
                "order_token": order_token,
                "shop_id": item.shop_id,
            },
        )
        if result and result.get("status_code") == 0:
            order_id = result.get("data", {}).get("order_id", "unknown")
            log.info(f"TikTok ORDER PLACED! Order ID: {order_id} | Item: {item.name}")
            return True
        log.warning(f"TikTok place order failed: {result}")
        return False

    def buy_now(self, item: TikTokItem, quantity: int = 1, max_price: float = 9999.0) -> bool:
        info = self.check_stock(item)
        if not info or not info["in_stock"]:
            return False
        if info["price"] > max_price:
            log.warning(f"Price {info['price']:.2f} exceeds max {max_price:.2f} — skipping.")
            return False
        log.info(f"TikTok stock available! Price: {info['price']:.2f} | Attempting purchase...")
        if not self.add_to_cart(item, quantity):
            return False
        time.sleep(random.uniform(0.5, 1.5))
        return self.checkout(item, quantity)
