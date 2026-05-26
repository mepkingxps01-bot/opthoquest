import requests
from core.config import NotificationConfig
from core.logger import get_logger

log = get_logger("notifier")


class Notifier:
    def __init__(self, cfg: NotificationConfig):
        self.cfg = cfg

    def send(self, title: str, body: str):
        if self.cfg.telegram.enabled:
            self._telegram(title, body)
        if self.cfg.discord.enabled:
            self._discord(title, body)
        log.info(f"[NOTIFY] {title} — {body}")

    def _telegram(self, title: str, body: str):
        url = f"https://api.telegram.org/bot{self.cfg.telegram.bot_token}/sendMessage"
        text = f"*{title}*\n{body}"
        try:
            r = requests.post(url, json={"chat_id": self.cfg.telegram.chat_id, "text": text, "parse_mode": "Markdown"}, timeout=10)
            r.raise_for_status()
            log.debug("Telegram notification sent.")
        except Exception as e:
            log.error(f"Telegram notification failed: {e}")

    def _discord(self, title: str, body: str):
        try:
            r = requests.post(
                self.cfg.discord.webhook_url,
                json={"content": f"**{title}**\n{body}"},
                timeout=10,
            )
            r.raise_for_status()
            log.debug("Discord notification sent.")
        except Exception as e:
            log.error(f"Discord notification failed: {e}")
