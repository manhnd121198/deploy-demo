# CoC Builder Alarm Deploy Demo

Deno Deploy version of the web app: static frontend, API backend, Deno KV storage, and Deno Cron for Google Chat messages.

## Local

```bash
cd deploy-demo
export AUTH_SECRET="$(openssl rand -hex 32)"
deno task dev
```

Open `http://localhost:8000`.

## Deploy

Create a Deno Deploy project with:

- Entry point: `deploy-demo/main.ts`
- Environment variable: `AUTH_SECRET`
- Deploy from the GitHub repository so Deno Deploy includes files in `public/`.

After deploy, create a new account in the app, choose Google Chat or Telegram, enter the channel config and village JSON, then schedule tasks.

## Left to max detail catalog

`public/data/catalog.json` is generated from the MIT-licensed
`chiefpansancolt/clash-of-clans-data` repository:

```bash
python3 tools/build_catalog.py /path/to/clash-of-clans-data public/data/catalog.json
```

The catalog is used for item-level matching and left-to-max estimates. Unknown IDs are still shown as raw IDs in the UI.

## Telegram Bot

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`.
3. Follow BotFather prompts. The bot username must end with `bot`.
4. Copy the token BotFather returns, for example `123456789:ABC...`.
5. Open your new bot and send it any message.
6. Open `https://api.telegram.org/bot<TOKEN>/getUpdates`.
7. Copy `chat.id` from the JSON response.
8. Paste the token and chat id into the app, then press `Test kênh gửi`.
