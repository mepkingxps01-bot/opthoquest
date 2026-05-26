import time
import random
import requests
from typing import Optional, Dict, Any
from core.config import ShopeeConfig, ShopeeItem
from core.cookie_loader import load_cookies, get_shopee_base_url
from core.logger import get_logger

log = get_logger("shopee")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://shopee.com.my/",
    "X-API-SOURCE": "pc",
    "X-Requested-With": "XMLHttpRequest",
}


class ShopeeClient:
    def __init__(self, cfg: ShopeeConfig, region: str = "MY"):
        self.cfg = cfg
        self.base_url = get_shopee_base_url(region)
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.session.headers["Referer"] = self.base_url + "/"
        cookies = load_cookies(cfg.cookies_file)
        self.session.cookies.update(cookies)
        self._logged_in = bool(cookies)

    def _api(self, path: str, params: Dict = None) -> Optional[Dict[str, Any]]:
        url = f"{self.base_url}/api/v4/{path}"
        try:
            r = self.session.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            log.error(f"Shopee API error [{path}]: {e}")
            return None

    def check_stock(self, item: ShopeeItem) -> Optional[Dict[str, Any]]:
        """Returns stock info dict or None on failure."""
        data = self._api(
            "item/get",
            params={"itemid": item.item_id, "shopid": item.shop_id},
        )
        if not data or data.get("error"):
            log.warning(f"Failed to fetch item {item.name}: {data}")
            return None

        item_data = data.get("data", {})
        stock = item_data.get("stock", 0)
        price = item_data.get("price", 0) / 100_000  # Shopee stores price * 100000
        status = item_data.get("item_status", "")
        sold_out = item_data.get("sold_out_variant", False)

        # If model_id specified, check that specific variant
        if item.model_id:
            models = item_data.get("models", [])
            for m in models:
                if m.get("modelid") == item.model_id:
                    stock = m.get("stock", 0)
                    price = m.get("price", 0) / 100_000
                    break

        return {
            "in_stock": stock > 0 and status == "normal" and not sold_out,
            "stock": stock,
            "price": price,
            "name": item_data.get("name", item.name),
        }

    def add_to_cart(self, item: ShopeeItem, quantity: int = 1) -> bool:
        if not self._logged_in:
            log.error("Not logged in — cannot add to cart. Please provide cookies.")
            return False

        payload = {
            "itemid": item.item_id,
            "shopid": item.shop_id,
            "quantity": quantity,
        }
        if item.model_id:
            payload["modelid"] = item.model_id

        try:
            url = f"{self.base_url}/api/v4/cart/add_to_cart"
            r = self.session.post(url, json=payload, timeout=15)
            r.raise_for_status()
            result = r.json()
            if result.get("error") == 0:
                log.info(f"Added to cart: {item.name}")
                return True
            log.warning(f"Add to cart failed: {result}")
            return False
        except requests.RequestException as e:
            log.error(f"Add to cart error: {e}")
            return False

    def checkout(self, item: ShopeeItem, quantity: int = 1) -> bool:
        """
        Performs instant checkout (buy now) for a single item.
        Shopee's checkout requires a multi-step flow:
        1. Get checkout info
        2. Place order
        """
        if not self._logged_in:
            log.error("Not logged in — cannot checkout.")
            return False

        # Step 1: get_checkout_info to retrieve address/payment defaults
        checkout_info = self._api(
            "order/checkout/get_checkout_info",
            params={"itemid": item.item_id, "shopid": item.shop_id, "quantity": quantity},
        )
        if not checkout_info:
            log.error("Could not retrieve checkout info.")
            return False

        # Step 2: place order
        try:
            url = f"{self.base_url}/api/v4/order/checkout/place_order"
            # Build minimal order payload using defaults from checkout_info
            order_data = checkout_info.get("data", {})
            payload = {
                "orders": [
                    {
                        "shopid": item.shop_id,
                        "items": [
                            {
                                "itemid": item.item_id,
                                "modelid": item.model_id or 0,
                                "quantity": quantity,
                            }
                        ],
                    }
                ],
                "selected_payment_channel_data": order_data.get("selected_payment_channel_data", {}),
                "shipping_orders": order_data.get("shipping_orders", []),
                "tax_info": order_data.get("tax_info", {}),
            }
            r = self.session.post(url, json=payload, timeout=20)
            r.raise_for_status()
            result = r.json()
            if result.get("error") == 0:
                order_id = result.get("data", {}).get("order_sn", "unknown")
                log.info(f"ORDER PLACED! Order ID: {order_id} | Item: {item.name}")
                return True
            log.warning(f"Place order failed: {result}")
            return False
        except requests.RequestException as e:
            log.error(f"Checkout error: {e}")
            return False

    def buy_now(self, item: ShopeeItem, quantity: int = 1, max_price: float = 9999.0) -> bool:
        """High-level: add to cart first, then attempt checkout."""
        stock_info = self.check_stock(item)
        if not stock_info or not stock_info["in_stock"]:
            return False
        if stock_info["price"] > max_price:
            log.warning(f"Price RM{stock_info['price']:.2f} exceeds max RM{max_price:.2f} — skipping.")
            return False
        log.info(f"Stock available! Price: RM{stock_info['price']:.2f} | Attempting purchase...")
        if not self.add_to_cart(item, quantity):
            return False
        time.sleep(random.uniform(0.5, 1.5))
        return self.checkout(item, quantity)
