#!/usr/bin/env python3
"""
Restock Bot — Shopee & TikTok Shop
Monitors product stock and auto-buys when restocked.

Usage:
    python main.py                    # uses config.json in current dir
    python main.py --config my.json   # uses a custom config file
    python main.py --dry-run          # check stock only, never buy
    python main.py --platform shopee  # override platform from CLI
"""

import argparse
import sys
import os

# Ensure restock_bot package is importable when running from the repo root
sys.path.insert(0, os.path.dirname(__file__))

from core.config import load_config
from core.logger import get_logger
from notifications.notifier import Notifier

log = get_logger("main")


def main():
    parser = argparse.ArgumentParser(description="Restock Bot — Shopee & TikTok Shop")
    parser.add_argument("--config", default="config.json", help="Path to config JSON file")
    parser.add_argument("--dry-run", action="store_true", help="Check stock only, never purchase")
    parser.add_argument("--platform", choices=["shopee", "tiktok", "both"], help="Override platform from config")
    args = parser.parse_args()

    config_path = os.path.join(os.path.dirname(__file__), args.config)
    try:
        cfg = load_config(config_path)
    except FileNotFoundError as e:
        log.error(str(e))
        sys.exit(1)

    if args.dry_run:
        cfg.auto_buy = False
        log.info("DRY RUN mode — stock will be checked but nothing will be purchased.")

    platform = args.platform or cfg.platform
    notifier = Notifier(cfg.notifications)

    log.info(f"Restock Bot starting | Platform: {platform} | Region: {cfg.region} | Auto-buy: {cfg.auto_buy}")

    if platform == "shopee":
        from shopee.watcher import ShopeeWatcher
        ShopeeWatcher(cfg, notifier).run()

    elif platform == "tiktok":
        from tiktok.watcher import TikTokWatcher
        TikTokWatcher(cfg, notifier).run()

    elif platform == "both":
        import threading
        from shopee.watcher import ShopeeWatcher
        from tiktok.watcher import TikTokWatcher

        threads = [
            threading.Thread(target=ShopeeWatcher(cfg, notifier).run, name="shopee-watcher", daemon=True),
            threading.Thread(target=TikTokWatcher(cfg, notifier).run, name="tiktok-watcher", daemon=True),
        ]
        for t in threads:
            t.start()
            log.info(f"Started thread: {t.name}")

        try:
            for t in threads:
                t.join()
        except KeyboardInterrupt:
            log.info("Bot stopped by user.")

    else:
        log.error(f"Unknown platform: {platform}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Bot stopped by user.")
