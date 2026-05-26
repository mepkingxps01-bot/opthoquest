# Restock Bot — Shopee & TikTok Shop

Monitors product pages for restock and **auto-buys immediately** when stock becomes available.

---

## Features

- Supports **Shopee** (MY, SG, PH, ID, TH, TW, VN, BR) and **TikTok Shop**
- Auto-purchase (add to cart → checkout) the moment stock appears
- **Telegram** and/or **Discord** notifications on restock & successful purchase
- Configurable poll interval, max quantity, and max price guard
- Cookie-based login — your credentials never touch this bot
- Logs to console (colored) and `restock_bot.log`

---

## Setup

### 1. Install dependencies

```bash
cd restock_bot
pip install -r requirements.txt
```

### 2. Export your browser cookies

You must be logged in on the platform in your browser first.

1. Install the **Cookie-Editor** extension (Chrome/Firefox)
2. Go to `shopee.com.my` (or `tiktok.com`) while logged in
3. Open Cookie-Editor → click **Export** → **Export as JSON**
4. Save the file as `shopee_cookies.json` or `tiktok_cookies.json` inside the `restock_bot/` folder

> **Why cookies?** The bot acts as your browser session. No passwords are stored or sent anywhere.

### 3. Create your config

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "platform": "shopee",
  "region": "MY",
  "poll_interval_seconds": 15,
  "max_quantity": 1,
  "auto_buy": true,
  "notifications": {
    "telegram": {
      "enabled": true,
      "bot_token": "123456:ABC-your-token",
      "chat_id": "your_chat_id"
    }
  },
  "shopee": {
    "cookies_file": "shopee_cookies.json",
    "watchlist": [
      {
        "name": "Nike Air Max 90",
        "shop_id": 123456789,
        "item_id": 987654321,
        "model_id": null,
        "max_price": 500.00
      }
    ]
  }
}
```

#### How to find Shopee `shop_id` and `item_id`

Open a product page on Shopee. The URL looks like:
```
https://shopee.com.my/product/SHOP_ID/ITEM_ID
```
Copy those numbers into the config.

#### How to find TikTok `product_id` and `sku_id`

Open a TikTok Shop product. In the URL or page source look for `product_id`. The `sku_id` is the specific variant (size/colour). You can find it by opening DevTools → Network tab → filter for `product/detail` while loading the product page.

---

## Running

```bash
# Normal run (auto-buy enabled per config)
python main.py

# Check stock only — never actually buy
python main.py --dry-run

# Override platform
python main.py --platform tiktok

# Watch both platforms simultaneously
python main.py --platform both

# Custom config file
python main.py --config my_config.json
```

---

## Telegram Bot Setup (optional)

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`
2. Copy the token into `notifications.telegram.bot_token`
3. Message your bot once, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Copy the `chat.id` value into `notifications.telegram.chat_id`
4. Set `"enabled": true`

---

## Notes

- **Poll interval**: 15 seconds is a good default. Going below 5s may trigger rate limiting.
- **max_price**: Safety guard — the bot won't buy if the price exceeds this value (catches flash price errors).
- **max_quantity**: Set to 1 to avoid accidentally buying duplicates.
- Purchased item IDs are tracked in memory — restart the bot if you want to buy again.
- The checkout step requires a **default address and payment method** saved in your account.

---

## Disclaimer

This bot is for personal use only. Use responsibly and in accordance with the platform's Terms of Service.
