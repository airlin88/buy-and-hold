// ==========================================
// 1. 本地/雲端資料庫雙軌並行 (Offline/Online Sync)
// ==========================================
const DB_KEY = 'buy_and_hold_data';
// 【第一把金鑰：資料庫網址】只要將這串網址換成您部署的資料庫 GAS URL，系統就會自動進化成跨裝置雲端版！
const GAS_DB_URL = "https://script.google.com/macros/s/AKfycbwtvT8Bw0gaUOlllGXfVW93k5CimkSoKybqREub_mPs83KZ_5Tua6X33VmqurcPBoSOTg/exec";

// 【第二把金鑰：報價引擎網址】GoogleFinance 中繼站代理伺服器 URL
const GAS_QUOTE_URL = 'https://script.google.com/macros/s/AKfycbw1Aqd0jrbhQTmISli0a1l2kShnGNVjqF6Cs-9L5qxD-o1XyVPBMNdI5k1bzGaHtW-Ybg/exec';

// 實作安全通行憑證
let SYS_AUTH_TOKEN = localStorage.getItem('sys_auth_token') || "";

// 登入介面邏輯
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = document.getElementById('sys-password').value;
    const btn = e.target.querySelector('button');
    btn.textContent = "🚀 驗證加密通道中...";
    btn.disabled = true;
    
    try {
        const res = await fetch(`${GAS_DB_URL}?pwd=${encodeURIComponent(pwd)}`);
        const data = await res.json();
        
        if (data.error === "Unauthorized") {
            document.getElementById('login-error').classList.remove('hidden');
            btn.textContent = "解鎖進入 (Unlock)";
            btn.disabled = false;
        } else {
            SYS_AUTH_TOKEN = pwd;
            localStorage.setItem('sys_auth_token', pwd);
            document.getElementById('login-error').classList.add('hidden');
            btn.textContent = "✅ 解鎖成功！載入中...";
            
            // 將初次驗證已經抓好的 data 直接存入快取定案，避免重複抓取
            localStorage.setItem(DB_KEY, JSON.stringify(data));
            initApp();
        }
    } catch(err) {
        alert("資料庫連線失敗，請檢查網路或稍後再試！");
        btn.textContent = "解鎖進入 (Unlock)";
        btn.disabled = false;
    }
});

window.logout = function() {
    SYS_AUTH_TOKEN = "";
    localStorage.removeItem('sys_auth_token');
    // 清空本地機密資料
    localStorage.removeItem(DB_KEY);
    location.reload();
}



async function loadData() {
    const raw = localStorage.getItem(DB_KEY);
    let localData = raw ? JSON.parse(raw) : { assets: [], transactions: [] };

    if (GAS_DB_URL && SYS_AUTH_TOKEN) {
        try {
            const res = await fetch(`${GAS_DB_URL}?pwd=${encodeURIComponent(SYS_AUTH_TOKEN)}`);
            const data = await res.json();
            
            if (data.error === "Unauthorized") {
                return data; // 將把這個錯誤傳到 initApp 處理
            }
            
            // 【首次無縫轉移防呆】如果雲端是空的，但手機/電腦本身有資料，代表這是剛綁定，所以要把本地備份打上去！
            if (data.assets.length === 0 && data.transactions.length === 0 && (localData.assets.length > 0 || localData.transactions.length > 0)) {
                console.log("偵測到首次綁定空資料庫，正在備份本地資料至雲端...");
                saveData(localData);
                if (localData.transactions) localData.transactions.forEach(t => t.date = new Date(t.date));
                return localData;
            }
            
            if (data.transactions && Array.isArray(data.transactions)) {
                data.transactions.forEach(t => { if(t.date) t.date = new Date(t.date); });
            } else {
                data.transactions = [];
            }
            if (data.assets && Array.isArray(data.assets)) {
                data.assets.forEach(a => {
                    if (a.firstDate) a.firstDate = new Date(a.firstDate);
                    if (a.lastDate) a.lastDate = new Date(a.lastDate);
                });
            } else {
                data.assets = [];
            }
            
            // 寫回本地端當作快取 (離線時可頂著用)
            localStorage.setItem(DB_KEY, JSON.stringify(data));
            return data;
        } catch (err) {
            console.error("雲端讀取失敗，退回本地備用快取", err);
        }
    }

    if (localData.transactions) localData.transactions.forEach(t => t.date = new Date(t.date));
    return localData;
}

function saveData(data) {
    // 第一時間先秒存本地，確保使用者就算斷網也不會掉資料
    localStorage.setItem(DB_KEY, JSON.stringify(data));
    
    // 如果有設定雲端網址，則把這包最新狀態默默背景傳送到 Google 試算表
    if (GAS_DB_URL && SYS_AUTH_TOKEN) {
        // [進階防呆] 避免 Google 試算表自作聰明把 "00919" 當成數字 919 存起來
        // 我們拷貝一份準備上傳的資料，在所有 0 開頭的全數字股票代碼前加上單引號 "'"
        // 這會強制 Google Sheets 把它辨識為純文字 (純文字格式下，單引號會隱藏)
        let payload = JSON.parse(JSON.stringify(data));
        payload.pwd = SYS_AUTH_TOKEN; // 綁上通行密碼
        if (payload.assets) {
            payload.assets.forEach(a => {
                if (a.ticker && typeof a.ticker === 'string' && /^0\d+$/.test(a.ticker)) {
                    a.ticker = "'" + a.ticker;
                }
            });
        }
        
        fetch(GAS_DB_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' } // 閃避嚴格的 CORS 阻擋
        }).catch(e => console.error("雲端同步寫入失敗", e));
    }
}

function addTransaction(tx) {
    // 直接操作內存上的 currentData，大幅減少硬碟/雲端重複抓取
    if (!currentData.assets.find(a => a.ticker === tx.ticker)) {
        const isUS = /^[A-Za-z\-]+$/.test(tx.ticker);
        currentData.assets.push({ id: 'a_' + Date.now(), ticker: tx.ticker, name: tx.name, currency: isUS ? 'USD' : 'TWD' });
    }
    const asset = currentData.assets.find(a => a.ticker === tx.ticker);
    
    let dbTx = {
        id: 't_' + Date.now(),
        assetId: asset.id,
        type: tx.type,
        date: tx.date,
        price: tx.price, // 已在表單轉換為 TWD
        quantity: tx.quantity,
        fee: tx.fee
    };
    if (tx.currency === 'USD') {
        dbTx.currency = 'USD';
        dbTx.originalPrice = tx.originalPrice;
        dbTx.exchangeRate = tx.exchangeRate;
    }
    
    currentData.transactions.push(dbTx);
    saveData(currentData);
    return currentData;
}

function deleteTransaction(id) {
    if(!confirm("確定要刪除這筆交易紀錄嗎？")) return;
    currentData.transactions = currentData.transactions.filter(t => t.id !== id);
    
    // 清理沒有任何交易紀錄的空資產
    const usedAssetIds = new Set(currentData.transactions.map(t => t.assetId));
    currentData.assets = currentData.assets.filter(a => usedAssetIds.has(a.id));
    
    saveData(currentData);
    refreshUI();
}
window.deleteTransaction = deleteTransaction;

// ==========================================
// 2. 獨立計算引擎 (PortfolioCalculator)
// ==========================================
function calculatePortfolio(data, quotes) {
    let holdingsMap = {};
    let yearlyRealized = {};
    let assetRealized = {};

    data.assets.forEach(asset => {
        let fallbackPrice = 0;
        const assetTxs = data.transactions.filter(t => t.assetId === asset.id && t.type !== 'dividend');
        if (assetTxs.length > 0) {
            assetTxs.sort((a, b) => new Date(a.date) - new Date(b.date));
            fallbackPrice = assetTxs[assetTxs.length - 1].price;
        }
        
        // 自動補全舊資料：若為美股但無 currency 標記，則自動賦予 USD
        let isUS = asset.currency === 'USD' || /^[A-Za-z-=]+$/.test(asset.ticker);
        
        holdingsMap[asset.id] = {
            ...asset,
            currency: isUS ? 'USD' : 'TWD',
            totalShares: 0,
            totalInvested: 0,
            totalInvestedUSD: 0, // 新增 USD 追蹤
            totalDividends: 0,
            currentMarketPrice: quotes[asset.ticker] || fallbackPrice,
            txDetails: []
        };
        assetRealized[asset.id] = { ticker: asset.ticker, name: asset.name, realizedPnL: 0, maxInvested: 0, totalCostBasisRealized: 0, firstDate: null, lastDate: null, details: [] };
    });

    const sortedTx = [...data.transactions].sort((a, b) => a.date - b.date);

    sortedTx.forEach(tx => {
        let h = holdingsMap[tx.assetId];
        if (!h) return;
        
        const year = tx.date.getFullYear();
        if (!yearlyRealized[year]) yearlyRealized[year] = { 
            capitalGains: 0, 
            dividends: 0, 
            principal: 0,
            capitalGainsPos: 0,
            capitalGainsNeg: 0,
            principalPos: 0,
            principalNeg: 0
        };

        let ar = assetRealized[tx.assetId];
        if (ar) {
            if (!ar.firstDate || tx.date < ar.firstDate) ar.firstDate = tx.date;
            if (!ar.lastDate || tx.date > ar.lastDate) ar.lastDate = tx.date;
        }

        // 防呆舊資料：若資產是 USD，但交易紀錄沒有 currency，自動補齊
        let txCurrency = tx.currency || h.currency;
        let txOriginalPrice = tx.originalPrice;
        let txExchangeRate = tx.exchangeRate;
        let liveRate = window.liveUSDTWD || 32.5;
        if (txCurrency === 'USD' && !txOriginalPrice) {
            txOriginalPrice = tx.price / liveRate;
            txExchangeRate = liveRate;
        }

        if (tx.type === 'buy') {
            h.totalInvested += (tx.price * tx.quantity) + tx.fee;
            if (txCurrency === 'USD') {
                h.totalInvestedUSD += (txOriginalPrice * tx.quantity);
            }
            if (ar && h.totalInvested > ar.maxInvested) ar.maxInvested = h.totalInvested;
            h.totalShares += tx.quantity;
            h.txDetails.push({ date: tx.date, type: '買進', qty: tx.quantity, price: tx.price, currency: txCurrency, originalPrice: txOriginalPrice, exchangeRate: txExchangeRate });
        } else if (tx.type === 'sell') {
            h.txDetails.push({ date: tx.date, type: '賣出', qty: tx.quantity, price: tx.price, currency: txCurrency, originalPrice: txOriginalPrice, exchangeRate: txExchangeRate });
            const avgCost = h.totalShares > 0 ? h.totalInvested / h.totalShares : 0;
            const costBasis = avgCost * tx.quantity;
            if (txCurrency === 'USD') {
                const avgCostUSD = h.totalShares > 0 ? h.totalInvestedUSD / h.totalShares : 0;
                h.totalInvestedUSD -= avgCostUSD * tx.quantity;
            }
            
            const revenue = (tx.price * tx.quantity) - tx.fee;
            const realized = revenue - costBasis;
            
            yearlyRealized[year].capitalGains += realized;
            yearlyRealized[year].principal += costBasis;
            if (realized >= 0) {
                yearlyRealized[year].capitalGainsPos += realized;
                yearlyRealized[year].principalPos += costBasis;
            } else {
                yearlyRealized[year].capitalGainsNeg += realized;
                yearlyRealized[year].principalNeg += costBasis;
            }
            if(assetRealized[tx.assetId]) {
                assetRealized[tx.assetId].realizedPnL += realized;
                assetRealized[tx.assetId].totalCostBasisRealized += costBasis;
                assetRealized[tx.assetId].details.push({
                    date: tx.date, type: '賣出', qty: tx.quantity, price: tx.price, pnl: realized, pnlPct: costBasis > 0 ? (realized / costBasis) * 100 : 0
                });
            }

            h.totalShares -= tx.quantity;
            h.totalInvested -= costBasis;
        } else if (tx.type === 'dividend') {
            h.txDetails.push({ date: tx.date, type: '配息', qty: tx.quantity, price: tx.price, currency: txCurrency, originalPrice: txOriginalPrice, exchangeRate: txExchangeRate });
            const divInfo = tx.price * tx.quantity;
            yearlyRealized[year].dividends += divInfo;
            yearlyRealized[year].principal += h.totalInvested;
            if(assetRealized[tx.assetId]) {
                assetRealized[tx.assetId].realizedPnL += divInfo;
                assetRealized[tx.assetId].details.push({
                    date: tx.date, type: '配息', qty: tx.quantity, price: tx.price, pnl: divInfo, pnlPct: null
                });
            }
            h.totalDividends += divInfo;
        }
    });

    let totalMarketValue = 0;
    let totalInvested = 0;
    let holdings = [];

    Object.values(holdingsMap).forEach(h => {
        if (h.totalShares <= 0) return;
        h.averageCost = h.totalShares > 0 ? h.totalInvested / h.totalShares : 0;
        h.currentValue = h.totalShares * h.currentMarketPrice;
        h.unrealizedPnL = h.currentValue - h.totalInvested;
        h.unrealizedPnLPct = h.totalInvested > 0 ? (h.unrealizedPnL / h.totalInvested) * 100 : 0;
        
        if (h.currency === 'USD') {
            h.averageCostUSD = h.totalShares > 0 ? h.totalInvestedUSD / h.totalShares : 0;
            let rate = window.liveUSDTWD || 32.5;
            h.currentMarketPriceUSD = h.currentMarketPrice / rate;
            h.currentValueUSD = h.totalShares * h.currentMarketPriceUSD;
            h.unrealizedPnLUSD = h.currentValueUSD - h.totalInvestedUSD;
            h.unrealizedPnLPctUSD = h.totalInvestedUSD > 0 ? (h.unrealizedPnLUSD / h.totalInvestedUSD) * 100 : 0;
        }

        totalMarketValue += h.currentValue;
        totalInvested += h.totalInvested;
        holdings.push(h);
    });

    const currentYear = new Date().getFullYear();
    const currY = yearlyRealized[currentYear] || { capitalGains: 0, dividends: 0, principal: 0 };
    const totalRealizedThisYear = currY.capitalGains + currY.dividends;
    const totalRealizedPctThisYear = currY.principal > 0 ? (totalRealizedThisYear / currY.principal) * 100 : 0;
    
    const totalUnrealizedPnLPct = totalInvested > 0 ? ((totalMarketValue - totalInvested) / totalInvested) * 100 : 0;

    return { 
        holdings, 
        totalMarketValue, 
        totalUnrealizedPnL: totalMarketValue - totalInvested,
        totalUnrealizedPnLPct,
        yearlyRealized,
        assetRealized,
        totalRealizedThisYear,
        totalRealizedPctThisYear
    };
}

// ==========================================
// 3. 網路服務層 (StockQuoteService)
// ==========================================

async function fetchQuotes(tickers) {
    if (tickers.length === 0) return {};
    
    // 強制請求匯率 (因 GAS regex 可能阻擋 '='，我們保留讓 app.js 自行透過 Yahoo 備援抓取)
    let queryTickers = [...tickers];
    if (!queryTickers.includes('USDTWD=X')) queryTickers.push('USDTWD=X');
    
    let result = {};
    let debugErrors = [];

    // 0. 優先使用無敵的 Google Apps Script Proxy
    if (typeof GAS_QUOTE_URL !== 'undefined' && GAS_QUOTE_URL) {
        try {
            // 修正：完全對齊您目前建置的報價引擎參數格式 ?q=...
            const res = await fetch(`${GAS_QUOTE_URL}?q=${queryTickers.join(',')}`);
            if (res.ok) {
                result = await res.json();
                
                // GAS 若因舊版正則表達式擋掉 '=' 導致沒抓到 USDTWD=X，則在本地直接用備援抓取
                if (!result['USDTWD=X']) {
                    try {
                        const yRes = await fetch('https://query2.finance.yahoo.com/v8/finance/chart/USDTWD=X', { cache: 'no-store' });
                        if (yRes.ok) {
                            const yData = await yRes.json();
                            const rate = yData.chart?.result?.[0]?.meta?.regularMarketPrice;
                            if (rate) result['USDTWD=X'] = rate;
                        }
                    } catch (e) {
                         console.warn("Local USDTWD fallback failed", e);
                    }
                }
                
                // 嘗試將美股即時換算為台幣
                let liveRate = result['USDTWD=X'] || 32.5;
                window.liveUSDTWD = liveRate;
                
                for (let t of tickers) {
                    if (result[t] && /^[A-Za-z\-]+$/.test(t) && t !== 'USDTWD=X') {
                        result[t] = result[t] * liveRate;
                    }
                }
                return result;
            }
        } catch (e) {
            console.warn('GAS Fetch failed, falling back...', e);
        }
    }

    // 1. 抓取台灣證券交易所 (TWSE - 上市) 最新收盤價加時間戳防止快取
    try {
        const twseRes = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL?_=' + Date.now());
        if (twseRes.ok) {
            const twseData = await twseRes.json();
            // 防呆處理：TWSE 每日下午盤後結算時會回傳 { stat: "未符合條件" }
            if (Array.isArray(twseData)) {
                twseData.forEach(item => {
                    if (tickers.includes(item.Code)) {
                        const price = parseFloat(item.ClosingPrice);
                        if (!isNaN(price)) result[item.Code] = price;
                    }
                });
            } else {
                debugErrors.push("TWSE盤後無資料");
            }
        } else {
            debugErrors.push(`TWSE_${twseRes.status}`);
        }
    } catch (err) {
        debugErrors.push("TWSE_CORS");
    }

    // 2. 抓取證券櫃檯買賣中心 (TPEx - 上櫃)
    try {
        const tpexRes = await fetch('https://www.tpex.org.tw/openapi/v1/t187ap03_L?_=' + Date.now());
        if (tpexRes.ok) {
            const tpexData = await tpexRes.json();
            if (Array.isArray(tpexData)) {
                tpexData.forEach(item => {
                    if (tickers.includes(item.SecuritiesCompanyCode)) {
                        const price = parseFloat(item.Close);
                        if (!isNaN(price)) result[item.SecuritiesCompanyCode] = price;
                    }
                });
            }
        }
    } catch (err) {
        debugErrors.push("TPEx_CORS");
    }

    // 3. 超強備援：若依然沒抓到，直接呼叫 Yahoo Finance v8 API (免 Proxy)
    for (let ticker of queryTickers) {
        if (!result[ticker]) {
            // 判別：如果代號全為英文字母/連字號 (如 QQQ, AAPL, BRK-B) 或是匯率 USDTWD=X，視為美股或外匯
            const isUS = /^[A-Za-z-=]+$/.test(ticker);
            const trySuffixes = isUS ? [''] : ['.TW', '.TWO'];

            for (let suffix of trySuffixes) {
                try {
                    const yUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}${suffix}`;
                    const yRes = await fetch(yUrl, { cache: 'no-store' });
                    if (yRes.ok) {
                        const yData = await yRes.json();
                        const price = yData.chart?.result?.[0]?.meta?.regularMarketPrice;
                        if (price) {
                            result[ticker] = price;
                            break; // 抓到就跳出 suffix 迴圈
                        }
                    } else {
                        if (trySuffixes.indexOf(suffix) === trySuffixes.length - 1) {
                            debugErrors.push(`YHOO_${yRes.status}`);
                        }
                    }
                } catch (err) {
                    if (trySuffixes.indexOf(suffix) === trySuffixes.length - 1) {
                        debugErrors.push("YHOO_CORS");
                    }
                }
            }
        }
    }

    // 將美股即時換算為台幣 (備援模式下的換算)
    let liveRate = result['USDTWD=X'] || 32.5;
    window.liveUSDTWD = liveRate;
    
    for (let t of tickers) {
        if (result[t] && /^[A-Za-z\-]+$/.test(t) && t !== 'USDTWD=X') {
            result[t] = result[t] * liveRate;
        }
    }

    if (debugErrors.length > 0) result._errors = debugErrors.join(', ');
    return result;
}

// ==========================================
// 4. UI 視圖管理與綁定 (View & ViewModel 整合)
// ==========================================
let currentData = { assets: [], transactions: [] };

let currentQuotes = {};
let chartInstance = null;
let yearlyChartInstance = null;

const formatCurrency = (num) => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(num));
const formatInteger = (num) => new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(num));
const formatFloat = (num) => new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(num);

async function refreshUI() {
    const tickers = currentData.assets.map(a => a.ticker);
    currentQuotes = await fetchQuotes(tickers);
    
    const summary = calculatePortfolio(currentData, currentQuotes);
    
    renderDashboard(summary.holdings, summary.totalMarketValue, summary.totalUnrealizedPnL, summary.totalUnrealizedPnLPct, summary.totalRealizedThisYear, summary.totalRealizedPctThisYear);
    renderHoldings(summary.holdings);
    renderHistory(currentData.transactions, currentData.assets);
    renderRealized(summary.yearlyRealized, summary.assetRealized);
}

function renderDashboard(holdings, totalMarketValue, totalUnrealizedPnL, totalUnrealizedPnLPct, totalRealizedThisYear, totalRealizedPctThisYear) {
    document.getElementById('total-market-value').textContent = formatCurrency(totalMarketValue);
    
    const pnlEl = document.getElementById('total-unrealized-pnl');
    const pnlSign = totalUnrealizedPnL >= 0 ? '+' : '';
    pnlEl.textContent = `${pnlSign} ${formatCurrency(totalUnrealizedPnL)} (${pnlSign}${totalUnrealizedPnLPct.toFixed(2)}%)`;
    pnlEl.className = `pnl-value ${totalUnrealizedPnL >= 0 ? 'positive' : 'negative'}`;

    const realEl = document.getElementById('total-realized-pnl');
    const realSign = totalRealizedThisYear >= 0 ? '+' : '';
    realEl.textContent = `${realSign} ${formatCurrency(totalRealizedThisYear)} (${realSign}${totalRealizedPctThisYear.toFixed(2)}%)`;
    realEl.className = `pnl-value ${totalRealizedThisYear >= 0 ? 'positive' : 'negative'}`;

    const ctx = document.getElementById('portfolioChart').getContext('2d');
    const labels = holdings.map(h => h.name);
    const data = holdings.map(h => h.currentValue);
    const bgColors = ['#4f46e5', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6']; 

    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '70%',
            plugins: { 
                legend: { position: 'right', labels: { color: '#f1f3f5', font: { family: 'Inter' } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            let value = context.raw;
                            let total = context.chart._metasets[context.datasetIndex].total;
                            let percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%';
                            return label + formatCurrency(value) + ' (' + percentage + ')';
                        }
                    }
                }
            }
        }
    });
}

function renderHoldings(holdings) {
    const list = document.getElementById('holdings-list');
    list.innerHTML = holdings.length === 0 ? '<p style="color:#a1aab3;">目前無庫存庫存</p>' : '';
    
    holdings.forEach(h => {
        const isPositive = h.unrealizedPnL >= 0;
        const colorClass = isPositive ? 'positive' : 'negative';
        const sign = isPositive ? '+' : '';
        
        const isUS = h.currency === 'USD';
        
        let detailsHtml = h.txDetails.slice().reverse().map(d => {
            const typeColor = d.type === '買進' ? 'tag-buy' : d.type === '賣出' ? 'tag-sell' : 'tag-dividend';
            let priceLabel = '';
            let subText = '';
            
            if (isUS && d.originalPrice) {
                priceLabel = d.type === '配息' ? `每股配息 $${formatFloat(d.originalPrice)}` : `@ $${formatFloat(d.originalPrice)}`;
                subText = `(匯率 ${d.exchangeRate}) (NT$${formatInteger(d.price * d.qty)})`;
            } else {
                priceLabel = d.type === '配息' ? `每股配息 ${formatFloat(d.price)}` : `@ ${formatFloat(d.price)}`;
            }
            
            return `
                <div class="details-row" style="flex-wrap: wrap; margin-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                        <div>
                            <span style="color: var(--text-secondary); width: 85px; display: inline-block;">${d.date.toLocaleDateString('zh-TW')}</span>
                            <span class="${typeColor}" style="padding: 2px 6px; border-radius: 4px; font-size: 11px;">${d.type}</span>
                        </div>
                        <span style="font-weight: 500;">${formatFloat(d.qty)}股 ${priceLabel}</span>
                    </div>
                    ${subText ? `<div style="width: 100%; text-align: right; color: var(--text-secondary); font-size: 11px; margin-top: 2px;">${subText}</div>` : ''}
                </div>
            `;
        }).join('');
        
        // 修正：針對美股換算台幣損益的 Bug，使用者期望看到純粹是 (USD 損益 * 當前匯率) 的數字，而不是包含歷史匯差的真實 TWD 成本差異
        let displayTwdPnL = isUS ? (h.unrealizedPnLUSD * (window.liveUSDTWD || 32.5)) : h.unrealizedPnL;
        let pnlColorClass = displayTwdPnL >= 0 ? 'positive' : 'negative';
        let pnlTwdSign = displayTwdPnL >= 0 ? '+' : '';

        let priceStr = isUS ? '$' + formatFloat(h.currentMarketPriceUSD) : formatFloat(h.currentMarketPrice);
        let avgCostStr = isUS ? '$' + formatFloat(h.averageCostUSD) : formatFloat(h.averageCost);
        let mktValStr = isUS ? '$' + formatInteger(h.currentValueUSD) : formatCurrency(h.currentValue);
        
        let pnlLines = '';
        if (isUS) {
            let pnlUSDColor = h.unrealizedPnLUSD >= 0 ? 'positive' : 'negative';
            let pnlUSDSign = h.unrealizedPnLUSD >= 0 ? '+' : '';
            pnlLines = `
                <span class="stat-value ${pnlUSDColor}">${pnlUSDSign}$${formatInteger(h.unrealizedPnLUSD)} (${pnlUSDSign}${h.unrealizedPnLPctUSD.toFixed(2)}%)</span>
                <span style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;" class="${pnlColorClass}">NT$${pnlTwdSign}${formatInteger(displayTwdPnL)} (匯率 ${window.liveUSDTWD || 32.5})</span>
            `;
        } else {
            pnlLines = `<span class="stat-value ${pnlColorClass}">${pnlTwdSign}${formatCurrency(displayTwdPnL)} (${pnlTwdSign}${h.unrealizedPnLPct.toFixed(2)}%)</span>`;
        }
        
        list.innerHTML += `
            <div class="list-item" style="cursor: pointer;" onclick="toggleDetails(this, event)" title="點擊展開/收合明細">
                <div class="item-row">
                    <div>
                        <span class="item-title">${h.name}</span>
                        <span class="item-subtitle">${h.ticker}</span>
                    </div>
                    <div class="item-price">${priceStr}</div>
                </div>
                <div class="item-row" style="margin-top: 8px;">
                    <div class="stat-col" style="flex: 0.8;">
                        <span class="stat-label">股數</span>
                        <span class="stat-value">${formatFloat(h.totalShares)}</span>
                    </div>
                    <div class="stat-col" style="flex: 1;">
                        <span class="stat-label">均價</span>
                        <span class="stat-value">${avgCostStr}</span>
                    </div>
                    <div class="stat-col" style="flex: 1.2;">
                        <span class="stat-label">市值</span>
                        <span class="stat-value">${mktValStr}</span>
                    </div>
                    <div class="stat-col stat-end" style="flex: 1.5;">
                        <span class="stat-label">未實現損益</span>
                        ${pnlLines}
                    </div>
                </div>
                <div id="details-holding-${h.id}" class="hidden" style="display: none; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--glass-border);">
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">▼ 此股交易明細</div>
                    ${detailsHtml}
                </div>
            </div>
        `;
    });
}

function renderHistory(transactions, assets) {
    const list = document.getElementById('history-list');
    const searchInput = document.getElementById('history-search-input');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    let filteredTransactions = transactions;
    if (keyword) {
        filteredTransactions = transactions.filter(tx => {
            const asset = assets.find(a => a.id === tx.assetId);
            if (!asset) return false;
            return asset.name.toLowerCase().includes(keyword) || asset.ticker.toLowerCase().includes(keyword);
        });
    }

    list.innerHTML = filteredTransactions.length === 0 ? '<p style="color:#a1aab3;">尚無交易紀錄，或無符合搜尋的項目</p>' : '';
    
    const sorted = [...filteredTransactions].sort((a, b) => b.date - a.date);
    
    sorted.forEach(tx => {
        const asset = assets.find(a => a.id === tx.assetId);
        const typeLabels = { buy: '買進', sell: '賣出', dividend: '配息' };
        
        let priceStr = formatCurrency(tx.price);
        if (tx.currency === 'USD' && tx.originalPrice) {
            priceStr = `US$ ${formatFloat(tx.originalPrice)} (匯率 ${tx.exchangeRate})`;
        }
        const priceLabel = tx.type === 'dividend' ? `每股配息 ${priceStr}` : `@ ${priceStr}`;
        
        list.innerHTML += `
            <div class="list-item">
                <div class="item-row">
                    <div>
                        <div class="item-title">${asset ? asset.name : '未知標的'}</div>
                        <div class="stat-label" style="margin-top: 4px;">${tx.date.toLocaleDateString('zh-TW')}</div>
                    </div>
                    <div class="stat-col stat-end" style="flex: 1; align-items: flex-end;">
                        <span class="tag-${tx.type}" style="margin-bottom: 4px;">${typeLabels[tx.type]}</span>
                        <span class="stat-value">${formatFloat(tx.quantity)} 股 ${priceLabel}</span>
                        <span style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">價金: ${formatCurrency(tx.price * tx.quantity)} ｜ 手續費: ${formatCurrency(tx.fee || 0)}</span>
                    </div>
                    <button class="delete-btn" onclick="deleteTransaction('${tx.id}')" title="刪除輸入錯誤" style="margin-left: 12px; padding: 6px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `;
    });
}

window.toggleDetails = function(itemEl, event) {
    if (event) {
        if (event.target.tagName.toLowerCase() === 'button' || event.target.closest('button')) return;
        
        // 核心解法：如果使用者不小心點到了明細區塊的內部（例如滑鼠選擇文字），不要觸發收合
        if (event.target.closest('[id^="details-"]')) return;
    }
    
    // 直接從被點擊的列表往下尋找 details 的區塊
    const el = itemEl.querySelector('[id^="details-"]');
    if (!el) return;
    
    if (el.classList.contains('hidden') || el.style.display === 'none') {
        el.classList.remove('hidden');
        el.style.display = 'block';
    } else {
        el.classList.add('hidden');
        el.style.display = 'none';
    }
}

function renderRealized(yearlyRealized, assetRealized) {
    const list = document.getElementById('realized-list');
    const assetArr = Object.values(assetRealized).filter(a => a.realizedPnL !== 0).sort((a,b) => b.realizedPnL - a.realizedPnL);
    
    list.innerHTML = assetArr.length === 0 ? '<p style="color:#a1aab3;">尚無歷史已實現損益</p>' : '';
    
    assetArr.forEach(a => {
        const isPositive = a.realizedPnL >= 0;
        const colorClass = isPositive ? 'positive' : 'negative';
        
        let years = 1;
        let cagr = 0;
        let cagrHtml = '';
        if (a.firstDate && a.lastDate) {
            let days = (a.lastDate - a.firstDate) / (1000 * 60 * 60 * 24);
            if (days < 1) days = 1;
            years = days / 365.25;
        }
        let principal = a.totalCostBasisRealized > 0 ? a.totalCostBasisRealized : a.maxInvested;
        if (principal > 0) {
            let roi = a.realizedPnL / principal;
            if (roi <= -1) cagr = -1;
            else cagr = Math.pow(1 + roi, 1 / years) - 1;
            
            const cagrColor = cagr >= 0 ? 'positive' : 'negative';
            const cagrSign = cagr >= 0 ? '+' : '';
            cagrHtml = `<div style="font-size: 11px; margin-top: 4px; color: var(--text-secondary);">年化報酬率: <span class="${cagrColor}">${cagrSign}${(cagr * 100).toFixed(2)}%</span></div>`;
        }
        
        let detailsHtml = a.details.slice().reverse().map(d => {
            const dColor = d.pnl >= 0 ? 'positive' : 'negative';
            const dSign = d.pnl >= 0 ? '+' : '';
            const pctStr = d.pnlPct !== null ? `(${dSign}${d.pnlPct.toFixed(2)}%)` : '';
            return `
                <div class="details-row">
                    <span style="color: var(--text-secondary);">${d.date.toLocaleDateString('zh-TW')} <span class="tag-${d.type==='賣出'?'sell':'dividend'}">${d.type}</span> ${formatFloat(d.qty)}股</span>
                    <span class="${dColor}" style="font-weight: 600;">${dSign}${formatCurrency(d.pnl)} ${pctStr}</span>
                </div>
            `;
        }).join('');

        list.innerHTML += `
            <div class="list-item" style="cursor: pointer;" onclick="toggleDetails(this, event)" title="點擊展開/收合歷史明細">
                <div class="item-row">
                    <div>
                        <span class="item-title">${a.name}</span>
                        <span class="item-subtitle">${a.ticker}</span>
                    </div>
                    <div class="stat-col stat-end">
                        <span class="stat-value ${colorClass}" style="font-size: 16px;">${isPositive ? '+' : ''}${formatCurrency(a.realizedPnL)}</span>
                        ${cagrHtml}
                    </div>
                </div>
                <div id="details-${a.id}" class="hidden" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--glass-border);">
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">▼ 點擊可收合歷史明細</div>
                    ${detailsHtml}
                </div>
            </div>
        `;
    });

    const ctx = document.getElementById('yearlyRealizedChart').getContext('2d');
    const years = Object.keys(yearlyRealized).sort();
    const cgData = years.map(y => yearlyRealized[y].capitalGains);
    const divData = years.map(y => yearlyRealized[y].dividends);

    if (yearlyChartInstance) yearlyChartInstance.destroy();
    
    yearlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                {
                    label: '交易損益 (價差)',
                    data: cgData,
                    backgroundColor: cgData.map(val => val >= 0 ? '#ef4444' : '#22c55e'),
                    borderRadius: 4
                },
                {
                    label: '股息收益',
                    data: divData,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, border: { dash: [4, 4] } }
            },
            plugins: { 
                legend: { position: 'top', labels: { color: '#f1f3f5' } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                let yData = yearlyRealized[context.label];
                                let posPct = yData.principalPos > 0 ? ` (+${((yData.capitalGainsPos / yData.principalPos) * 100).toFixed(2)}%)` : '';
                                return `交易盈額: +${formatCurrency(yData.capitalGainsPos)}${posPct}`;
                            }
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            let value = context.raw;
                            let sign = value > 0 ? '+' : '';
                            
                            if (context.datasetIndex === 1) { // 股息收益
                                let yData = yearlyRealized[context.label];
                                let pctStr = '';
                                if (yData.principal > 0) {
                                    let pct = (value / yData.principal) * 100;
                                    let pSign = pct >= 0 ? '+' : '';
                                    pctStr = ` (${pSign}${pct.toFixed(2)}%)`;
                                }
                                return label + sign + formatCurrency(value) + pctStr;
                            }
                            return label + sign + formatCurrency(value);
                        },
                        afterLabel: function(context) {
                            if (context.datasetIndex === 0) { // 交易損益
                                let yData = yearlyRealized[context.label];
                                let lines = [];
                                
                                let negPct = yData.principalNeg > 0 ? ` (${((yData.capitalGainsNeg / yData.principalNeg) * 100).toFixed(2)}%)` : '';
                                let negSign = yData.capitalGainsNeg === 0 ? '' : (yData.capitalGainsNeg > 0 ? '+' : '');
                                lines.push(`交易虧損: ${negSign}${formatCurrency(yData.capitalGainsNeg)}${negPct}`);
                                
                                let value = context.raw;
                                let cgPrincipal = yData.principalPos + yData.principalNeg;
                                let cgPctStr = '';
                                if (cgPrincipal > 0) {
                                    let pct = (value / cgPrincipal) * 100;
                                    let sign = pct >= 0 ? '+' : '';
                                    cgPctStr = ` (${sign}${pct.toFixed(2)}%)`;
                                }
                                let valSign = value >= 0 ? '+' : '';
                                lines.push(''); // 原本 footer 空隙
                                lines.push(`總損益: ${valSign}${formatCurrency(value)}${cgPctStr}`);
                                
                                return lines;
                            }
                            return null;
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// 5. 事件監聽 (Event Listeners)
// ==========================================

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        const targetBtn = e.currentTarget;
        targetBtn.classList.add('active');
        
        const targetViewId = targetBtn.getAttribute('data-target');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(targetViewId).classList.add('active');
    });
});

if (document.getElementById('history-search-input')) {
    document.getElementById('history-search-input').addEventListener('input', () => {
        renderHistory(currentData.transactions, currentData.assets);
    });
}

document.getElementById('refresh-btn').addEventListener('click', refreshUI);
document.getElementById('sync-quotes-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalText = btn.textContent;
    btn.textContent = '↻ 抓取中...';
    btn.disabled = true;
    await refreshUI();
    btn.textContent = originalText;
    btn.disabled = false;
});

const modal = document.getElementById('transaction-modal');
let isFeeManuallyEdited = false;

document.getElementById('add-transaction-btn').addEventListener('click', () => { 
    modal.classList.remove('hidden'); 
    isFeeManuallyEdited = false;
    document.getElementById('group-exchange-rate').style.display = 'none';
});
document.getElementById('close-modal-btn').addEventListener('click', () => { modal.classList.add('hidden'); });
document.getElementById('cancel-transaction-btn').addEventListener('click', () => { modal.classList.add('hidden'); });

document.getElementById('txFee').addEventListener('input', () => {
    isFeeManuallyEdited = true;
});

document.getElementById('txTicker').addEventListener('input', (e) => {
    const ticker = e.target.value.trim();
    const isUS = /^[A-Za-z\-]+$/.test(ticker);
    document.getElementById('group-exchange-rate').style.display = isUS ? 'block' : 'none';
    if (isUS && window.liveUSDTWD) {
        document.getElementById('txExchangeRate').value = window.liveUSDTWD.toFixed(3);
    }
});

function updateFee() {
    if (isFeeManuallyEdited) return;
    
    const typeObj = document.querySelector('input[name="txType"]:checked');
    if (!typeObj) return;
    const type = typeObj.value;
    
    const ticker = document.getElementById('txTicker').value.trim();
    const isUS = /^[A-Za-z\-]+$/.test(ticker);
    
    const originalPrice = parseFloat(document.getElementById('txPrice').value) || 0;
    const exchangeRate = parseFloat(document.getElementById('txExchangeRate').value) || 32.5;
    const price = isUS ? originalPrice * exchangeRate : originalPrice; // 換算成台幣算手續費 (假設複委託以台幣計)
    
    const quantity = parseFloat(document.getElementById('txQuantity').value) || 0;
    const discount = parseFloat(document.getElementById('txDiscount').value) || 0.28;

    let fee = 0;
    if (type === 'buy') {
        fee = price * quantity * 0.001425 * discount;
    } else if (type === 'sell') {
        fee = price * quantity * (0.001425 * discount + 0.003);
    } else {
        fee = 0; 
    }
    
    document.getElementById('txFee').value = Math.floor(fee);
}

['txPrice', 'txQuantity', 'txDiscount'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateFee);
});

document.querySelectorAll('input[name="txType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const type = e.target.value;
        document.getElementById('label-price').textContent = type === 'dividend' ? '每股配息' : '成交價';
        document.getElementById('group-fee').style.display = type === 'dividend' ? 'none' : 'flex';
        updateFee();
    });
});

document.getElementById('transaction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const ticker = document.getElementById('txTicker').value.trim();
    const isUS = /^[A-Za-z\-]+$/.test(ticker);
    let originalPrice = parseFloat(document.getElementById('txPrice').value);
    let exchangeRate = parseFloat(document.getElementById('txExchangeRate').value) || 1;
    let finalPrice = isUS ? originalPrice * exchangeRate : originalPrice;
    
    const newTx = {
        type: document.querySelector('input[name="txType"]:checked').value,
        ticker: ticker,
        name: document.getElementById('txName').value,
        date: new Date(document.getElementById('txDate').value),
        price: finalPrice,
        quantity: parseFloat(document.getElementById('txQuantity').value),
        fee: parseFloat(document.getElementById('txFee').value || 0)
    };
    if (isUS) {
        newTx.currency = 'USD';
        newTx.originalPrice = originalPrice;
        newTx.exchangeRate = exchangeRate;
    }
    
    currentData = addTransaction(newTx);
    refreshUI();
    
    modal.classList.add('hidden');
    e.target.reset(); 
    isFeeManuallyEdited = false;
    document.getElementById('group-exchange-rate').style.display = 'none';
    document.getElementById('txDate').valueAsDate = new Date();
    updateFee(); 
});

async function initApp() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.style.opacity = '0.5';
    
    // 【存取控制閘門】如果沒有通行憑證，一律阻擋在大門外
    if (!SYS_AUTH_TOKEN) {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
        return;
    }
    
    // 進入時非同步抓取雲端資料
    currentData = await loadData();
    
    // 如果通行證失效或後台拒絕存取
    if (currentData.error === "Unauthorized") {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-error').classList.remove('hidden');
        SYS_AUTH_TOKEN = "";
        localStorage.removeItem('sys_auth_token');
        return;
    }
    
    // 成功解鎖進入系統
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';

    document.getElementById('txDate').valueAsDate = new Date();
    await refreshUI();
    
    if (refreshBtn) refreshBtn.style.opacity = '1';
}

// 啟動應用程式
initApp();

// ==========================================
// 6. DB 管理 (Import & Export Excel)
// ==========================================
const dbModal = document.getElementById('db-modal');
document.getElementById('db-manager-btn').addEventListener('click', () => {
    dbModal.classList.remove('hidden');
});
document.getElementById('close-db-modal-btn').addEventListener('click', () => {
    dbModal.classList.add('hidden');
});

// 匯出 Excel
document.getElementById('export-excel-btn').addEventListener('click', () => {
    // 因為 loadData() 現在是非同步，匯出時可直接拿熱騰騰在記憶體裡的 currentData 即可
    const data = currentData;
    const exportRows = [];
    
    const sortedTx = [...data.transactions].sort((a, b) => a.date - b.date);
    sortedTx.forEach(tx => {
        const asset = data.assets.find(a => a.id === tx.assetId);
        if (!asset) return;
        let typeStr = tx.type === 'buy' ? '買' : (tx.type === 'sell' ? '賣' : '配息');
        let dt = new Date(tx.date);
        
        let priceValue = null;
        let qtyValue = null;
        let divValue = null;
        let feeValue = tx.fee || 0;
        
        if (tx.type === 'dividend') {
            divValue = tx.originalPrice || tx.price; 
            qtyValue = tx.quantity || null;
        } else {
            priceValue = tx.originalPrice || tx.price; 
            qtyValue = tx.quantity;
        }

        exportRows.push({
            "股票代號": asset.ticker,
            "名稱": asset.name,
            "日期": `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`,
            "交易類別": typeStr,
            "數量 (股)": qtyValue,
            "成交價": priceValue,
            "手續費": feeValue,
            "每股配息": divValue,
            "匯率": tx.exchangeRate || null
        });
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "歷史交易紀錄");
    
    let dt = new Date();
    XLSX.writeFile(workbook, `歷史交易紀錄_${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}.xlsx`);
});

// 匯入 Excel (覆蓋模式)
document.getElementById('import-excel-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("確定要匯入這份 Excel 嗎？\n\n按下「確定」將會【徹底清空】您畫面上現有的所有資料，並完全覆蓋為這份 Excel 裡的紀錄！\n請確定這份 Excel 檔案是最新狀態喔！")) {
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
            
            let newAssets = [];
            let newTxs = [];
            
            jsonData.forEach(row => {
                let ticker = row["股票代號"] ? String(row["股票代號"]).trim() : "";
                let name = row["名稱"] ? String(row["名稱"]).trim() : "";
                let dateVal = row["日期"];
                let typeStr = row["交易類別"];
                let qty = parseFloat(row["數量 (股)"]);
                let price = row["成交價"];
                let fee = parseFloat(row["手續費"]) || 0;
                let dividend = parseFloat(row["每股配息"]);
                let rowExchangeRate = parseFloat(row["匯率"]);
                
                if (!ticker && !name) return; // skip empty rows
                
                let isUS = /^[A-Za-z\-=]+$/.test(ticker);
                let currency = isUS ? 'USD' : 'TWD';
                
                let asset = newAssets.find(a => a.ticker === ticker);
                if (!asset) {
                    asset = { id: 'a_' + Date.now() + Math.floor(Math.random()*1000), ticker, name, currency };
                    newAssets.push(asset);
                }
                
                let dateObj = new Date();
                if (dateVal instanceof Date) {
                    dateObj = dateVal;
                } else if (typeof dateVal === 'string') {
                    dateObj = new Date(dateVal);
                }

                let txType = 'buy';
                if (typeStr === '買' || typeStr === '買進') txType = 'buy';
                else if (typeStr === '賣' || typeStr === '賣出') txType = 'sell';
                else if (typeStr === '配息') txType = 'dividend';
                
                let finalPrice = txType === 'dividend' ? dividend : parseFloat(price);
                if (isNaN(finalPrice)) finalPrice = 0;
                if (isNaN(qty)) qty = 0;
                
                let tx = {
                    id: 't_' + Date.now() + Math.floor(Math.random()*10000),
                    assetId: asset.id,
                    type: txType,
                    date: dateObj,
                    price: finalPrice, 
                    quantity: qty,
                    fee: fee
                };
                
                if (currency === 'USD') {
                    tx.currency = 'USD';
                    let liveRate = !isNaN(rowExchangeRate) ? rowExchangeRate : (window.liveUSDTWD || 32.5);
                    tx.originalPrice = finalPrice;
                    tx.exchangeRate = liveRate;
                    tx.price = finalPrice * liveRate; // 存入系統台幣成本
                }
                
                newTxs.push(tx);
            });
            
            const finalData = { assets: newAssets, transactions: newTxs };
            saveData(finalData);
            currentData = finalData;
            refreshUI();
            
            alert(`✅ 成功匯入 ${newTxs.length || 0} 筆交易紀錄！`);
            dbModal.classList.add('hidden');
        } catch (err) {
            console.error(err);
            alert("讀取 Excel 失敗！請確定檔案符合 8 欄標準格式。");
        }
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
});
