# RestoPOS — Restaurant management for India

Billing with **GST**, table ordering on tablets, kitchen screen, inventory, members, tips & commission, shifts, reports —
in **English · हिन्दी · اردو** with an instant language switch. Works **offline on the restaurant Wi-Fi** or **online** (Netlify + Supabase).
No build step, no npm packages. Needs only **Node.js 18+** on the one computer that acts as the server.

## 1. Quick start (local Wi-Fi server)
```
Windows:  double-click start.bat           Linux/Mac:  ./start.sh
Per client (separate data):  start.bat sharma     ./start.sh sharma    (data in clients/sharma/)
```
The console prints the addresses, e.g. `http://192.168.1.20:3000`. Open that on every tablet/phone/PC on the same Wi-Fi.
First visit runs a 1-minute setup (restaurant name, GSTIN, state, GST scheme, admin PIN, optional demo data).
Tip: give the server PC a fixed IP in your router so the address never changes. Allow Node through the Windows firewall (private network).
Several clients on one PC: `node tools/new-client.js <name> <port>` then `node server.js --client <name>`.

**Installer:** Windows – double-click `install.bat` (installs to C:\RestoPOS, opens the firewall, starts at boot, adds a desktop shortcut; `uninstall.bat` removes it, data kept unless you type DELETE). Linux – `sudo ./install.sh [client] [port]` (systemd). Re-running upgrades in place and keeps the data.

## 2. Devices
Admin → Screens → *Current mode of this device*:
- **Staff device** – waiters (carry a tablet), cashier, manager, admin. Sign in with PIN (or username + password).
- **Table tablet** – locked to one table; guests browse, order, call waiter, ask for bill. Big **EN | हिं | اردو** switch; resets to the default language after idle. Staff PIN (or long-press the restaurant name 1.5 s) to exit.
- **Kitchen screen** – tickets only, per kitchen station, sound alerts, amber/red timers.
- **Guest QR** – print Table QR cards (Admin → Tables); guests on their own phone (same Wi-Fi) open the table page.
Orders from tables can require waiter approval (Admin → Ordering). Waiters are assigned to tables/areas; guest calls go to the assigned waiter.
Touch keyboard: ⌨ button (Auto / On / Off); mouse and physical keyboard work everywhere.

## 3. GST & billing
- Schemes: Regular (tax invoice), Composition (bill of supply), Not registered. Rates per dish (0, 0.25, 3, 5, 12, 18, 28, 40 %), HSN/SAC, prices inclusive or exclusive.
- CGST+SGST, or IGST when a B2B customer's GSTIN is in another state. Service charge, packaging and delivery are taxed at the goods' rate.
- Member discount (card no. → %), manual discount, round-off options, split payments, UPI QR on the bill, tips.
- Invoice series per financial year (`INV/26-27/00001`), restarting 1 April (switchable).
- Reports (Reports → GST): GSTR-1-shaped CSV for B2B, B2CS, HSN summary, documents issued, invoice register. **Always have your CA review the figures and rates before filing**; the sample rates in the demo data are examples.

## 4. Members, tips, commission
Members → add card numbers (the pre-printed number), discount %, plan, expiry. Type or scan the number while billing.
Tips go to the serving waiter or a shared pool; commission is per staff member / default / per dish (and for delivery partners such as Zomato, Swiggy, agents). Reports → Staff earnings shows what is due, and payouts are recorded there.

## 5. Printing (thermal, laser, inkjet, any paper size)
Admin → Printing. Presets: 58/76/80/112 mm rolls, A3–A6, B5, Letter, Legal, custom. Choose per device:
- **System print dialog** – any printer incl. PDF. For one-click printing launch Chrome with `--kiosk-printing` (see `open-kiosk-printing.bat`) with the printer as default.
- **Direct to LAN thermal printer** – enter the printer's IP (port 9100); the server sends ESC/POS (works for Hindi/Urdu text). Optional cutter and cash-drawer pulse.
- Kitchen tickets can auto-print per station. Bills print in English, हिन्दी, اردو or two languages together.

## 6. Provider panel (for you, the software provider)
Open `http://<server>:3000/#/provider` (or Admin → Provider) → password. Per client you can switch features/sections on and off, set an expiry date, limit staff logins and tables, suspend the client with a message, and add notes. Changes reach all devices within seconds.
Change the password: `node tools/set-provider-password.js "NewPassword"`, then run the printed SQL in Supabase and redeploy. **Default password: `Ziyad@2023` — change it before you hand the software to anyone.**
Note: with the local server the password is verified on the server and cannot be bypassed from a browser. In standalone (no server) mode the licence controls are only a convenience — a technical user could bypass them.

## 7. Online mode: Netlify + Supabase
1. Supabase: new project → SQL Editor → run `supabase/schema.sql`. Create one user per restaurant and set its `client_id` (instructions at the bottom of that file).
2. Put the project URL and *anon public key* in `public/config.js` (or enter them later at Admin → Sync).
3. Netlify: drag the `public` folder (or connect the repo; `netlify.toml` is included). HTTPS is automatic, so the app can be installed to the home screen and works offline (service worker).
4. Open the Netlify address, sign in with the restaurant account, then the staff PIN.
Mix: the local server can also mirror to Supabase for off-site backup/remote view (Admin → Sync → *Connect to online database*).
Cloud-only caveat: invoice numbers are allocated by the device that bills; if two devices bill while offline the series can collide. For strict gap-free numbering use the local server.

## 8. Backups
Daily automatic copy in the data folder (last 30 days) plus Admin → Backup & restore (download / restore). Copy `clients/<name>` for a full migration.

## 9. Folder map
`server.js` local server · `public/` the web app (deploy this to Netlify) · `supabase/schema.sql` · `tools/` helpers · `start.*` launchers.
Translations: `public/js/hi.js`, `ur.js` (English text is the key; missing entries show English — add lines freely).

## 10. Payments, rewards, WhatsApp, online orders, 3D (new)

Configure all of this in **Admin → Rewards & integrations**. Provider feature ids to switch on/off per client: `loyalty`, `coupons`, `whatsapp`, `terminal`, `ar3d`, `online_orders`.

- **UPI QR**: enter your UPI id once; the pay dialog makes a QR with the exact bill amount and shows it on the customer display (`#/pay/<orderId>`) and on the table tablet.
- **Card / swipe machine**: a generic HTTP relay (`/api/terminal`) with URL templates using `{amount} {amount_paise} {order} {ref} {upi_vpa} {name} {upi_link}`. Match it to your machine vendor's API. Not tested against real hardware.
- **Cash**: type the amount received; the change to return is calculated.
- **Rewards points, mandatory mobile number, coupons**: each is optional in settings. Points follow the 10-digit mobile number.
- **WhatsApp**: Cloud API (token kept on the server) or wa.me click-to-chat links.
- **Auto translation**: Hindi/Urdu are filled automatically (needs internet); dish names use the Auto-translate / Translate missing buttons.
- **Online orders (Zomato/Swiggy etc.)**: these platforms have no public API. Send orders to `POST /api/online-order?key=<your key>` through an integrator (Petpooja, UrbanPiper, Zapier) or paste JSON manually in the Online page; Accept creates the delivery order and KOT. For webhooks the server must be reachable from the internet (tunnel).
- **3D / AR on the table**: "View in 3D on your table" opens the camera with a food model overlay (not surface-tracked). Browsers allow the camera only on https: the server also starts **https on port PORT+443** (3443 by default) with a self-signed certificate (auto-made with openssl, or run `node tools/make-cert.js`). Open that address on the tablet and accept the one-time warning. A custom `.glb` per dish can be set in the dish editor.

## 11. Setup is central; kitchen display-only

- The "Set up your restaurant" screen appears only on the server computer (http://localhost). Tablets and phones on the Wi-Fi show "Waiting for restaurant setup" until it is done, then load everything from the server.
- **Kitchen display only:** open `http://<server-ip>:3000/#/kds` on any screen (wall TV, spare tablet). It shows live tickets with no buttons and no sign-in. Or set a device to Kitchen screen and tick "Display only" in Admin → This device.

## 12. Activation (trial → yearly / lifetime)

- A new restaurant starts a **30-day free trial by itself** when it is set up. A banner shows the days left.
- After the trial the app shows "Free trial ended". The provider opens `#/provider`, enters the provider password and presses **Activate yearly (+1 year)** or **Activate lifetime** (or sets the date manually). Applies to every tablet within seconds.
- Change the password: `node tools/set-provider-password.js "NewPassword"` (and run the printed SQL in Supabase).
- **Before publishing on GitHub:** this repo contains the *hash* of the provider password (`provider.json`, `public/js/provider-hash.js`, `supabase/schema.sql`). Use a **private** repository, or set a long new password first. Anyone with the source can also edit the code to remove the check, so activation protects against ordinary users, not against a determined developer; the licence file is your legal protection.

## 13. Publishing to GitHub

```
cd restopos
git init && git add . && git commit -m "RestoPOS 1.0"
git branch -M main
git remote add origin https://github.com/<you>/restopos.git
git push -u origin main
```
Client data (`data/`, `clients/*`) and certificates are git-ignored. Netlify can deploy straight from the repo (`netlify.toml` is included).

## 14. Update check

- RestoPOS asks GitHub once a day (managers/admins only, never on table or kitchen screens) whether a newer **release** exists and shows an "Update available" pop-up with the release notes and a Download button. Skip-this-version and Later are remembered. Offline or no repository set = stays silent.
- Set your repository once: put `"repository": "your-user/restopos"` in `package.json` (clients can also type it in Admin → Sync & backup → Software updates, where "Check for updates now" is also available). Cloud (Netlify) builds can use `updateRepo` in `public/config.js`.
- To publish an update: bump `version` in `package.json` **and** `public/js/version.js`, push, and create a GitHub Release tagged `v1.1.0` (tags alone also work). Private repos need `GITHUB_TOKEN` set on the server computer.
- Installing an update stays manual and safe: download, copy over the old folder (keep `data/` and `clients/`), restart.

## Known limits
Hindi/Urdu cover guest, waiter, kitchen, billing, report and common admin screens; some long admin help texts remain English. Fonts use system fonts (Noto/Nastaliq on the device). Test with your printer model before go-live.
