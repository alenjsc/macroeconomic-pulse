/**
 * app.js - Macroeconomic Dashboard Core Logic
 * Handles data binding, timeframe range slicing, ApexCharts orchestration, and interactive tabs.
 */

// Global Chart Registry
const chartInstances = {};
let currentRange = '1Y';
let currentTab = 'overview';

// Helper: Format numbers
function fmt(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return Number(num).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function round(val, dec = 2) {
    const m = Math.pow(10, dec);
    return Math.round(val * m) / m;
}

// Helper: Filter timeseries by selected range
function filterSeriesByRange(dataArray, range, dateKey = 'date') {
    if (!dataArray || !dataArray.length) return [];
    if (range === 'ALL') return dataArray;

    const latestItem = dataArray[dataArray.length - 1];
    const latestDate = new Date(latestItem[dateKey]);
    
    let daysToSubtract = 365;
    if (range === '1M') daysToSubtract = 30;
    else if (range === '6M') daysToSubtract = 180;
    else if (range === '1Y') daysToSubtract = 365;
    else if (range === '3Y') daysToSubtract = 365 * 3;
    else if (range === '5Y') daysToSubtract = 365 * 5;

    const cutoffDate = new Date(latestDate.getTime() - (daysToSubtract * 24 * 60 * 60 * 1000));
    const filtered = dataArray.filter(item => new Date(item[dateKey]) >= cutoffDate);
    return filtered.length > 0 ? filtered : dataArray;
}

/**
 * Filter and aggregate inflation series based on user requested rules:
 * - 1M / 6M: last 6 months (monthly)
 * - 1Y: last 12 months (monthly)
 * - 3Y: Quarterly (Mar, Jun, Sep, Dec) over last 3 years
 * - 5Y: Six-monthly (Jun & Dec) over last 5 years
 * - ALL: Annually selecting July (mid-year)
 */
function getAggregatedInflationData(historyArray, range) {
    if (!historyArray || !historyArray.length) return [];

    const parsed = historyArray.map(item => {
        const parts = item.period.split('-');
        const yr = parseInt(parts[0], 10);
        const mo = parseInt(parts[1], 10);
        return { ...item, yr, mo };
    });

    if (range === '1M' || range === '6M') {
        return parsed.slice(-6);
    } else if (range === '1Y') {
        return parsed.slice(-12);
    } else if (range === '3Y') {
        // Last 3 years: March (3), June (6), September (9), December (12)
        const recent3Y = parsed.filter(d => d.yr >= (2026 - 2));
        const quarterly = recent3Y.filter(d => [3, 6, 9, 12].includes(d.mo));
        return quarterly.length >= 4 ? quarterly : recent3Y.slice(-12);
    } else if (range === '5Y') {
        // Last 5 years: Six-monthly (June = 6, December = 12)
        const recent5Y = parsed.filter(d => d.yr >= (2026 - 4));
        const sixMonthly = recent5Y.filter(d => [6, 12].includes(d.mo));
        // If latest print is mid-year (e.g. Aug 2026), include June 2026
        return sixMonthly.length >= 4 ? sixMonthly : recent5Y;
    } else {
        // ALL: Annually, selecting July (mid-year: mo === 7)
        const annualJuly = parsed.filter(d => d.mo === 7);
        return annualJuly.length >= 2 ? annualJuly : parsed;
    }
}

// Helper: Safe mount/update chart
function registerChart(chartId, chartOptions) {
    const el = document.getElementById(chartId);
    if (!el) return;

    // Destroy existing instance cleanly
    if (chartInstances[chartId]) {
        try {
            chartInstances[chartId].destroy();
        } catch (e) {
            console.warn(`Error destroying ${chartId}:`, e);
        }
        delete chartInstances[chartId];
    }

    // Always clear DOM container to prevent SVG overlap
    el.innerHTML = '';

    // Enforce dataLabels: { enabled: false } globally across all charts
    chartOptions.dataLabels = { enabled: false };

    // Standard responsive chart sizing
    if (!chartOptions.chart) chartOptions.chart = {};
    chartOptions.chart.width = '100%';
    chartOptions.chart.fontFamily = "'Inter', -apple-system, sans-serif";

    // Standard tooltip
    if (!chartOptions.tooltip) {
        chartOptions.tooltip = {
            enabled: true,
            shared: true,
            intersect: false
        };
    } else {
        chartOptions.tooltip.enabled = true;
    }

    const chart = new ApexCharts(el, chartOptions);
    chartInstances[chartId] = chart;
    chart.render();
}

// ==============================================================================
// 1. DATA INITIALIZATION & KPI POPULATION
// ==============================================================================
function initDashboard() {
    if (typeof MACRO_DATA === 'undefined') {
        console.error("MACRO_DATA is not defined. Ensure data.js is loaded properly.");
        document.getElementById('sidebarStatusText').textContent = "Data load error";
        return;
    }

    const { meta, treasury, india_rates, us_inflation, india_inflation, markets } = MACRO_DATA;

    // Sidebar footer dual timezone timestamps (IST & ET)
    if (meta) {
        updateSidebarTimestamps(meta);
    }

    // Populate Top Executive KPIs (2x4 Matrix: 8 Cards)
    populateKPIs(treasury, us_inflation, india_inflation, markets);

    // Populate Inversion Alert Banner & Tenors Strip
    populateTreasuryDetails(treasury);

    // Populate India Sovereign & Repo Badges
    populateIndiaRates(india_rates);

    // Populate Tables
    populateBenchmarksTable(markets);
    populateInflationTable(us_inflation, india_inflation);

    // Render All Charts for the active tab
    renderChartsForTab(currentTab);

    // Setup Event Listeners
    setupEventListeners();
}

function updateSidebarTimestamps(meta) {
    const elStatus = document.getElementById('sidebarStatusText');
    if (elStatus) elStatus.textContent = 'Macro Data Feed';

    const elIst = document.getElementById('sidebarTimeIST');
    const elEt = document.getElementById('sidebarTimeET');

    // 1. If pre-computed in fetch_data.py
    if (meta.display_time_ist && meta.display_time_et) {
        if (elIst) elIst.textContent = meta.display_time_ist;
        if (elEt) elEt.textContent = meta.display_time_et;
        return;
    }

    // 2. Dynamic browser formatting of UTC timestamp
    const utcStr = meta.generated_at_utc || meta.display_time;
    if (!utcStr) return;

    try {
        let isoStr = utcStr;
        if (utcStr.includes(' UTC')) {
            isoStr = utcStr.replace(' UTC', 'Z').replace(' ', 'T');
        }
        const dt = new Date(isoStr);

        if (!isNaN(dt.getTime())) {
            const istFormatted = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }).format(dt);

            const etFormatted = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/New_York',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }).format(dt);

            if (elIst) elIst.textContent = istFormatted;
            if (elEt) elEt.textContent = etFormatted;
            return;
        }
    } catch (e) {
        console.warn('Error formatting timestamps:', e);
    }

    if (elIst) elIst.textContent = meta.display_time || meta.generated_at_utc || '—';
    if (elEt) elEt.textContent = '—';
}

function populateKPIs(treasury, us_inf, ind_inf, markets) {
    // 1. 10Y Yield
    if (treasury) {
        document.getElementById('kpi10YVal').textContent = fmt(treasury.current_10y, 2);
        const delta10 = treasury.delta_10y;
        const d10El = document.getElementById('kpi10YDelta');
        d10El.className = `delta-pill ${delta10 > 0 ? 'delta-up' : delta10 < 0 ? 'delta-down' : 'delta-flat'}`;
        d10El.innerHTML = `${delta10 >= 0 ? '+' : ''}${fmt(delta10 * 100, 1)} bps`;

        // 2. 10Y - 2Y Spread
        const spreadBps = Math.round(treasury.current_spread_10_2 * 100);
        document.getElementById('kpiSpreadVal').textContent = `${spreadBps > 0 ? '+' : ''}${spreadBps}`;
        const spreadBadge = document.getElementById('kpiSpreadBadge');
        if (treasury.is_inverted) {
            spreadBadge.className = 'kpi-badge badge-danger';
            spreadBadge.textContent = 'Inverted';
        } else {
            spreadBadge.className = 'kpi-badge badge-success';
            spreadBadge.textContent = 'Normal';
        }
        const deltaSpread = treasury.delta_spread_10_2;
        const dSpEl = document.getElementById('kpiSpreadDelta');
        dSpEl.className = `delta-pill ${deltaSpread > 0 ? 'delta-up' : deltaSpread < 0 ? 'delta-down' : 'delta-flat'}`;
        dSpEl.innerHTML = `${deltaSpread >= 0 ? '+' : ''}${fmt(deltaSpread * 100, 1)} bps`;
    }

    // 3. USD / JPY
    const jpy = markets && markets.USD_JPY;
    if (jpy) {
        document.getElementById('kpiJpyVal').textContent = fmt(jpy.current_price, 2);
        const jpyEl = document.getElementById('kpiJpyDelta');
        jpyEl.className = `delta-pill ${jpy.pct_change >= 0 ? 'delta-up' : 'delta-down'}`;
        jpyEl.innerHTML = `${jpy.pct_change >= 0 ? '+' : ''}${fmt(jpy.pct_change, 2)}%`;
        const jBadge = document.getElementById('jpyCurrentBadge');
        if (jBadge) jBadge.textContent = `${fmt(jpy.current_price, 2)} ¥`;
    }

    // 4. USD / INR
    const inr = markets && markets.USD_INR;
    if (inr) {
        document.getElementById('kpiInrVal').textContent = fmt(inr.current_price, 2);
        const inrEl = document.getElementById('kpiInrDelta');
        inrEl.className = `delta-pill ${inr.pct_change >= 0 ? 'delta-up' : 'delta-down'}`;
        inrEl.innerHTML = `${inr.pct_change >= 0 ? '+' : ''}${fmt(inr.pct_change, 2)}%`;
        const inrBadge = document.getElementById('inrCurrentBadge');
        if (inrBadge) inrBadge.textContent = `${fmt(inr.current_price, 2)} ₹`;
    }

    // EUR and GBP Badges
    const eur = markets && markets.EUR_USD;
    if (eur) {
        const eurBadge = document.getElementById('eurCurrentBadge');
        if (eurBadge) eurBadge.textContent = `$${fmt(eur.current_price, 4)}`;
    }
    const gbp = markets && markets.GBP_USD;
    if (gbp) {
        const gbpBadge = document.getElementById('gbpCurrentBadge');
        if (gbpBadge) gbpBadge.textContent = `$${fmt(gbp.current_price, 4)}`;
    }

    // 5. US CPI
    if (us_inf) {
        document.getElementById('kpiUsCpiVal').textContent = fmt(us_inf.headline_cpi_yoy, 2);
        const usCpiEl = document.getElementById('kpiUsCpiDelta');
        usCpiEl.className = `delta-pill ${us_inf.delta_headline > 0 ? 'delta-down' : 'delta-up'}`;
        usCpiEl.innerHTML = `${us_inf.delta_headline >= 0 ? '+' : ''}${fmt(us_inf.delta_headline, 2)}% MoM`;
        document.getElementById('kpiUsCpiPeriod').textContent = us_inf.latest_label;
    }

    // 6. India CPI
    if (ind_inf) {
        document.getElementById('kpiIndiaCpiVal').textContent = fmt(ind_inf.cpi_combined, 2);
        const indCpiEl = document.getElementById('kpiIndiaCpiDelta');
        indCpiEl.className = `delta-pill ${ind_inf.delta_cpi_combined > 0 ? 'delta-down' : 'delta-up'}`;
        indCpiEl.innerHTML = `${ind_inf.delta_cpi_combined >= 0 ? '+' : ''}${fmt(ind_inf.delta_cpi_combined, 2)}% MoM`;
        document.getElementById('kpiIndiaCpiPeriod').textContent = ind_inf.latest_label;
    }

    // 7. Gold (COMEX) - Daily Change
    const gold = markets && markets.GOLD;
    if (gold) {
        const gValEl = document.getElementById('kpiGoldVal');
        if (gValEl) gValEl.textContent = fmt(gold.current_price, 1);
        const gDeltaEl = document.getElementById('kpiGoldDelta');
        if (gDeltaEl) {
            gDeltaEl.className = `delta-pill ${gold.pct_change >= 0 ? 'delta-up' : 'delta-down'}`;
            gDeltaEl.innerHTML = `${gold.pct_change >= 0 ? '+' : ''}${fmt(gold.pct_change, 2)}%`;
        }
    }

    // 8. Brent Crude Oil - Daily Change
    const brent = markets && markets.BRENT_OIL;
    if (brent) {
        const bValEl = document.getElementById('kpiBrentVal');
        if (bValEl) bValEl.textContent = fmt(brent.current_price, 2);
        const bDeltaEl = document.getElementById('kpiBrentDelta');
        if (bDeltaEl) {
            bDeltaEl.className = `delta-pill ${brent.pct_change >= 0 ? 'delta-up' : 'delta-down'}`;
            bDeltaEl.innerHTML = `${brent.pct_change >= 0 ? '+' : ''}${fmt(brent.pct_change, 2)}%`;
        }
    }

    // FX 52-Week Ranges for JPY, INR, EUR, GBP
    const calc52Range = (asset) => {
        if (!asset || !asset.timeseries || !asset.timeseries.length) return '—';
        const prices = asset.timeseries.slice(-252).map(p => p.price);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        return { minP, maxP };
    };

    if (jpy) {
        const r = calc52Range(jpy);
        const el = document.getElementById('fxJpyRange');
        if (el && r !== '—') el.textContent = `${fmt(r.minP, 1)} – ${fmt(r.maxP, 1)} ¥`;
    }
    if (inr) {
        const r = calc52Range(inr);
        const el = document.getElementById('fxInrRange');
        if (el && r !== '—') el.textContent = `${fmt(r.minP, 2)} – ${fmt(r.maxP, 2)} ₹`;
    }
    if (eur) {
        const r = calc52Range(eur);
        const el = document.getElementById('fxEurRange');
        if (el && r !== '—') el.textContent = `$${fmt(r.minP, 3)} – $${fmt(r.maxP, 3)}`;
    }
    if (gbp) {
        const r = calc52Range(gbp);
        const el = document.getElementById('fxGbpRange');
        if (el && r !== '—') el.textContent = `$${fmt(r.minP, 3)} – $${fmt(r.maxP, 3)}`;
    }
}

function populateTreasuryDetails(treasury) {
    if (!treasury) return;

    // Inversion banner
    const banner = document.getElementById('inversionBanner');
    const heading = document.getElementById('inversionHeading');
    const desc = document.getElementById('inversionDescription');
    const badge = document.getElementById('inversionSpreadBadge');
    const icon = document.getElementById('inversionIcon');

    const spreadBps = Math.round(treasury.current_spread_10_2 * 100);
    badge.textContent = `${spreadBps >= 0 ? '+' : ''}${spreadBps} bps`;

    if (treasury.is_inverted) {
        banner.className = 'inversion-alert inverted';
        icon.className = 'fa-solid fa-triangle-exclamation';
        heading.textContent = 'Yield Curve Inverted (Recession Warning)';
        desc.textContent = `The 2-Year yield (${treasury.current_2y}%) exceeds the 10-Year yield (${treasury.current_10y}%). Curve inversions have historically preceded economic slowdowns.`;
    } else {
        banner.className = 'inversion-alert normal';
        icon.className = 'fa-solid fa-circle-check';
        heading.textContent = 'Normal Upward Sloping Yield Curve';
        desc.textContent = `The 10-Year yield (${treasury.current_10y}%) trades at a premium of +${spreadBps} bps over the 2-Year yield (${treasury.current_2y}%).`;
    }

    // Tenor Strip Ribbon (13 Tenors fitting horizontally)
    const strip = document.getElementById('tenorStripContainer');
    if (!strip || !treasury.current_curve) return;

    strip.innerHTML = '';
    const highlightedTenors = ['2Y', '10Y', '30Y'];
    treasury.current_curve.forEach(item => {
        const isHighlight = highlightedTenors.includes(item.tenor);
        const box = document.createElement('div');
        box.className = `tenor-box ${isHighlight ? 'highlight' : ''}`;
        box.innerHTML = `
            <div class="tenor-name">${item.tenor}</div>
            <div class="tenor-rate">${fmt(item.rate, 2)}%</div>
        `;
        strip.appendChild(box);
    });
}

function populateIndiaRates(india_rates) {
    if (!india_rates) return;
    const badge10y = document.getElementById('india10yCurrentBadge');
    if (badge10y && india_rates.current_10y !== undefined) {
        badge10y.textContent = `10Y: ${fmt(india_rates.current_10y, 2)}%`;
    }
    const badgeRepo = document.getElementById('rbiRepoBadge');
    if (badgeRepo && india_rates.current_repo_rate !== undefined) {
        badgeRepo.textContent = `Repo: ${fmt(india_rates.current_repo_rate, 2)}%`;
    }
}

function populateBenchmarksTable(markets) {
    const tbody = document.querySelector('#overviewBenchmarksTable tbody');
    if (!tbody || !markets) return;

    tbody.innerHTML = '';
    Object.keys(markets).forEach(key => {
        const asset = markets[key];
        const isPos1M = (asset.month_pct_change !== undefined ? asset.month_pct_change : asset.pct_change) >= 0;
        const mAbs = asset.month_abs_change !== undefined ? asset.month_abs_change : asset.abs_change;
        const mPct = asset.month_pct_change !== undefined ? asset.month_pct_change : asset.pct_change;
        
        let rangePct = 50;
        if (asset.timeseries && asset.timeseries.length) {
            const lastYear = asset.timeseries.slice(-252).map(p => p.price);
            const min = Math.min(...lastYear);
            const max = Math.max(...lastYear);
            if (max > min) {
                rangePct = Math.round(((asset.current_price - min) / (max - min)) * 100);
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="asset-cell">
                    <div class="asset-icon-badge">${asset.name.substring(0, 2)}</div>
                    <div>
                        <strong>${asset.name}</strong>
                        <div style="font-size: 11px; color: var(--text-muted);">${asset.symbol}</div>
                    </div>
                </div>
            </td>
            <td><span class="kpi-badge badge-neutral">${asset.category}</span></td>
            <td><strong>${fmt(asset.current_price, 2)}</strong> <span style="font-size: 11px; color: var(--text-muted);">${asset.unit}</span></td>
            <td><span class="${isPos1M ? 'delta-up' : 'delta-down'}" style="padding: 2px 6px; border-radius: 4px; font-weight: 600;">${isPos1M ? '+' : ''}${fmt(mAbs, 2)}</span></td>
            <td><span class="${isPos1M ? 'delta-up' : 'delta-down'}" style="padding: 2px 6px; border-radius: 4px; font-weight: 600;">${isPos1M ? '+' : ''}${fmt(mPct, 2)}%</span></td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; position: relative;">
                        <div style="width: ${Math.min(100, Math.max(0, rangePct))}%; height: 100%; background: var(--color-primary); border-radius: 3px;"></div>
                    </div>
                    <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); min-width: 32px;">${rangePct}%</span>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populateInflationTable(us_inf, ind_inf) {
    const tbody = document.getElementById('inflationSummaryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = [];
    if (us_inf) {
        rows.push({
            region: '🇺🇸 United States',
            name: 'Headline CPI-U',
            latest: `${fmt(us_inf.headline_cpi_yoy, 2)}%`,
            prev: `${fmt(us_inf.headline_cpi_yoy - us_inf.delta_headline, 2)}%`,
            delta: us_inf.delta_headline,
            target: '2.0% (Fed)',
            status: us_inf.headline_cpi_yoy <= 2.5 ? 'Moderate' : 'Above Target',
            badgeClass: us_inf.headline_cpi_yoy <= 2.5 ? 'badge-success' : 'badge-warning'
        });
        rows.push({
            region: '🇺🇸 United States',
            name: 'Core CPI (ex Food/Energy)',
            latest: `${fmt(us_inf.core_cpi_yoy, 2)}%`,
            prev: `${fmt(us_inf.core_cpi_yoy - us_inf.delta_core, 2)}%`,
            delta: us_inf.delta_core,
            target: '2.0% (Fed Core)',
            status: us_inf.core_cpi_yoy <= 2.5 ? 'Moderate' : 'Sticky',
            badgeClass: us_inf.core_cpi_yoy <= 2.5 ? 'badge-success' : 'badge-warning'
        });
    }

    if (ind_inf) {
        rows.push({
            region: '🇮🇳 India',
            name: 'CPI-Combined (Retail)',
            latest: `${fmt(ind_inf.cpi_combined, 2)}%`,
            prev: `${fmt(ind_inf.cpi_combined - ind_inf.delta_cpi_combined, 2)}%`,
            delta: ind_inf.delta_cpi_combined,
            target: '4.0% ± 2.0% (RBI)',
            status: ind_inf.cpi_combined <= 6.0 ? 'Within Tolerance Band' : 'Above RBI Band',
            badgeClass: ind_inf.cpi_combined <= 6.0 ? 'badge-success' : 'badge-danger'
        });
        rows.push({
            region: '🇮🇳 India',
            name: 'Consumer Food Price Index (CFPI)',
            latest: `${fmt(ind_inf.cfpi_food, 2)}%`,
            prev: `${fmt(ind_inf.cfpi_food - ind_inf.delta_cfpi_food, 2)}%`,
            delta: ind_inf.delta_cfpi_food,
            target: 'Food Volatility Watch',
            status: ind_inf.cfpi_food > 7.0 ? 'High Food Pressure' : 'Normal',
            badgeClass: ind_inf.cfpi_food > 7.0 ? 'badge-danger' : 'badge-neutral'
        });
        rows.push({
            region: '🇮🇳 India',
            name: 'Wholesale Price Index (WPI)',
            latest: `${fmt(ind_inf.wpi, 2)}%`,
            prev: `${fmt(ind_inf.wpi - ind_inf.delta_wpi, 2)}%`,
            delta: ind_inf.delta_wpi,
            target: 'Wholesale / Pipeline',
            status: ind_inf.wpi > 5.0 ? 'Elevated Inputs' : 'Muted Inputs',
            badgeClass: ind_inf.wpi > 5.0 ? 'badge-warning' : 'badge-success'
        });
    }

    rows.forEach(r => {
        const isUp = r.delta > 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${r.region}</strong></td>
            <td>${r.name}</td>
            <td><strong>${r.latest}</strong></td>
            <td>${r.prev}</td>
            <td><span class="${isUp ? 'delta-down' : 'delta-up'}" style="padding: 2px 6px; border-radius: 4px; font-weight: 600;">${isUp ? '+' : ''}${fmt(r.delta, 2)}%</span></td>
            <td>${r.target}</td>
            <td><span class="kpi-badge ${r.badgeClass}">${r.status}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// ==============================================================================
// 2. APEXCHARTS RENDER ENGINE
// ==============================================================================

function renderChartsForTab(tabName) {
    if (typeof MACRO_DATA === 'undefined') return;

    const { treasury, india_rates, us_inflation, india_inflation, markets } = MACRO_DATA;

    if (tabName === 'overview') {
        renderOverviewYieldCurve(treasury);
        renderOverviewSpread(treasury);
        renderOverviewFx(markets);
        renderOverviewInflation(us_inflation, india_inflation);
    } else if (tabName === 'yields') {
        renderDetailedYieldCurve(treasury);
        renderTenorsHistory(treasury);
        renderDetailedSpreadHistory(treasury);
        renderIndiaGsecHistory(india_rates);
        renderRbiRepoHistory(india_rates);
    } else if (tabName === 'fx') {
        renderUsdJpyDetailed(markets.USD_JPY);
        renderUsdInrDetailed(markets.USD_INR);
        renderEurUsdDetailed(markets.EUR_USD);
        renderGbpUsdDetailed(markets.GBP_USD);
    } else if (tabName === 'inflation') {
        renderUsInflationDetailed(us_inflation);
        renderIndiaInflationDetailed(india_inflation);
    } else if (tabName === 'benchmarks') {
        renderEquitiesComparison(markets);
        renderVixDetailed(markets.VIX);
        renderGoldDetailed(markets.GOLD);
        renderOilDetailed(markets.BRENT_OIL, markets.WTI_OIL);
    }
}

// --- OVERVIEW CHARTS ---
function renderOverviewYieldCurve(treasury) {
    if (!treasury || !treasury.current_curve) return;

    const categories = treasury.current_curve.map(c => c.tenor);
    const series = [
        {
            name: `Current (${treasury.latest_date})`,
            data: treasury.current_curve.map(c => c.rate)
        }
    ];

    if (treasury.curve_1m_ago && treasury.curve_1m_ago.length) {
        series.push({
            name: `1M Ago (${treasury.date_1m_ago || '1M'})`,
            data: treasury.curve_1m_ago.map(c => c.rate)
        });
    }

    if (treasury.curve_1y_ago && treasury.curve_1y_ago.length) {
        series.push({
            name: `1Y Ago (${treasury.date_1y_ago || '1Y'})`,
            data: treasury.curve_1y_ago.map(c => c.rate)
        });
    }

    const options = {
        chart: {
            type: 'line',
            height: 330,
            toolbar: { show: false }
        },
        colors: ['#059669', '#34d399', '#94a3b8'],
        stroke: { curve: 'smooth', width: [3.5, 2, 2], dashArray: [0, 2, 4] },
        markers: { size: [4, 3, 3] },
        xaxis: {
            categories: categories,
            labels: { style: { colors: '#64748b', fontSize: '11px' } }
        },
        yaxis: {
            labels: {
                formatter: val => `${val.toFixed(2)}%`,
                style: { colors: '#64748b' }
            }
        },
        tooltip: {
            y: { formatter: val => `${val.toFixed(2)}%` }
        },
        grid: { borderColor: '#f1f5f9' },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 10 } },
        series: series
    };

    registerChart('chart-overview-curve', options);
}

function renderOverviewSpread(treasury) {
    if (!treasury || !treasury.history) return;

    const filtered = filterSeriesByRange(treasury.history, currentRange, 'date');
    const seriesData = filtered.map(item => ({
        x: new Date(item.date).getTime(),
        y: item.spread_10_2 !== null ? item.spread_10_2 : null
    }));

    const minTs = seriesData.length ? seriesData[0].x : undefined;
    const maxTs = seriesData.length ? seriesData[seriesData.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'area',
            height: 330,
            toolbar: { show: false }
        },
        colors: ['#059669'],
        stroke: { curve: 'straight', width: 2 },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.35,
                opacityTo: 0.05,
                stops: [0, 90, 100]
            }
        },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: {
                formatter: val => `${(val * 100).toFixed(0)} bps`,
                style: { colors: '#64748b' }
            }
        },
        annotations: {
            yaxis: [{
                y: 0,
                borderColor: '#ef4444',
                strokeDashArray: 3,
                label: {
                    borderColor: '#ef4444',
                    style: { color: '#fff', background: '#ef4444', fontSize: '10px' },
                    text: 'Inversion Boundary (0 bps)'
                }
            }]
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${(val * 100).toFixed(1)} bps` }
        },
        grid: { borderColor: '#f1f5f9' },
        series: [{ name: '10Y - 2Y Spread', data: seriesData }]
    };

    registerChart('chart-overview-spread', options);
}

function renderOverviewFx(markets) {
    if (!markets || !markets.USD_JPY || !markets.USD_INR) return;

    const jpyData = filterSeriesByRange(markets.USD_JPY.timeseries, currentRange, 'date');
    const inrData = filterSeriesByRange(markets.USD_INR.timeseries, currentRange, 'date');

    const baseJpy = jpyData.length ? jpyData[0].price : 1;
    const baseInr = inrData.length ? inrData[0].price : 1;

    const seriesJpy = jpyData.map(d => ({
        x: new Date(d.date).getTime(),
        y: round(((d.price / baseJpy) - 1.0) * 100, 2)
    }));

    const seriesInr = inrData.map(d => ({
        x: new Date(d.date).getTime(),
        y: round(((d.price / baseInr) - 1.0) * 100, 2)
    }));

    const minTs = seriesJpy.length ? seriesJpy[0].x : undefined;
    const maxTs = seriesJpy.length ? seriesJpy[seriesJpy.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'line',
            height: 330,
            toolbar: { show: false }
        },
        colors: ['#10b981', '#047857'],
        stroke: { curve: 'smooth', width: 2.2 },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: {
                formatter: val => `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`,
                style: { colors: '#64748b' }
            }
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${val >= 0 ? '+' : ''}${val.toFixed(2)}% vs Range Start` }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: 'USD / JPY (% Move)', data: seriesJpy },
            { name: 'USD / INR (% Move)', data: seriesInr }
        ]
    };

    registerChart('chart-overview-fx', options);
}

function renderOverviewInflation(us_inf, ind_inf) {
    if (!us_inf || !ind_inf) return;

    // Filter both histories using the specified aggregation logic
    const filteredUs = getAggregatedInflationData(us_inf.history, currentRange);
    const filteredInd = getAggregatedInflationData(ind_inf.history, currentRange);

    const usMap = {};
    filteredUs.forEach(item => { usMap[item.period] = item.headline_cpi_yoy; });

    const indMap = {};
    filteredInd.forEach(item => { indMap[item.period] = item.cpi_combined; });

    const allPeriods = Array.from(new Set([...Object.keys(usMap), ...Object.keys(indMap)])).sort();

    const formatPeriodLabel = (p) => {
        const [yr, moStr] = p.split('-');
        const mo = parseInt(moStr, 10);
        if (currentRange === '3Y') {
            const q = Math.ceil(mo / 3);
            return `Q${q} '${yr.slice(2)}`;
        } else if (currentRange === '5Y') {
            return mo <= 6 ? `H1 '${yr.slice(2)}` : `H2 '${yr.slice(2)}`;
        } else if (currentRange === 'ALL') {
            return `Jul ${yr}`;
        } else {
            return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo-1]} '${yr.slice(2)}`;
        }
    };

    const categories = allPeriods.map(formatPeriodLabel);
    const seriesUs = allPeriods.map(p => usMap[p] !== undefined ? usMap[p] : null);
    const seriesIndia = allPeriods.map(p => indMap[p] !== undefined ? indMap[p] : null);

    const options = {
        chart: {
            type: 'bar',
            height: 330,
            toolbar: { show: false }
        },
        colors: ['#ef4444', '#f59e0b'],
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '55%',
                borderRadius: 3
            }
        },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: {
            categories: categories,
            labels: { style: { colors: '#64748b', fontSize: '10px' }, rotate: -35 }
        },
        yaxis: {
            labels: {
                formatter: val => `${val.toFixed(1)}%`,
                style: { colors: '#64748b' }
            }
        },
        tooltip: {
            y: { formatter: val => val !== null ? `${val.toFixed(2)}% YoY` : 'N/A' }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: 'US Headline CPI YoY', data: seriesUs },
            { name: 'India CPI Combined YoY', data: seriesIndia }
        ]
    };

    registerChart('chart-overview-inflation', options);
}

// --- YIELD CURVE & RATES CHARTS ---
function renderDetailedYieldCurve(treasury) {
    if (!treasury || !treasury.current_curve) return;

    const categories = treasury.current_curve.map(c => c.tenor);
    const series = [
        {
            name: `Current (${treasury.latest_date})`,
            data: treasury.current_curve.map(c => c.rate)
        }
    ];

    if (treasury.curve_1m_ago) {
        series.push({
            name: `1 Month Ago (${treasury.date_1m_ago})`,
            data: treasury.curve_1m_ago.map(c => c.rate)
        });
    }

    if (treasury.curve_1y_ago) {
        series.push({
            name: `1 Year Ago (${treasury.date_1y_ago})`,
            data: treasury.curve_1y_ago.map(c => c.rate)
        });
    }

    const options = {
        chart: {
            height: 360,
            type: 'line',
            toolbar: { show: false }
        },
        colors: ['#059669', '#34d399', '#94a3b8'],
        stroke: { curve: 'monotoneCubic', width: [3.5, 2.2, 2], dashArray: [0, 3, 5] },
        markers: { size: [5, 3, 3] },
        xaxis: {
            categories: categories,
            title: { text: 'Maturity / Tenor', style: { color: '#64748b', fontWeight: 600, fontSize: '11px' } },
            labels: { style: { colors: '#475569', fontWeight: 600, fontSize: '11px' } }
        },
        yaxis: {
            title: { text: 'Par Yield (%)', style: { color: '#64748b', fontWeight: 600, fontSize: '11px' } },
            labels: { formatter: val => `${val.toFixed(2)}%` }
        },
        tooltip: {
            shared: true,
            y: { formatter: val => `${val.toFixed(2)}%` }
        },
        grid: { borderColor: '#e2e8f0' },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        series: series
    };

    registerChart('chart-yield-curve-detailed', options);
}

function renderTenorsHistory(treasury) {
    if (!treasury || !treasury.history) return;

    const filtered = filterSeriesByRange(treasury.history, currentRange, 'date');

    const s2y = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.yield_2y }));
    const s10y = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.yield_10y }));
    const s30y = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.yield_30y }));

    const minTs = s10y.length ? s10y[0].x : undefined;
    const maxTs = s10y.length ? s10y[s10y.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'line',
            height: 340,
            toolbar: { show: false }
        },
        colors: ['#34d399', '#059669', '#064e3b'],
        stroke: { curve: 'smooth', width: [2.5, 3, 2.5] },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: { labels: { formatter: val => `${val.toFixed(2)}%` } },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${val ? val.toFixed(2) : '—'}%` }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: '2-Year Yield', data: s2y },
            { name: '10-Year Yield', data: s10y },
            { name: '30-Year Yield', data: s30y }
        ]
    };

    registerChart('chart-tenors-history', options);
}

function renderDetailedSpreadHistory(treasury) {
    if (!treasury || !treasury.history) return;

    const filtered = filterSeriesByRange(treasury.history, currentRange, 'date');
    const spread10_2 = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.spread_10_2 }));

    const minTs = spread10_2.length ? spread10_2[0].x : undefined;
    const maxTs = spread10_2.length ? spread10_2[spread10_2.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'area',
            height: 340,
            toolbar: { show: false }
        },
        colors: ['#059669'],
        stroke: { curve: 'straight', width: 2 },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.35,
                opacityTo: 0.05
            }
        },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: { formatter: val => `${(val * 100).toFixed(0)} bps` }
        },
        annotations: {
            yaxis: [{
                y: 0,
                borderColor: '#ef4444',
                strokeDashArray: 2,
                label: {
                    borderColor: '#ef4444',
                    style: { color: '#fff', background: '#ef4444', fontSize: '10px' },
                    text: '0 bps Inversion Boundary'
                }
            }]
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${(val * 100).toFixed(1)} bps` }
        },
        grid: { borderColor: '#f1f5f9' },
        series: [{ name: '10Y - 2Y Spread', data: spread10_2 }]
    };

    registerChart('chart-spread-history-detailed', options);
}

function renderIndiaGsecHistory(india_rates) {
    if (!india_rates || !india_rates.history) return;

    const filtered = filterSeriesByRange(india_rates.history, currentRange, 'date');

    const s2y = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.yield_2y }));
    const s10y = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.yield_10y }));
    const s30y = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.yield_30y }));

    const minTs = s10y.length ? s10y[0].x : undefined;
    const maxTs = s10y.length ? s10y[s10y.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'line',
            height: 340,
            toolbar: { show: false }
        },
        colors: ['#34d399', '#059669', '#064e3b'],
        stroke: { curve: 'smooth', width: [2.5, 3, 2.5] },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: { formatter: val => `${val.toFixed(2)}%` },
            title: { text: 'G-Sec Yield (%)', style: { color: '#64748b', fontSize: '11px' } }
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${val ? val.toFixed(2) : '—'}%` }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: '2-Year G-Sec', data: s2y },
            { name: '10-Year Benchmark G-Sec', data: s10y },
            { name: '30-Year G-Sec', data: s30y }
        ]
    };

    registerChart('chart-india-gsec-history', options);
}

function renderRbiRepoHistory(india_rates) {
    if (!india_rates || !india_rates.history) return;

    const filtered = filterSeriesByRange(india_rates.history, currentRange, 'date');
    const seriesData = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.repo_rate }));

    const minTs = seriesData.length ? seriesData[0].x : undefined;
    const maxTs = seriesData.length ? seriesData[seriesData.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'area',
            height: 340,
            toolbar: { show: false }
        },
        colors: ['#10b981'],
        stroke: { curve: 'stepline', width: 2.5 },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.35,
                opacityTo: 0.05
            }
        },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: { formatter: val => `${val.toFixed(2)}%` },
            title: { text: 'RBI Repo Rate (%)', style: { color: '#64748b', fontSize: '11px' } },
            min: 3.5,
            max: 7.0
        },
        annotations: {
            yaxis: [
                {
                    y: 6.50,
                    borderColor: '#f59e0b',
                    strokeDashArray: 3,
                    label: {
                        borderColor: '#f59e0b',
                        style: { color: '#fff', background: '#f59e0b', fontSize: '10px' },
                        text: 'Peak Tightening Rate (6.50%)'
                    }
                }
            ]
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${val ? val.toFixed(2) : '—'}% (Policy Repo Rate)` }
        },
        legend: { position: 'top', horizontalAlign: 'center' },
        grid: { borderColor: '#f1f5f9' },
        series: [{ name: 'RBI Policy Repo Rate', data: seriesData }]
    };

    registerChart('chart-rbi-repo-history', options);
}

// --- FX CHARTS (USD/JPY, USD/INR, EUR/USD, GBP/USD) ---
function renderCurrencyChart(chartId, asset, color, unit, title) {
    if (!asset || !asset.timeseries) return;

    const filtered = filterSeriesByRange(asset.timeseries, currentRange, 'date');
    const seriesData = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.price }));

    const minTs = seriesData.length ? seriesData[0].x : undefined;
    const maxTs = seriesData.length ? seriesData[seriesData.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'area',
            height: 340,
            toolbar: { show: false }
        },
        colors: [color],
        stroke: { curve: 'smooth', width: 2.2 },
        fill: {
            type: 'gradient',
            gradient: { opacityFrom: 0.3, opacityTo: 0.05 }
        },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: {
                formatter: val => `${val.toFixed(unit === '¥' || unit === '₹' ? 2 : 4)} ${unit}`
            }
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${val.toFixed(4)} ${unit}` }
        },
        grid: { borderColor: '#f1f5f9' },
        series: [{ name: title, data: seriesData }]
    };

    registerChart(chartId, options);
}

function renderUsdJpyDetailed(jpy) {
    renderCurrencyChart('chart-usdjpy-detailed', jpy, '#10b981', '¥', 'USD / JPY');
}

function renderUsdInrDetailed(inr) {
    renderCurrencyChart('chart-usdinr-detailed', inr, '#047857', '₹', 'USD / INR');
}

function renderEurUsdDetailed(eur) {
    renderCurrencyChart('chart-eurusd-detailed', eur, '#059669', '$', 'EUR / USD');
}

function renderGbpUsdDetailed(gbp) {
    renderCurrencyChart('chart-gbpusd-detailed', gbp, '#10b981', '$', 'GBP / USD');
}

// --- INFLATION CHARTS ---
function renderUsInflationDetailed(us_inf) {
    if (!us_inf || !us_inf.history) return;

    const history = getAggregatedInflationData(us_inf.history, currentRange);

    const formatPeriodLabel = (p) => {
        const [yr, moStr] = p.split('-');
        const mo = parseInt(moStr, 10);
        if (currentRange === '3Y') {
            const q = Math.ceil(mo / 3);
            return `Q${q} '${yr.slice(2)}`;
        } else if (currentRange === '5Y') {
            return mo <= 6 ? `H1 '${yr.slice(2)}` : `H2 '${yr.slice(2)}`;
        } else if (currentRange === 'ALL') {
            return `Jul ${yr}`;
        } else {
            return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo-1]} '${yr.slice(2)}`;
        }
    };

    const categories = history.map(h => formatPeriodLabel(h.period));
    const headline = history.map(h => h.headline_cpi_yoy);
    const core = history.map(h => h.core_cpi_yoy);

    const options = {
        chart: {
            type: 'line',
            height: 360,
            toolbar: { show: false }
        },
        colors: ['#ef4444', '#059669'],
        stroke: { curve: 'smooth', width: [3.2, 2.5] },
        markers: { size: [4, 3] },
        xaxis: {
            categories: categories,
            labels: { rotate: -35, style: { fontSize: '10px', colors: '#64748b' } }
        },
        yaxis: {
            labels: { formatter: val => `${val.toFixed(1)}%` },
            title: { text: 'YoY Inflation Rate (%)', style: { color: '#64748b', fontSize: '11px' } }
        },
        annotations: {
            yaxis: [{
                y: 2.0,
                borderColor: '#10b981',
                strokeDashArray: 3,
                label: {
                    borderColor: '#10b981',
                    style: { color: '#fff', background: '#10b981', fontSize: '10px' },
                    text: 'Fed 2.0% Inflation Target'
                }
            }]
        },
        tooltip: {
            shared: true,
            y: { formatter: val => `${val.toFixed(2)}% YoY` }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: 'Headline CPI-U YoY', data: headline },
            { name: 'Core CPI (ex Food/Energy) YoY', data: core }
        ]
    };

    registerChart('chart-us-inflation-detailed', options);
}

function renderIndiaInflationDetailed(ind_inf) {
    if (!ind_inf || !ind_inf.history) return;

    const history = getAggregatedInflationData(ind_inf.history, currentRange);

    const formatPeriodLabel = (p) => {
        const [yr, moStr] = p.split('-');
        const mo = parseInt(moStr, 10);
        if (currentRange === '3Y') {
            const q = Math.ceil(mo / 3);
            return `Q${q} '${yr.slice(2)}`;
        } else if (currentRange === '5Y') {
            return mo <= 6 ? `H1 '${yr.slice(2)}` : `H2 '${yr.slice(2)}`;
        } else if (currentRange === 'ALL') {
            return `Jul ${yr}`;
        } else {
            return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo-1]} '${yr.slice(2)}`;
        }
    };

    const categories = history.map(h => formatPeriodLabel(h.period));
    const cpi = history.map(h => h.cpi_combined);
    const food = history.map(h => h.cfpi_food);
    const wpi = history.map(h => h.wpi);

    const options = {
        chart: {
            type: 'line',
            height: 360,
            toolbar: { show: false }
        },
        colors: ['#059669', '#34d399', '#f59e0b'],
        stroke: { curve: 'smooth', width: [3.2, 2.5, 2], dashArray: [0, 0, 2] },
        markers: { size: [4, 3, 3] },
        xaxis: {
            categories: categories,
            labels: { rotate: -35, style: { fontSize: '10px', colors: '#64748b' } }
        },
        yaxis: {
            labels: { formatter: val => `${val.toFixed(1)}%` },
            title: { text: 'YoY Inflation Rate (%)', style: { color: '#64748b', fontSize: '11px' } }
        },
        annotations: {
            yaxis: [
                {
                    y: 4.0,
                    borderColor: '#059669',
                    strokeDashArray: 3,
                    label: {
                        borderColor: '#059669',
                        style: { color: '#fff', background: '#059669', fontSize: '10px' },
                        text: 'RBI 4.0% Midpoint Target'
                    }
                },
                {
                    y: 6.0,
                    borderColor: '#ef4444',
                    strokeDashArray: 2,
                    label: {
                        borderColor: '#ef4444',
                        style: { color: '#fff', background: '#ef4444', fontSize: '10px' },
                        text: 'RBI 6.0% Upper Tolerance'
                    }
                }
            ]
        },
        tooltip: {
            shared: true,
            y: { formatter: val => `${val.toFixed(2)}% YoY` }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 12 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: 'CPI Combined (Retail)', data: cpi },
            { name: 'Food Index (CFPI)', data: food },
            { name: 'Wholesale Index (WPI)', data: wpi }
        ]
    };

    registerChart('chart-india-inflation-detailed', options);
}

// --- BENCHMARKS CHARTS ---
function renderEquitiesComparison(markets) {
    if (!markets || !markets.SP500 || !markets.NASDAQ100 || !markets.NIFTY50) return;

    const sp500 = filterSeriesByRange(markets.SP500.timeseries, currentRange, 'date');
    const ndx = filterSeriesByRange(markets.NASDAQ100.timeseries, currentRange, 'date');
    const nifty = filterSeriesByRange(markets.NIFTY50.timeseries, currentRange, 'date');

    const baseSp = sp500.length ? sp500[0].price : 1;
    const baseNdx = ndx.length ? ndx[0].price : 1;
    const baseNifty = nifty.length ? nifty[0].price : 1;

    const sSp = sp500.map(d => ({ x: new Date(d.date).getTime(), y: round(((d.price / baseSp) - 1.0) * 100, 2) }));
    const sNdx = ndx.map(d => ({ x: new Date(d.date).getTime(), y: round(((d.price / baseNdx) - 1.0) * 100, 2) }));
    const sNifty = nifty.map(d => ({ x: new Date(d.date).getTime(), y: round(((d.price / baseNifty) - 1.0) * 100, 2) }));

    const minTs = sSp.length ? sSp[0].x : undefined;
    const maxTs = sSp.length ? sSp[sSp.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'line',
            height: 360,
            toolbar: { show: false }
        },
        colors: ['#047857', '#14b8a6', '#10b981'],
        stroke: { curve: 'smooth', width: 2.2 },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: currentRange === '1M' ? 4 : 6,
            labels: {
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                style: { colors: '#64748b', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: { formatter: val => `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` },
            title: { text: '% Return from Range Start', style: { color: '#64748b', fontSize: '11px' } }
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%` }
        },
        legend: {
            show: true,
            position: 'top',
            horizontalAlign: 'center',
            floating: false,
            itemMargin: { horizontal: 16, vertical: 4 }
        },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: 'S&P 500 (US)', data: sSp },
            { name: 'Nasdaq 100 (US Tech)', data: sNdx },
            { name: 'Nifty 50 (India)', data: sNifty }
        ]
    };

    registerChart('chart-equities-comparison', options);
}

function renderVixDetailed(vix) {
    if (!vix || !vix.timeseries) return;

    const filtered = filterSeriesByRange(vix.timeseries, currentRange, 'date');
    const seriesData = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.price }));

    const minTs = seriesData.length ? seriesData[0].x : undefined;
    const maxTs = seriesData.length ? seriesData[seriesData.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'area',
            height: 280,
            toolbar: { show: false }
        },
        colors: ['#ef4444'],
        stroke: { curve: 'straight', width: 1.8 },
        fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: 5,
            labels: {
                show: true,
                datetimeUTC: false,
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                rotate: -20,
                style: { colors: '#64748b', fontSize: '10px' }
            }
        },
        yaxis: { labels: { formatter: val => val.toFixed(1) } },
        annotations: {
            yaxis: [{
                y: 20,
                borderColor: '#f59e0b',
                strokeDashArray: 2,
                label: { text: 'Elevated Risk (20)', style: { color: '#fff', background: '#f59e0b', fontSize: '9px' } }
            }]
        },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => val.toFixed(2) }
        },
        grid: { borderColor: '#f1f5f9' },
        series: [{ name: 'VIX Volatility', data: seriesData }]
    };

    registerChart('chart-vix-detailed', options);
}

function renderGoldDetailed(gold) {
    if (!gold || !gold.timeseries) return;

    const filtered = filterSeriesByRange(gold.timeseries, currentRange, 'date');
    const seriesData = filtered.map(d => ({ x: new Date(d.date).getTime(), y: d.price }));

    const minTs = seriesData.length ? seriesData[0].x : undefined;
    const maxTs = seriesData.length ? seriesData[seriesData.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'area',
            height: 280,
            toolbar: { show: false }
        },
        colors: ['#eab308'],
        stroke: { curve: 'smooth', width: 2 },
        fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: 5,
            labels: {
                show: true,
                datetimeUTC: false,
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                rotate: -20,
                style: { colors: '#64748b', fontSize: '10px' }
            }
        },
        yaxis: { labels: { formatter: val => `$${val.toFixed(0)}` } },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `$${val.toFixed(2)} / oz` }
        },
        grid: { borderColor: '#f1f5f9' },
        series: [{ name: 'Gold ($/oz)', data: seriesData }]
    };

    registerChart('chart-gold-detailed', options);
}

function renderOilDetailed(brent, wti) {
    if (!brent || !wti) return;

    const fb = filterSeriesByRange(brent.timeseries, currentRange, 'date');
    const fw = filterSeriesByRange(wti.timeseries, currentRange, 'date');

    const sB = fb.map(d => ({ x: new Date(d.date).getTime(), y: d.price }));
    const sW = fw.map(d => ({ x: new Date(d.date).getTime(), y: d.price }));

    const minTs = sB.length ? sB[0].x : undefined;
    const maxTs = sB.length ? sB[sB.length - 1].x : undefined;

    const options = {
        chart: {
            type: 'line',
            height: 280,
            toolbar: { show: false }
        },
        colors: ['#0f172a', '#64748b'],
        stroke: { curve: 'smooth', width: [2.5, 2], dashArray: [0, 2] },
        xaxis: {
            type: 'datetime',
            min: minTs,
            max: maxTs,
            tickAmount: 5,
            labels: {
                show: true,
                datetimeUTC: false,
                format: currentRange === '1M' ? 'dd MMM' : 'MMM yy',
                rotate: -20,
                style: { colors: '#64748b', fontSize: '10px' }
            }
        },
        yaxis: { labels: { formatter: val => `$${val.toFixed(1)}` } },
        tooltip: {
            x: { format: 'dd MMM yyyy' },
            y: { formatter: val => `$${val.toFixed(2)} / bbl` }
        },
        legend: { position: 'top', horizontalAlign: 'center', itemMargin: { horizontal: 10 } },
        grid: { borderColor: '#f1f5f9' },
        series: [
            { name: 'Brent Crude', data: sB },
            { name: 'WTI Crude', data: sW }
        ]
    };

    registerChart('chart-oil-detailed', options);
}

// ==============================================================================
// 3. EVENT LISTENERS & NAVIGATION
// ==============================================================================
function setupEventListeners() {
    // 1. Sidebar Tab Switching
    const navItems = document.querySelectorAll('.sidebar-menu .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            if (targetTab === currentTab) return;

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Switch tab content views
            document.querySelectorAll('.tab-content').forEach(section => {
                section.classList.remove('active');
            });
            const targetSection = document.getElementById(`tab-${targetTab}`);
            if (targetSection) targetSection.classList.add('active');

            // Update Header Title
            updateHeaderTitles(targetTab);

            currentTab = targetTab;
            // Render charts for the newly activated tab
            renderChartsForTab(currentTab);
        });
    });

    // 2. Global Range Selector (1M, 6M, 1Y, 3Y, 5Y, All)
    const rangeBtns = document.querySelectorAll('.range-btn');
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.getAttribute('data-range');
            if (range === currentRange) return;

            rangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentRange = range;
            // Immediately re-render all charts for current tab with the new range!
            renderChartsForTab(currentTab);
        });
    });

    // 3. Mobile Sidebar Toggle
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
}

function updateHeaderTitles(tab) {
    const heading = document.getElementById('viewHeading');
    const desc = document.getElementById('viewDescription');

    const metaMap = {
        'overview': {
            title: 'Macroeconomic Overview',
            desc: 'Real-time indicators across US yield curve, FX valuations, inflation, and global benchmarks.'
        },
        'yields': {
            title: 'US Yield Curve & Interest Rate Structure',
            desc: 'Par yield curve morphology, 2Y/10Y/30Y benchmarks, and 10Y-2Y recession inversion tracking.'
        },
        'fx': {
            title: 'Foreign Exchange & Currency Valuations',
            desc: 'Major currency valuations: USD/JPY, USD/INR, EUR/USD, and GBP/USD with 52-week historical ranges.'
        },
        'inflation': {
            title: 'Inflation Pulse: United States & India',
            desc: 'US Headline vs Core CPI dynamics and India CPI-Combined, Food (CFPI), and Wholesale (WPI) trends.'
        },
        'benchmarks': {
            title: 'Global Benchmarks & Commodities',
            desc: 'Comparative performance of S&P 500, Nasdaq 100, Nifty 50, Gold, Oil, and Market Volatility (VIX).'
        }
    };

    if (metaMap[tab]) {
        heading.textContent = metaMap[tab].title;
        desc.textContent = metaMap[tab].desc;
    }
}

// Run on page load
window.addEventListener('DOMContentLoaded', initDashboard);
