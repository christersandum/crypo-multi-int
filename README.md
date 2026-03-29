# Crypto Transaction Investigator

An interactive link-chart tool for investigating cryptocurrency transactions and the people or organizations behind them — runs entirely in the browser and is hosted on **GitHub Pages** with no server required.

## 🔗 Live App

👉 **[Open the Investigator](https://christersandum.github.io/crypo-multi-int/)**

## ✨ Features

| Feature | Description |
|---|---|
| **Interactive graph** | Drag, zoom and explore the transaction network powered by [vis-network](https://visjs.github.io/vis-network/) |
| **Node types** | Person 🔵 · Organization 🟢 · Wallet 🟡 · Exchange 🟠 · Unknown ⚪ |
| **Transactions** | Directed arrows with amount, currency, date and tx-hash |
| **Blockchain links** | Click a tx-hash to jump straight to the block explorer |
| **Case management** | Multiple named cases, saved automatically in `localStorage` |
| **Import / Export** | Save and restore cases as JSON files |
| **Search** | Filter and highlight nodes by name or address |
| **Demo data** | Load a sample money-laundering scenario with one click |
| **Double-click to edit** | Double-click any node or edge to edit its properties |

## 🚀 Getting Started

1. Open the live app (link above).
2. Click **📂 Demo** to load a sample case, or click **+ Node** to start your own.
3. Add the entities you want to track (wallet addresses, people, organisations, exchanges).
4. Add transactions between them with **↔ Transaction**.
5. Click any node or edge to see details in the right panel.
6. Use **⬇ Export** to save your work as a JSON file that you can re-import later.

## 🗂 Case File Format

Cases are stored as plain JSON and can be edited by hand:

```json
{
  "id": "abc123",
  "name": "My Investigation",
  "nodes": [
    { "id": "n1", "label": "Alice", "type": "person", "address": "", "notes": "", "tags": "" },
    { "id": "n2", "label": "bc1q…", "type": "wallet", "address": "bc1qxy2k…", "notes": "", "tags": "" }
  ],
  "edges": [
    {
      "id": "e1", "from": "n1", "to": "n2",
      "amount": "1.5", "currency": "BTC",
      "date": "2024-03-01",
      "txHash": "a1b2c3…",
      "notes": ""
    }
  ]
}
```

## 🛠 Development

This is a **zero-build static site** — just HTML, CSS and vanilla JS.  
Open `index.html` in any modern browser or serve with any static HTTP server:

```bash
npx serve .
# or
python3 -m http.server
```

## 📋 Supported Currencies

BTC · ETH · USDT · USDC · XMR · LTC · BNB · SOL · TRX · Other

## ⚙ GitHub Pages Setup

Enable GitHub Pages in **Settings → Pages → Deploy from branch → `main` / root**.  
The `.nojekyll` file ensures GitHub Pages serves the raw files without Jekyll processing.

