import json
import os
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


@dataclass
class TelegramConfig:
    enabled: bool = False
    bot_token: str = ""
    chat_id: str = ""


@dataclass
class DiscordConfig:
    enabled: bool = False
    webhook_url: str = ""


@dataclass
class NotificationConfig:
    telegram: TelegramConfig = field(default_factory=TelegramConfig)
    discord: DiscordConfig = field(default_factory=DiscordConfig)


@dataclass
class ShopeeItem:
    name: str
    shop_id: int
    item_id: int
    model_id: Optional[int] = None
    max_price: float = 9999.0


@dataclass
class ShopeeConfig:
    base_url: str = "https://shopee.com.my"
    cookies_file: str = "shopee_cookies.json"
    watchlist: List[ShopeeItem] = field(default_factory=list)


@dataclass
class TikTokItem:
    name: str
    product_id: str
    sku_id: str
    shop_id: str
    max_price: float = 9999.0


@dataclass
class TikTokConfig:
    base_url: str = "https://www.tiktok.com"
    cookies_file: str = "tiktok_cookies.json"
    watchlist: List[TikTokItem] = field(default_factory=list)


@dataclass
class BotConfig:
    platform: str = "shopee"
    region: str = "MY"
    poll_interval_seconds: int = 15
    max_quantity: int = 1
    auto_buy: bool = True
    notifications: NotificationConfig = field(default_factory=NotificationConfig)
    shopee: ShopeeConfig = field(default_factory=ShopeeConfig)
    tiktok: TikTokConfig = field(default_factory=TikTokConfig)


def load_config(path: str = "config.json") -> BotConfig:
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Config file '{path}' not found. Copy config.example.json to config.json and fill in your details."
        )
    with open(path, "r", encoding="utf-8") as f:
        raw: Dict[str, Any] = json.load(f)

    notif_raw = raw.get("notifications", {})
    tg_raw = notif_raw.get("telegram", {})
    dc_raw = notif_raw.get("discord", {})

    shopee_raw = raw.get("shopee", {})
    tiktok_raw = raw.get("tiktok", {})

    return BotConfig(
        platform=raw.get("platform", "shopee"),
        region=raw.get("region", "MY"),
        poll_interval_seconds=raw.get("poll_interval_seconds", 15),
        max_quantity=raw.get("max_quantity", 1),
        auto_buy=raw.get("auto_buy", True),
        notifications=NotificationConfig(
            telegram=TelegramConfig(**tg_raw) if tg_raw else TelegramConfig(),
            discord=DiscordConfig(**dc_raw) if dc_raw else DiscordConfig(),
        ),
        shopee=ShopeeConfig(
            base_url=shopee_raw.get("base_url", "https://shopee.com.my"),
            cookies_file=shopee_raw.get("cookies_file", "shopee_cookies.json"),
            watchlist=[ShopeeItem(**i) for i in shopee_raw.get("watchlist", [])],
        ),
        tiktok=TikTokConfig(
            base_url=tiktok_raw.get("base_url", "https://www.tiktok.com"),
            cookies_file=tiktok_raw.get("cookies_file", "tiktok_cookies.json"),
            watchlist=[TikTokItem(**i) for i in tiktok_raw.get("watchlist", [])],
        ),
    )
