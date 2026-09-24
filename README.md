# Macro Pulse — Macroeconomic & Investment Dashboard

A comprehensive, zero-friction macroeconomic dashboard built for investment analysis, monitoring yield curves, currency valuations, inflation dynamics across the US and India, and global asset benchmarks.

---

## 📊 Monitored Indicators & Credible Sources

1. **U.S. Treasury Yield Curve & Tenors**:
   - **Maturities**: 1M, 2M, 3M, 4M, 6M, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 20Y, 30Y.
   - **Comparisons**: Today vs. 1 Month Ago vs. 1 Year Ago.
   - **Source**: U.S. Department of the Treasury (`home.treasury.gov`).
2. **Yield Spreads & Inversion Tracker**:
   - **10Y – 2Y Spread**: Tracked historically with a 0 bps recession warning boundary.
3. **Exchange Rates (FX)**:
   - **USD / JPY**: Japanese Yen per USD (historical trajectories, 52-week range).
   - **USD / INR**: Indian Rupee per USD and INR per 100 JPY cross-rate.
   - **Source**: Yahoo Finance & European Central Bank (Frankfurter).
4. **United States Inflation**:
   - **Headline CPI-U** (`CUUR0000SA0`): Consumer Price Index for All Urban Consumers.
   - **Core CPI** (`CUUR0000SA0L1E`): CPI ex-Food and Energy.
   - **Target**: Benchmark Federal Reserve 2.0% annual inflation target.
   - **Source**: U.S. Bureau of Labor Statistics (BLS API v2).
5. **India Inflation**:
   - **Headline CPI-Combined**: Retail inflation.
   - **Consumer Food Price Index (CFPI)**: Food inflation pressure.
   - **Wholesale Price Index (WPI)**: Wholesale & input cost inflation.
   - **Target**: Reserve Bank of India (RBI) 4.0% midpoint target with 2.0%–6.0% tolerance band.
   - **Source**: Ministry of Statistics and Programme Implementation (MoSPI) & Reserve Bank of India (RBI DBIE).
6. **Global Benchmarks & Commodities**:
   - **Equities**: S&P 500 (`^GSPC`), Nasdaq 100 (`^NDX`), India Nifty 50 (`^NSEI`).
   - **Volatility**: CBOE Volatility Index (`^VIX`).
   - **Commodities**: Gold COMEX (`GC=F`), Brent Crude Oil (`BZ=F`), WTI Crude Oil (`CL=F`).

---

## 🚀 How to Use the Dashboard

### 1. Open the Dashboard
Simply double-click **`index.html`** or open it in any modern browser (Chrome, Edge, Firefox, Brave, Safari).
*No web server or complex environment required!*

### 2. Timeframe Range Selector
Use the buttons in the top right to filter all historical timeseries across:
- **1M**: Last 30 days
- **6M**: Last 6 months
- **1Y**: Last 1 year (default)
- **3Y**: Last 3 years
- **5Y**: Last 5 years
- **All**: Complete available historical depth

---

## 🔄 Updating Data (Option A)

### Manual Update (1-Click)
Double-click **`update_dashboard.bat`** in this folder.
- It will pull fresh data from official sources (U.S. Treasury, BLS, MoSPI, Yahoo Finance) and regenerate `data.js` and `macro_data.json` in ~5 seconds.
- Refresh your browser tab to see the updated figures.

### Automated Updates (3 Times a Day)
To schedule automatic updates in Windows Task Scheduler (e.g., at 9:00 AM, 1:00 PM, and 6:00 PM daily):
1. Right-click PowerShell and choose **Run as Administrator**.
2. Run the provided script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup_task_scheduler.ps1
   ```
3. Windows Task Scheduler will now automatically run the data updater 3 times a day in the background.

---

---

## 🌐 Publishing to Netlify

### Option 1: Instant Drag-and-Drop Deploy (30 Seconds)
1. Go to **[app.netlify.com/drop](https://app.netlify.com/drop)** in your browser and sign in (free).
2. Drag and drop this entire project folder (`Macro dashboard`) into the browser window.
3. Your dashboard is immediately live on a global HTTPS URL (e.g. `https://your-site.netlify.app`).
4. In Netlify Site Settings, you can rename the site (e.g. `macro-pulse.netlify.app`) or attach a custom domain.

### Option 2: Continuous Deployment via GitHub (Automated Cloud Updates)
1. Push this folder to a GitHub repository.
2. In Netlify, click **Add new site** -> **Import an existing project** -> connect your repository.
3. The included `.github/workflows/update_data.yml` will automatically refresh the data 3x daily in the cloud and push the updates, triggering automatic re-deployments on Netlify.

---

## 📁 File Structure

- **`index.html`**: Main dashboard interface and layout.
- **`styles.css`**: Design system, responsive grids, and green executive theme.
- **`app.js`**: Core interactive charting (ApexCharts), range filtering, and UI logic.
- **`data.js`**: Auto-generated data file loaded directly by `index.html`.
- **`macro_data.json`**: JSON export of all current metrics and historical series.
- **`fetch_data.py`**: Python script connecting to official APIs (US Treasury, BLS, MoSPI, Yahoo Finance).
- **`update_dashboard.bat`**: Windows batch launcher for 1-click local data updates.
- **`setup_task_scheduler.ps1`**: PowerShell automation script for Windows Task Scheduler.
- **`netlify.toml`**: Netlify deployment configuration and caching headers for fresh data.
- **`.github/workflows/update_data.yml`**: GitHub Actions automated 3x daily cloud data refresh.
