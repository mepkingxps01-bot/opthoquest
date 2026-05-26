import time
import random
from typing import Set
from core.config import BotConfig
from core.logger import get_logger
from shopee.client import ShopeeClient
from notifications.notifier import Notifier

log = get_logger("shopee.watcher")


class ShopeeWatcher:
    def __init__(self, cfg: BotConfig, notifier: Notifier):
        self.cfg = cfg
        self.client = ShopeeClient(cfg.shopee, cfg.region)
        self.notifier = notifier
        self._purchased: Set[int] = set()

    def run(self):
        watchlist = self.cfg.shopee.watchlist
        if not watchlist:
            log.warning("Shopee watchlist is empty. Add items to config.json.")
            return

        log.info(f"Watching {len(watchlist)} Shopee item(s). Poll every {self.cfg.poll_interval_seconds}s.")

        while True:
            for item in watchlist:
                if item.item_id in self._purchased:
                    continue

                try:
                    info = self.client.check_stock(item)
                    if info is None:
                        continue

                    status = "IN STOCK" if info["in_stock"] else "out of stock"
                    log.info(f"[{item.name}] {status} | Stock: {info['stock']} | Price: RM{info['price']:.2f}")

                    if info["in_stock"]:
                        self.notifier.send(
                            "RESTOCK DETECTED",
                            f"{item.name}\nPrice: RM{info['price']:.2f}\nStock: {info['stock']}\n"
                            f"Link: {self.cfg.shopee.base_url}/product/{item.shop_id}/{item.item_id}",
                        )

                        if self.cfg.auto_buy:
                            success = self.client.buy_now(
                                item,
                                quantity=self.cfg.max_quantity,
                                max_price=item.max_price,
                            )
                            if success:
                                self._purchased.add(item.item_id)
                                self.notifier.send(
                                    "PURCHASE SUCCESSFUL",
                                    f"Bought {self.cfg.max_quantity}x {item.name} for RM{info['price']:.2f}",
                                )
                            else:
                                log.warning(f"Auto-buy failed for {item.name}. Will retry next poll.")

                except Exception as e:
                    log.error(f"Error checking {item.name}: {e}")

                # Small jitter between items to avoid rate limiting
                time.sleep(random.uniform(1.0, 2.5))

            time.sleep(self.cfg.poll_interval_seconds)
