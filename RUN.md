# AxleOps — Fleet Management (fleet_overall)

A multi-tenant fleet management web app (React + Vite + TypeScript). No backend
yet — data lives in the browser (localStorage), so you only need Node to run it.

---

## 1. Prerequisites

- **Node.js 18+** and npm — check with:
  ```bash
  node -v    # should be v18 or higher
  npm -v
  ```
  If missing, install from https://nodejs.org (LTS).

## 2. Clone

```bash
git clone https://github.com/Afterlife24/fleet_overall.git
cd fleet_overall
```

## 3. Install dependencies

```bash
npm install
```

## 4. (Optional) Mapbox token for the maps

The **Fleet Map** and **Truck Tracking** pages use Mapbox. Without a token they
still load, but the map tiles stay blank. To enable them:

```bash
cp .env.example .env
```
Then edit `.env` and set your own token:
```
VITE_MAPBOX_TOKEN=pk.your_mapbox_token_here
```
(Get a free token at https://account.mapbox.com/access-tokens/)

## 5. Run the dev server

```bash
npm run dev
```
Open the URL it prints, usually **http://localhost:5173**

## 6. Build for production (optional)

```bash
npm run build      # outputs to dist/
npm run preview    # serve the built app locally
```

---

## Using the app

- **New company:** on the login page click **"Create a company account"**, sign
  up — you become the owner/admin and land on the **Apps** screen.
- **Activate apps** (Fleet, Cross Hire, Workshop, Invoices, etc.) from the Apps
  screen; the sidebar shows only activated apps.
- **Team page** (owner only): add members and assign which apps each role can
  open.
- **Try the demo company:** on the login page use the "Johnson Arabia" demo
  quick-login buttons to see a fully populated company.

## Reset everything (clear local data)

Data is stored in the browser. To wipe it and start fresh:
- Open DevTools (F12) → **Application → Local Storage → http://localhost:5173**
- Delete the `fleet-auth-v2` and `fleet-orgs-v2` keys, then reload.

## Troubleshooting

- **Port 5173 in use:** Vite auto-picks the next port (5174, …); use the URL it
  prints.
- **Blank maps:** set `VITE_MAPBOX_TOKEN` in `.env` (step 4).
- **`npm install` fails:** delete `node_modules` and `package-lock.json`, then
  run `npm install` again.
