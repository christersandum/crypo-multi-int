# Search Proxy — Val Town Setup

The AI chatbot works fully offline (paste text → AI analyses it).  
If you also want **live Google web search**, you need a small proxy that forwards search requests to [Serper.dev](https://serper.dev) while keeping your API key hidden from the client.

The easiest way to host this proxy for free is **[Val Town](https://val.town)** — a serverless platform you sign into with GitHub. No CLI, no installs, everything done in the browser.

---

## Step 1 — Get a Serper.dev API key

1. Go to <https://serper.dev> and sign up (free tier available).
2. Copy your API key from the dashboard.

---

## Step 2 — Create the Val Town proxy

1. Go to <https://www.val.town> and sign in with your GitHub account.
2. Click **New Val** → choose **HTTP**.
3. Delete the placeholder code and paste the code below:

```typescript
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  try {
    const { query } = await req.json();
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": Deno.env.get("SERPER_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });

    const data = await res.json();
    const results = (data.organic || []).slice(0, 5).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));

    return new Response(JSON.stringify({ results }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
```

4. Click **Save**. Val Town gives you a URL like:
   ```
   https://yourname-searchproxy.web.val.run
   ```
   Copy it.

---

## Step 3 — Add your Serper API key securely

1. Go to <https://www.val.town/settings/environment-variables>
2. Click **Add variable**
3. Key: `SERPER_API_KEY` — Value: your key from Step 1
4. Save.

The key is now encrypted in Val Town and read by your val via `Deno.env.get("SERPER_API_KEY")`. It never appears in your GitHub repo.

---

## Step 4 — Connect the proxy to the app

1. Open the Crypto Investigator app.
2. Click the **🤖 Chat** tab in the sidebar.
3. Click **⚙ Settings**.
4. Paste your Val Town URL into the **Search Proxy URL** field.
5. The chatbot will now search Google before answering each question.

---

## Security notes

| What | Where it lives | Visible to public? |
|---|---|---|
| Serper API key | Val Town environment variable | ❌ No |
| Val Town proxy code | Your val (can be set to Unlisted) | Up to you |
| Proxy URL | Your browser's localStorage | Only you |

> **Never** put your Serper API key in the GitHub repo or in the app's source code.
