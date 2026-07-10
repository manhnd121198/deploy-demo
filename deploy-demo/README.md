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

After deploy, create a new account in the app, paste the Google Chat webhook URL and village JSON, then schedule tasks.
