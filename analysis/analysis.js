// Local calendar date as YYYY-MM-DD (matches the keys written by background.js).
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let currentViewDate = new Date();
let currentViewMode = 'daily'; // 'daily' or 'weekly'

document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();

    document.getElementById('focusInfoBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('focusInfoPopup').classList.toggle('active');
    });
    document.addEventListener('click', () => {
        document.getElementById('focusInfoPopup').classList.remove('active');
        document.getElementById('exportMenu').classList.remove('active');
    });

    document.getElementById('exportBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('exportMenu').classList.toggle('active');
    });
    document.getElementById('exportCSV').addEventListener('click', () => exportData('csv'));
    document.getElementById('exportJSON').addEventListener('click', () => exportData('json'));

    // Auto-refresh only if we are looking at today
    setInterval(() => {
        if (isToday(currentViewDate)) {
            updateDashboard();
        }
    }, 10000);

    const dailyTab = document.getElementById('dailyTab');
    const weeklyTab = document.getElementById('weeklyTab');

    dailyTab.addEventListener('click', () => {
        currentViewMode = 'daily';
        dailyTab.classList.add('active');
        weeklyTab.classList.remove('active');
        updateDashboard();
    });

    weeklyTab.addEventListener('click', () => {
        currentViewMode = 'weekly';
        weeklyTab.classList.add('active');
        dailyTab.classList.remove('active');
        updateDashboard();
    });

    document.getElementById('prevDay').addEventListener('click', () => {
        if (currentViewMode === 'daily') {
            currentViewDate.setDate(currentViewDate.getDate() - 1);
        } else {
            currentViewDate.setDate(currentViewDate.getDate() - 7);
        }
        updateDashboard();
    });

    document.getElementById('nextDay').addEventListener('click', () => {
        if (currentViewMode === 'daily') {
            if (!isToday(currentViewDate)) {
                currentViewDate.setDate(currentViewDate.getDate() + 1);
                updateDashboard();
            }
        } else {
            // Future check for weekly might be complex, simplified for now
            currentViewDate.setDate(currentViewDate.getDate() + 7);
            if (currentViewDate > new Date()) currentViewDate = new Date();
            updateDashboard();
        }
    });

    document.getElementById('todayBtn').addEventListener('click', () => {
        currentViewDate = new Date();
        updateDashboard();
    });

    const dateDisplay = document.querySelector('.date-display');
    const datePicker = document.getElementById('datePicker');
    if (dateDisplay && datePicker) {
        dateDisplay.addEventListener('click', () => {
            try {
                datePicker.showPicker();
            } catch (e) {
                datePicker.focus();
            }
        });

        datePicker.addEventListener('change', (e) => {
            const selectedDate = new Date(e.target.value);
            // Adjust for timezone offset to keep the local date correct
            const offset = selectedDate.getTimezoneOffset();
            selectedDate.setMinutes(selectedDate.getMinutes() + offset);

            if (selectedDate <= new Date()) {
                currentViewDate = selectedDate;
                updateDashboard();
            } else {
                alert("Cannot view future stats!");
                updateDashboard(); // Reset picker value
            }
        });
    }

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark');
            chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
            updateThemeUI(isDark);
            updateDashboard(); // Redraw chart with new colors
        });
    }

    // Initialize theme
    chrome.storage.local.get({ theme: 'light' }, (data) => {
        const isDark = data.theme === 'dark';
        document.body.classList.toggle('dark', isDark);
        updateThemeUI(isDark);
    });

    // Listen for theme changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.theme) {
            const isDark = changes.theme.newValue === 'dark';
            document.body.classList.toggle('dark', isDark);
            updateThemeUI(isDark);
            updateDashboard();
        }
    });
});

function updateThemeUI(isDark) {
    const moonIcon = document.getElementById('moonIcon');
    const sunIcon = document.getElementById('sunIcon');
    if (moonIcon && sunIcon) {
        moonIcon.style.display = isDark ? 'none' : 'block';
        sunIcon.style.display = isDark ? 'block' : 'none';
    }
}

function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

function calculateStreak(stats, studyDomains) {
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = localDateStr(d);
        const dayStats = stats[dateStr] || {};
        let focusSec = 0;
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            if (studyDomains.some(sd => domain === sd || domain.endsWith('.' + sd))) {
                focusSec += seconds;
            }
        });
        if (focusSec >= 600) streak++;
        else break;
    }
    return streak;
}

function updateDashboard() {
    const isWeekly = currentViewMode === 'weekly';
    const dateString = localDateStr(currentViewDate);

    // Update Date Display
    if (isWeekly) {
        const start = new Date(currentViewDate);
        start.setDate(start.getDate() - 6);
        document.getElementById('currentDate').textContent = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${currentViewDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
        document.getElementById('currentDate').textContent = currentViewDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    const datePicker = document.getElementById('datePicker');
    if (datePicker) datePicker.value = dateString;
    document.getElementById('nextDay').disabled = isToday(currentViewDate);

    chrome.storage.local.get(['dailyStats', 'dailyUrlStats', 'studyDomains', 'hourlyStats', 'allowances', 'tempFocusLog', 'tempFocusPasses'], (data) => {
        const stats = data.dailyStats || {};
        const urlStats = data.dailyUrlStats || {};
        const studyDomains = data.studyDomains || [];
        const hourlyStats = data.hourlyStats || {};
        const allowances = data.allowances || {};
        const tempFocusLog = data.tempFocusLog || {};
        const tempFocusPasses = data.tempFocusPasses || {};

        let focusSeconds = 0;
        let distractionSeconds = 0;
        let sitesVisited = new Set();
        let domainAggregation = {};

        // Date range to process
        const datesToProcess = [];
        if (isWeekly) {
            for (let i = 0; i < 7; i++) {
                const d = new Date(currentViewDate);
                d.setDate(d.getDate() - i);
                datesToProcess.push(localDateStr(d));
            }
        } else {
            datesToProcess.push(dateString);
        }

        // Aggregate stats
        datesToProcess.forEach(date => {
            const dayStats = stats[date] || {};
            const dayTempFocus = tempFocusLog[date] || {};
            Object.entries(dayStats).forEach(([domain, seconds]) => {
                const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
                
                // Check if domain has temp focus time logged
                let tempFocusSeconds = dayTempFocus[domain] || 0;
                
                // Also check if there's a currently active pass for this domain
                // (covers time tracked before tempFocusLog was introduced)
                if (!isStudy && tempFocusSeconds === 0) {
                    const hasActivePass = Object.entries(tempFocusPasses).find(([d, p]) =>
                        (domain === d || domain.endsWith('.' + d)) && p.expiresAt > Date.now()
                    );
                    if (hasActivePass) {
                        // All time today on this domain during an active pass counts as focus
                        tempFocusSeconds = seconds;
                    }
                }
                
                if (isStudy) {
                    focusSeconds += seconds;
                } else if (tempFocusSeconds > 0) {
                    // Time under temp focus pass counts as deep work
                    focusSeconds += Math.min(tempFocusSeconds, seconds);
                    const remainingSeconds = seconds - Math.min(tempFocusSeconds, seconds);
                    if (remainingSeconds > 0) {
                        // Remaining time: check allowance
                        const matchedAllowance = Object.keys(allowances).find(d =>
                            domain === d || domain.endsWith('.' + d)
                        );
                        if (matchedAllowance) {
                            const limitSeconds = allowances[matchedAllowance].limitSeconds || 0;
                            if (remainingSeconds > limitSeconds) {
                                distractionSeconds += (remainingSeconds - limitSeconds);
                            }
                        } else {
                            distractionSeconds += remainingSeconds;
                        }
                    }
                } else {
                    // Check if domain has an allowance
                    const matchedAllowance = Object.keys(allowances).find(d =>
                        domain === d || domain.endsWith('.' + d)
                    );
                    if (matchedAllowance) {
                        const limitSeconds = allowances[matchedAllowance].limitSeconds || 0;
                        if (seconds > limitSeconds) {
                            distractionSeconds += (seconds - limitSeconds);
                        }
                    } else {
                        distractionSeconds += seconds;
                    }
                }

                sitesVisited.add(domain);

                const friendly = getFriendlyName(domain);
                if (!domainAggregation[friendly]) {
                    domainAggregation[friendly] = { seconds: 0, isStudy: isStudy || tempFocusSeconds > 0 };
                }
                domainAggregation[friendly].seconds += seconds;
            });
        });

        // Update Stats Cards
        document.getElementById('totalFocusTime').textContent = formatTime(focusSeconds);
        document.getElementById('totalDistractionTime').textContent = formatTime(distractionSeconds);
        document.getElementById('sitesVisitedCount').textContent = sitesVisited.size;

        // Streak
        const streak = calculateStreak(stats, studyDomains);
        document.getElementById('streakCount').textContent = `${streak} day${streak !== 1 ? 's' : ''}`;

        // Focus Score — uses weighted algorithm if session data is available
        const total = focusSeconds + distractionSeconds;
        let score = total > 0 ? Math.round((focusSeconds / total) * 100) : 0;
        let longestStreak = 0;

        if (window._statsDB && window._statsDB.getSessionsByDate) {
          (async () => {
            try {
              let allSessions = [];
              for (const date of datesToProcess) {
                const daySessions = await window._statsDB.getSessionsByDate(date);
                allSessions = allSessions.concat(daySessions);
              }
              if (allSessions.length > 0) {
                const weighted = window._statsDB.calculateWeightedScore(allSessions);
                score = weighted.score;
                longestStreak = weighted.longestStreak;
                document.getElementById('focusScore').textContent = score;
                // Show longest streak if we have a place for it
                const streakEl = document.getElementById('longestSessionDisplay');
                if (streakEl) {
                  const mins = Math.floor(longestStreak / 60);
                  streakEl.textContent = mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
                }
              }
            } catch (e) {
              // Fallback to simple score already set
            }
          })();
        }

        document.getElementById('focusScore').textContent = score;

        // Trends (Simulated or based on prev period)
        updateTrends(isWeekly, focusSeconds, distractionSeconds, sitesVisited.size);

        // Top Sites List
        const sortedGrouped = Object.entries(domainAggregation).sort((a, b) => b[1].seconds - a[1].seconds);
        const list = document.getElementById('topSitesList');
        list.innerHTML = '';
        sortedGrouped.slice(0, 5).forEach(([name, d]) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="site-info">
                    <div class="site-name">${name}</div>
                </div>
                <div class="site-time">${formatTime(d.seconds)}</div>
            `;
            list.appendChild(li);
        });

        // Chart Update
        if (isWeekly) {
            renderWeeklyBarChart(stats, datesToProcess, studyDomains);
        } else {
            const topForChart = sortedGrouped.slice(0, 6).map(([name, d]) => ({
                name: name,
                value: d.seconds,
                isStudy: d.isStudy
            }));
            renderChart(topForChart);
        }

        // Focus vs Distraction Chart
        renderFocusVsDistractionChart(focusSeconds, distractionSeconds, domainAggregation);

        // Detailed Table
        updateDetailedTable(urlStats, datesToProcess);

        // Heatmap
        renderHeatmap(hourlyStats, datesToProcess);

        // Categories
        renderCategories(stats, datesToProcess);

        // Milestones
        renderMilestones(stats, studyDomains, hourlyStats);

        // Insights

    });
}

function updateTrends(isWeekly, focus, distraction, count) {
    const focusTrend = document.getElementById('focusTrend');
    const distractTrend = document.getElementById('distractionTrend');
    const siteTrend = document.getElementById('siteTrend');

    // Get previous period data for real comparison
    chrome.storage.local.get(['dailyStats', 'studyDomains'], (data) => {
        const stats = data.dailyStats || {};
        const studyDomains = data.studyDomains || [];

        let prevFocus = 0;
        let prevDistraction = 0;
        let prevSites = new Set();
        let prevDates = [];

        if (isWeekly) {
            // Compare this week vs last week
            for (let i = 7; i < 14; i++) {
                const d = new Date(currentViewDate);
                d.setDate(d.getDate() - i);
                prevDates.push(localDateStr(d));
            }
        } else {
            // Compare today vs yesterday
            const prev = new Date(currentViewDate);
            prev.setDate(prev.getDate() - 1);
            prevDates.push(localDateStr(prev));
        }

        prevDates.forEach(date => {
            const dayStats = stats[date] || {};
            Object.entries(dayStats).forEach(([domain, seconds]) => {
                const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
                if (isStudy) prevFocus += seconds;
                else prevDistraction += seconds;
                prevSites.add(domain);
            });
        });

        const periodLabel = isWeekly ? 'vs last week' : 'vs yesterday';

        // Focus trend
        const focusDelta = focus - prevFocus;
        renderTrend(focusTrend, focusDelta, periodLabel, true);

        // Distraction trend (lower is better, so invert the arrow logic)
        const distractDelta = distraction - prevDistraction;
        renderTrend(distractTrend, distractDelta, periodLabel, false);

        // Sites trend
        const sitesDelta = count - prevSites.size;
        renderSitesTrend(siteTrend, sitesDelta, periodLabel);
    });
}

function renderTrend(el, deltaSeconds, periodLabel, higherIsGood) {
    if (deltaSeconds === 0) {
        el.textContent = `— No change ${periodLabel}`;
        el.className = 'trend neutral';
        return;
    }

    const absDelta = Math.abs(deltaSeconds);
    const timeStr = formatTimeDelta(absDelta);
    const isPositive = deltaSeconds > 0;
    const isGood = higherIsGood ? isPositive : !isPositive;
    const arrow = isPositive ? '↑' : '↓';

    el.textContent = `${arrow} ${timeStr} ${periodLabel}`;
    el.className = `trend ${isGood ? 'up' : 'down'}`;
}

function renderSitesTrend(el, delta, periodLabel) {
    if (delta === 0) {
        el.textContent = `— No change ${periodLabel}`;
        el.className = 'trend neutral';
        return;
    }

    const arrow = delta > 0 ? '↑' : '↓';
    el.textContent = `${arrow} ${Math.abs(delta)} sites ${periodLabel}`;
    el.className = `trend neutral`;
}

function formatTimeDelta(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
}

function updateDetailedTable(urlStats, dates) {
    const tableBody = document.getElementById('activityBody');
    tableBody.innerHTML = '';
    let aggregatedUrls = {};

    dates.forEach(date => {
        const dayUrls = urlStats[date] || {};
        Object.entries(dayUrls).forEach(([url, info]) => {
            if (!aggregatedUrls[url]) {
                aggregatedUrls[url] = { ...info };
            } else {
                aggregatedUrls[url].duration += info.duration;
            }
        });
    });

    const sorted = Object.entries(aggregatedUrls).sort((a, b) => b[1].duration - a[1].duration).slice(0, 10);
    sorted.forEach(([url, info]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><div class="page-title" title="${info.title}">${info.title}</div></td>
            <td><span class="domain-badge">${info.domain}</span></td>
            <td><span class="site-time">${formatTime(info.duration)}</span></td>
        `;
        tableBody.appendChild(row);
    });
}


function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function getFriendlyName(domain) {
    if (!domain) return 'None';

    // Remove common subdomains like web., mail., drive., etc.
    let name = domain.replace(/^(www|web|mail|drive|docs|calendar|apps|m)\./i, '');

    // Get the core domain part (before the first dot in what remains)
    name = name.split('.')[0];

    // Handle specific cases or capitalize
    if (name.toLowerCase() === 'whatsapp') return 'WhatsApp';
    if (name.toLowerCase() === 'youtube') return 'YouTube';
    if (name.toLowerCase() === 'github') return 'GitHub';

    return name.charAt(0).toUpperCase() + name.slice(1);
}

let myChart = null;
function renderChart(siteData) {
    const isDark = document.body.classList.contains('dark');

    // Sort so study sites might come first or just use the order provided
    const labels = siteData.map(s => s.name);
    const series = siteData.map(s => s.value);

    // Generate colors: Teal/Green for Study, Yellow/Orange for Distraction
    const colors = siteData.map(s => {
        if (s.isStudy) {
            return isDark ? '#2dd4bf' : '#14b8a6'; // Back to vibrant teal
        } else {
            return isDark ? '#fbbf24' : '#facc15'; // Back to bright yellow
        }
    });

    const options = {
        series: series,
        chart: {
            type: 'donut',
            height: '100%',
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 800
            },
            fontFamily: 'Outfit, sans-serif'
        },
        labels: labels,
        colors: colors,
        stroke: {
            show: false
        },
        plotOptions: {
            pie: {
                donut: {
                    size: '75%',
                    labels: {
                        show: true,
                        name: {
                            show: true,
                            fontSize: '14px',
                            fontWeight: 600,
                            color: isDark ? '#94a3b8' : '#64748b',
                            offsetY: -10
                        },
                        value: {
                            show: true,
                            fontSize: '24px',
                            fontWeight: 800,
                            color: isDark ? '#f8fafc' : '#0f172a',
                            offsetY: 10,
                            formatter: (val) => formatTime(val)
                        },
                        total: {
                            show: true,
                            label: 'Total Time',
                            color: isDark ? '#94a3b8' : '#64748b',
                            formatter: function (w) {
                                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                return formatTime(total);
                            }
                        }
                    }
                }
            }
        },
        legend: {
            show: true,
            position: 'bottom',
            horizontalAlign: 'center',
            fontSize: '13px',
            fontWeight: 500,
            labels: {
                colors: isDark ? '#94a3b8' : '#64748b'
            },
            markers: {
                radius: 12,
                width: 10,
                height: 10
            },
            itemMargin: {
                horizontal: 8,
                vertical: 4
            }
        },
        dataLabels: {
            enabled: false
        },
        tooltip: {
            theme: isDark ? 'dark' : 'light',
            y: {
                formatter: (val) => formatTime(val)
            }
        },
        responsive: [{
            breakpoint: 480,
            options: {
                chart: {
                    height: 300
                },
                legend: {
                    position: 'bottom'
                }
            }
        }]
    };

    const chartElement = document.querySelector("#usageChart");
    if (!chartElement) return;

    if (myChart) {
        myChart.destroy();
    }

    myChart = new ApexCharts(chartElement, options);
    myChart.render();
}

let focusDistChart = null;
let _focusDistData = { focus: 0, distraction: 0, sites: {} };

function renderFocusVsDistractionChart(focusSec, distractionSec, domainAggregation) {
    // Store data for when user toggles to this view
    _focusDistData = { focus: focusSec, distraction: distractionSec, sites: domainAggregation || {} };

    // Only render if currently visible
    const chartElement = document.querySelector("#focusVsDistractionChart");
    if (!chartElement || chartElement.style.display === 'none') return;

    _renderFocusDistChart();
}

function _renderFocusDistChart() {
    const isDark = document.body.classList.contains('dark');
    const chartElement = document.querySelector("#focusVsDistractionChart");
    if (!chartElement) return;

    // Build per-site breakdown: focus sites and distraction sites separately
    const sites = _focusDistData.sites;
    const sorted = Object.entries(sites).sort((a, b) => b[1].seconds - a[1].seconds);
    const topSites = sorted.slice(0, 8);

    const labels = topSites.map(([name]) => name);
    const series = topSites.map(([, d]) => d.seconds);
    const colors = topSites.map(([, d]) => {
        if (d.isStudy) {
            return isDark ? '#2dd4bf' : '#14b8a6';
        } else {
            return isDark ? '#fbbf24' : '#f59e0b';
        }
    });

    const options = {
        series: series,
        chart: {
            type: 'donut',
            height: '100%',
            animations: { enabled: true, easing: 'easeinout', speed: 800 },
            fontFamily: 'Outfit, sans-serif'
        },
        labels: labels,
        colors: colors,
        stroke: { show: false },
        plotOptions: {
            pie: {
                donut: {
                    size: '75%',
                    labels: {
                        show: true,
                        name: {
                            show: true,
                            fontSize: '14px',
                            fontWeight: 600,
                            color: isDark ? '#94a3b8' : '#64748b',
                            offsetY: -10
                        },
                        value: {
                            show: true,
                            fontSize: '24px',
                            fontWeight: 800,
                            color: isDark ? '#f8fafc' : '#0f172a',
                            offsetY: 10,
                            formatter: (val) => formatTime(val)
                        },
                        total: {
                            show: true,
                            label: 'Total Time',
                            color: isDark ? '#94a3b8' : '#64748b',
                            formatter: function (w) {
                                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                return formatTime(total);
                            }
                        }
                    }
                }
            }
        },
        legend: {
            show: true,
            position: 'bottom',
            horizontalAlign: 'center',
            fontSize: '13px',
            fontWeight: 500,
            labels: { colors: isDark ? '#94a3b8' : '#64748b' },
            markers: { radius: 12, width: 10, height: 10 },
            itemMargin: { horizontal: 12, vertical: 4 }
        },
        dataLabels: { enabled: false },
        tooltip: {
            theme: isDark ? 'dark' : 'light',
            y: { formatter: (val) => formatTime(val) }
        },
        responsive: [{
            breakpoint: 480,
            options: { chart: { height: 300 }, legend: { position: 'bottom' } }
        }]
    };

    if (focusDistChart) {
        focusDistChart.destroy();
    }

    focusDistChart = new ApexCharts(chartElement, options);
    focusDistChart.render();
}

function renderWeeklyBarChart(allStats, dates, studyDomains) {
    const isDark = document.body.classList.contains('dark');

    // Reverse dates to go left-to-right (oldest to newest)
    const reversedDates = [...dates].reverse();
    const categories = reversedDates.map(date => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    });

    const focusSeries = [];
    const distractionSeries = [];

    reversedDates.forEach(date => {
        const dayStats = allStats[date] || {};
        let f = 0;
        let d = 0;
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            const isStudy = studyDomains.some(sd => domain === sd || domain.endsWith('.' + sd));
            if (isStudy) f += seconds;
            else d += seconds;
        });
        focusSeries.push(f);
        distractionSeries.push(d);
    });

    const options = {
        series: [
            { name: 'Focus', data: focusSeries },
            { name: 'Distracted', data: distractionSeries }
        ],
        chart: {
            type: 'bar',
            height: '100%',
            stacked: true,
            toolbar: { show: false },
            fontFamily: 'Outfit, sans-serif'
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '55%',
                borderRadius: 8,
                borderRadiusApplication: 'end', // Only round the top (end) of the bars
                borderRadiusWhenStacked: 'last' // Only round the top of the entire stack
            }
        },
        dataLabels: { enabled: false },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: {
            categories: categories,
            labels: {
                style: { colors: isDark ? '#94a3b8' : '#64748b' }
            }
        },
        yaxis: {
            labels: {
                formatter: (val) => formatTime(val),
                style: { colors: isDark ? '#94a3b8' : '#64748b' }
            }
        },
        fill: { opacity: 1 },
        colors: [isDark ? '#2dd4bf' : '#14b8a6', isDark ? '#fbbf24' : '#facc15'],
        legend: {
            show: true,
            position: 'bottom',
            labels: { colors: isDark ? '#94a3b8' : '#64748b' }
        },
        tooltip: {
            theme: isDark ? 'dark' : 'light',
            y: { formatter: (val) => formatTime(val) }
        }
    };

    const chartElement = document.querySelector("#usageChart");
    if (!chartElement) return;
    if (myChart) myChart.destroy();
    myChart = new ApexCharts(chartElement, options);
    myChart.render();
}

const SITE_CATEGORIES = {
    'Social Media': ['facebook.com','instagram.com','twitter.com','x.com','reddit.com','linkedin.com','snapchat.com','tiktok.com','threads.net','mastodon.social'],
    'Video & Streaming': ['youtube.com','netflix.com','twitch.tv','hotstar.com','primevideo.com','disneyplus.com','vimeo.com','dailymotion.com'],
    'Dev Tools': ['github.com','gitlab.com','stackoverflow.com','codepen.io','replit.com','vercel.app','netlify.app','heroku.com','aws.amazon.com','console.cloud.google.com'],
    'Research & Learning': ['scholar.google.com','wikipedia.org','medium.com','arxiv.org','coursera.org','udemy.com','khanacademy.org','edx.org','geeksforgeeks.org','w3schools.com'],
    'Communication': ['mail.google.com','outlook.com','slack.com','discord.com','teams.microsoft.com','telegram.org','web.whatsapp.com','zoom.us'],
    'Productivity': ['notion.so','docs.google.com','drive.google.com','trello.com','asana.com','todoist.com','figma.com','canva.com','sheets.google.com'],
    'Shopping & News': ['amazon.com','flipkart.com','myntra.com','news.google.com','bbc.com','cnn.com'],
    'AI Tools': ['chat.openai.com','claude.ai','bard.google.com','copilot.microsoft.com','perplexity.ai']
};

function categorize(domain) {
    for (const [category, domains] of Object.entries(SITE_CATEGORIES)) {
        if (domains.some(d => domain === d || domain.endsWith('.' + d.split('.').slice(-2).join('.')))) return category;
    }
    return 'Other';
}

const CATEGORY_ICONS = {
    'Social Media': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
    'Video & Streaming': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    'Dev Tools': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    'Research & Learning': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    'Communication': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'Productivity': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    'Shopping & News': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    'AI Tools': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M4 10h16"/><rect x="2" y="8" width="20" height="14" rx="2"/><path d="M9 15h.01"/><path d="M15 15h.01"/></svg>',
    'Other': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
};

const CATEGORY_COLORS = {
    'Social Media': '#f472b6', 'Video & Streaming': '#fb923c', 'Dev Tools': '#34d399',
    'Research & Learning': '#60a5fa', 'Communication': '#a78bfa', 'Productivity': '#fbbf24',
    'Shopping & News': '#f87171', 'AI Tools': '#2dd4bf', 'Other': '#94a3b8'
};

function renderCategories(stats, dates) {
    const categoryTotals = {};
    dates.forEach(date => {
        const dayStats = stats[date] || {};
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            const cat = categorize(domain);
            categoryTotals[cat] = (categoryTotals[cat] || 0) + seconds;
        });
    });
    const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const totalTime = sorted.reduce((sum, [, s]) => sum + s, 0) || 1;
    const grid = document.getElementById('categoryGrid');
    grid.innerHTML = '';
    sorted.forEach(([cat, seconds]) => {
        const pct = Math.round((seconds / totalTime) * 100);
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
            <div class="category-header">
                <span class="category-icon" style="color:${CATEGORY_COLORS[cat] || '#94a3b8'}">${CATEGORY_ICONS[cat] || CATEGORY_ICONS['Other']}</span>
                <span class="category-name">${cat}</span>
                <span class="category-pct">${pct}%</span>
            </div>
            <div class="category-time">${formatTime(seconds)}</div>
            <div class="category-bar">
                <div class="category-bar-fill" style="width:${pct}%;background:${CATEGORY_COLORS[cat] || '#94a3b8'}"></div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderHeatmap(hourlyStats, dates) {
    const grid = document.getElementById('heatmapGrid');
    grid.innerHTML = '';
    const isWeekly = dates.length > 1;

    if (isWeekly) {
        // Date-wise rows
        grid.classList.add('heatmap-weekly');
        grid.classList.remove('heatmap-daily');
        // Header row
        const corner = document.createElement('div');
        corner.className = 'heatmap-header-cell';
        grid.appendChild(corner);
        for (let h = 0; h < 24; h++) {
            const hdr = document.createElement('div');
            hdr.className = 'heatmap-header-cell';
            hdr.textContent = formatHour(h);
            grid.appendChild(hdr);
        }
        // Find max for color scaling
        let maxTotal = 0;
        dates.forEach(date => {
            const day = hourlyStats[date] || {};
            Object.values(day).forEach(v => {
                const total = (v.focus || 0) + (v.distraction || 0);
                maxTotal = Math.max(maxTotal, total);
            });
        });
        maxTotal = maxTotal || 1;
        // Date rows (oldest first)
        [...dates].reverse().forEach(date => {
            const d = new Date(date + 'T00:00:00');
            const label = document.createElement('div');
            label.className = 'heatmap-row-label';
            label.textContent = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            grid.appendChild(label);
            const day = hourlyStats[date] || {};
            for (let h = 0; h < 24; h++) {
                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';
                const val = day[String(h)] || { focus: 0, distraction: 0 };
                const total = val.focus + val.distraction;
                const focusRatio = total > 0 ? val.focus / total : 0;
                const intensity = total / maxTotal;
                const isDark = document.body.classList.contains('dark');
                const hue = focusRatio >= 0.5 ? 168 : 0;
                const sat = total > 0 ? 75 : 0;
                const lightness = isDark ? 45 : 38;
                const alpha = isDark ? Math.max(intensity * 0.9, 0.06) : Math.max(intensity * 0.85, 0.08);
                cell.style.backgroundColor = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
                cell.title = total > 0 ? `${formatHour(h)}: ${formatTime(val.focus)} focus, ${formatTime(val.distraction)} distracted` : `${formatHour(h)}: No activity`;
                grid.appendChild(cell);
            }
        });
    } else {
        // Single day - 2 rows of 12
        grid.classList.add('heatmap-daily');
        grid.classList.remove('heatmap-weekly');
        const hourData = Array(24).fill(null).map(() => ({ focus: 0, distraction: 0 }));
        const day = hourlyStats[dates[0]] || {};
        Object.entries(day).forEach(([h, val]) => {
            const idx = parseInt(h);
            if (idx >= 0 && idx < 24 && val) {
                hourData[idx].focus += (val.focus || 0);
                hourData[idx].distraction += (val.distraction || 0);
            }
        });
        const maxTotal = Math.max(...hourData.map(h => h.focus + h.distraction), 1);
        for (let h = 0; h < 24; h++) {
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            const total = hourData[h].focus + hourData[h].distraction;
            const focusRatio = total > 0 ? hourData[h].focus / total : 0;
            const intensity = total / maxTotal;
            const isDark = document.body.classList.contains('dark');
            const hue = focusRatio >= 0.5 ? 168 : 0;
            const sat = total > 0 ? 75 : 0;
            const lightness = isDark ? 45 : 38;
            const alpha = isDark ? Math.max(intensity * 0.9, 0.06) : Math.max(intensity * 0.85, 0.08);
            cell.style.backgroundColor = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
            cell.innerHTML = `<span class="heatmap-hour">${formatHour(h)}</span>`;
            cell.title = total > 0 ? `${formatHour(h)}: ${formatTime(hourData[h].focus)} focus, ${formatTime(hourData[h].distraction)} distracted` : `${formatHour(h)}: No activity`;
            grid.appendChild(cell);
        }
    }
}

function formatHour(h) {
    if (h === 0) return '12 AM';
    if (h < 12) return h + ' AM';
    if (h === 12) return '12 PM';
    return (h - 12) + ' PM';
}


const MILESTONES = [
    // Streak badges
    { id: 'streak3', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>', title: 'Warming Up', desc: '3 day streak', check: (d) => d.streak >= 3, color: '#fb923c' },
    { id: 'streak7', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>', title: 'On Fire', desc: '7 day streak', check: (d) => d.streak >= 7, color: '#ef4444' },
    { id: 'streak30', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>', title: 'Unstoppable', desc: '30 day streak', check: (d) => d.streak >= 30, color: '#a855f7' },
    // Total hours
    { id: 'hours1', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', title: 'First Hour', desc: '1 hour total focus', check: (d) => d.totalHours >= 1, color: '#60a5fa' },
    { id: 'hours10', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', title: 'Dedicated', desc: '10 hours total focus', check: (d) => d.totalHours >= 10, color: '#34d399' },
    { id: 'hours50', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', title: 'Scholar', desc: '50 hours total focus', check: (d) => d.totalHours >= 50, color: '#f59e0b' },
    { id: 'hours100', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', title: 'Centurion', desc: '100 hours total focus', check: (d) => d.totalHours >= 100, color: '#ec4899' },
    // Score thresholds
    { id: 'score70', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>', title: 'Focused', desc: '70% score for 7 days', check: (d) => d.highScoreDays >= 7, color: '#14b8a6' },
    { id: 'score90', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>', title: 'Laser Focus', desc: '90% score for 3 days', check: (d) => d.eliteScoreDays >= 3, color: '#fbbf24' },
    // Special
    { id: 'noDistract', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', title: 'Zero Distractions', desc: 'A full day with 100% focus', check: (d) => d.perfectDays >= 1, color: '#22c55e' },
    { id: 'earlyBird', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>', title: 'Early Bird', desc: 'Focused before 8 AM', check: (d) => d.earlyBird, color: '#fbbf24' },
];

function computeMilestoneData(stats, studyDomains, hourlyStats) {
    let totalFocusSeconds = 0;
    let streak = 0;
    let highScoreDays = 0;
    let eliteScoreDays = 0;
    let perfectDays = 0;
    let earlyBird = false;

    const today = new Date();
    const allDates = Object.keys(stats).sort();

    // Total focus hours & score days
    allDates.forEach(date => {
        const dayStats = stats[date] || {};
        let dayFocus = 0;
        let dayDistraction = 0;
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            if (studyDomains.some(d => domain === d || domain.endsWith('.' + d))) dayFocus += seconds;
            else dayDistraction += seconds;
        });
        totalFocusSeconds += dayFocus;
        const total = dayFocus + dayDistraction;
        const score = total > 0 ? (dayFocus / total) * 100 : 0;
        if (score >= 70 && total > 600) highScoreDays++;
        if (score >= 90 && total > 600) eliteScoreDays++;
        if (score === 100 && dayFocus >= 600) perfectDays++;
    });

    // Streak
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = localDateStr(d);
        const dayStats = stats[dateStr] || {};
        let focusSec = 0;
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            if (studyDomains.some(sd => domain === sd || domain.endsWith('.' + sd))) focusSec += seconds;
        });
        if (focusSec >= 600) streak++;
        else break;
    }

    // Early bird check
    if (hourlyStats) {
        Object.entries(hourlyStats).forEach(([date, hours]) => {
            Object.entries(hours).forEach(([h, val]) => {
                if (parseInt(h) < 8 && val.focus >= 300) earlyBird = true;
            });
        });
    }

    return {
        streak,
        totalHours: totalFocusSeconds / 3600,
        highScoreDays,
        eliteScoreDays,
        perfectDays,
        earlyBird
    };
}

function renderMilestones(stats, studyDomains, hourlyStats) {
    const data = computeMilestoneData(stats, studyDomains, hourlyStats);
    const grid = document.getElementById('badgesGrid');
    grid.innerHTML = '';
    MILESTONES.forEach(m => {
        const unlocked = m.check(data);
        const badge = document.createElement('div');
        badge.className = `badge-card ${unlocked ? 'unlocked' : 'locked'}`;
        badge.innerHTML = `
            <div class="badge-icon" style="color:${unlocked ? m.color : 'var(--muted)'}; border-color:${unlocked ? m.color : 'var(--border)'}">
                ${m.icon}
            </div>
            <div class="badge-info">
                <span class="badge-title">${m.title}</span>
                <span class="badge-desc">${m.desc}</span>
            </div>
            ${unlocked ? '<span class="badge-unlocked-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span>' : ''}
        `;
        grid.appendChild(badge);
    });
}

function exportData(format) {
    chrome.storage.local.get(['dailyStats', 'dailyUrlStats', 'studyDomains'], (data) => {
        const stats = data.dailyStats || {};
        const studyDomains = data.studyDomains || [];
        if (format === 'json') {
            const blob = new Blob([JSON.stringify({ dailyStats: stats, studyDomains }, null, 2)], { type: 'application/json' });
            downloadBlob(blob, 'hocus-focus-data.json');
        } else {
            let csv = 'Date,Domain,Category,Seconds,Type\n';
            Object.entries(stats).forEach(([date, domains]) => {
                Object.entries(domains).forEach(([domain, seconds]) => {
                    const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
                    csv += `${date},${domain},${categorize(domain)},${seconds},${isStudy ? 'focus' : 'distraction'}\n`;
                });
            });
            const blob = new Blob([csv], { type: 'text/csv' });
            downloadBlob(blob, 'hocus-focus-data.csv');
        }
    });
    document.getElementById('exportMenu').classList.remove('active');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================
// Custom Milestones Feature
// ============================================

const CUSTOM_MILESTONE_ICONS = {
    star: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    target: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    trophy: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V18a2 2 0 0 1-2-2V4h8v12a2 2 0 0 1-2 2v4"/></svg>',
    zap: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    award: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>',
    rocket: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>'
};


function initCustomMilestones() {
    const addBtn = document.getElementById('addMilestoneBtn');
    const modal = document.getElementById('milestoneModal');
    const closeBtn = document.getElementById('closeMilestoneModal');
    const cancelBtn = document.getElementById('cancelMilestone');
    const form = document.getElementById('milestoneForm');
    const typeSelect = document.getElementById('milestoneType');
    const hintEl = document.getElementById('milestoneHint');
    const colorGrid = document.getElementById('colorSwatchGrid');
    const iconGrid = document.getElementById('iconSelectGrid');
    const targetTimeGroup = document.getElementById('targetTimeGroup');
    const targetStreakGroup = document.getElementById('targetStreakGroup');

    // Open modal
    addBtn.addEventListener('click', () => {
        modal.classList.add('active');
    });

    // Close modal
    function closeModal() {
        modal.classList.remove('active');
        form.reset();
        document.getElementById('milestoneHours').value = '0';
        document.getElementById('milestoneMinutes').value = '0';
        document.getElementById('milestoneSeconds').value = '0';
        colorGrid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        colorGrid.querySelector('[data-color="#6366f1"]').classList.add('selected');
        iconGrid.querySelectorAll('.icon-option').forEach(btn => btn.classList.remove('selected'));
        iconGrid.querySelector('[data-icon="star"]').classList.add('selected');
        targetTimeGroup.style.display = '';
        targetStreakGroup.style.display = 'none';
    }

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Type switch: show time inputs or streak input
    typeSelect.addEventListener('change', () => {
        if (typeSelect.value === 'streak') {
            targetTimeGroup.style.display = 'none';
            targetStreakGroup.style.display = '';
        } else {
            targetTimeGroup.style.display = '';
            targetStreakGroup.style.display = 'none';
            if (typeSelect.value === 'totalHours') {
                hintEl.textContent = 'Set the target total focus duration';
            } else {
                hintEl.textContent = 'Set the target daily focus duration';
            }
        }
    });

    // Color swatch selection
    colorGrid.addEventListener('click', (e) => {
        const swatch = e.target.closest('.color-swatch');
        if (!swatch) return;
        colorGrid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
    });

    // Icon selection
    iconGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.icon-option');
        if (!btn) return;
        iconGrid.querySelectorAll('.icon-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
    });

    // Form submit
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('milestoneTitle').value.trim();
        const desc = document.getElementById('milestoneDesc').value.trim();
        const type = typeSelect.value;
        const selectedColor = colorGrid.querySelector('.color-swatch.selected');
        const color = selectedColor ? selectedColor.dataset.color : '#6366f1';
        const selectedIcon = iconGrid.querySelector('.icon-option.selected');
        const icon = selectedIcon ? selectedIcon.dataset.icon : 'star';

        if (!title || !desc) return;

        let target;
        if (type === 'streak') {
            target = parseInt(document.getElementById('milestoneStreakDays').value) || 0;
            if (target <= 0) return;
        } else {
            const hours = parseInt(document.getElementById('milestoneHours').value) || 0;
            const minutes = parseInt(document.getElementById('milestoneMinutes').value) || 0;
            const seconds = parseInt(document.getElementById('milestoneSeconds').value) || 0;
            target = hours + (minutes / 60) + (seconds / 3600); // Store as fractional hours
            if (target <= 0) return;
        }

        const milestone = {
            id: 'custom_' + Date.now(),
            title,
            desc,
            type,
            target,
            color,
            icon,
            createdAt: new Date().toISOString()
        };

        saveCustomMilestone(milestone, () => {
            closeModal();
            refreshCustomMilestones();
        });
    });

    // Initial render
    refreshCustomMilestones();
}

function saveCustomMilestone(milestone, callback) {
    chrome.storage.local.get(['customMilestones'], (data) => {
        const milestones = data.customMilestones || [];
        milestones.push(milestone);
        chrome.storage.local.set({ customMilestones: milestones }, callback);
    });
}

function deleteCustomMilestone(id) {
    chrome.storage.local.get(['customMilestones'], (data) => {
        const milestones = (data.customMilestones || []).filter(m => m.id !== id);
        chrome.storage.local.set({ customMilestones: milestones }, () => {
            refreshCustomMilestones();
        });
    });
}

function refreshCustomMilestones() {
    chrome.storage.local.get(['customMilestones', 'dailyStats', 'studyDomains', 'hourlyStats'], (data) => {
        const milestones = data.customMilestones || [];
        const stats = data.dailyStats || {};
        const studyDomains = data.studyDomains || [];
        const section = document.getElementById('customMilestonesSection');
        const grid = document.getElementById('customBadgesGrid');

        if (milestones.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        grid.innerHTML = '';

        // Compute progress data
        const progressData = computeCustomMilestoneProgress(stats, studyDomains, data.hourlyStats || {});

        milestones.forEach(m => {
            const progress = getCustomMilestoneProgress(m, progressData);
            const unlocked = progress.current >= progress.target;

            let progressText;
            if (unlocked) {
                progressText = '✓ Achieved!';
            } else if (m.type === 'streak') {
                progressText = `${Math.floor(progress.current)} / ${Math.floor(progress.target)} days`;
            } else if (progress.target === 1 && progress.current === 0) {
                progressText = 'Not yet achieved';
            } else {
                progressText = `${formatDuration(progress.current)} / ${formatDuration(progress.target)}`;
            }

            const badge = document.createElement('div');
            badge.className = `badge-card ${unlocked ? 'unlocked' : 'locked'}`;
            badge.innerHTML = `
                <div class="badge-icon" style="color:${unlocked ? m.color : 'var(--muted)'}; border-color:${unlocked ? m.color : 'var(--border)'}">
                    ${CUSTOM_MILESTONE_ICONS[m.icon] || CUSTOM_MILESTONE_ICONS.star}
                </div>
                <div class="badge-info">
                    <span class="badge-title">${escapeHtml(m.title)}</span>
                    <span class="badge-desc">${escapeHtml(m.desc)}</span>
                    <span class="custom-badge-progress">${progressText}</span>
                </div>
                ${unlocked ? '<span class="badge-unlocked-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span>' : ''}
                <button class="delete-milestone-btn" data-id="${m.id}" title="Delete milestone">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            `;
            grid.appendChild(badge);
        });

        // Delete buttons
        grid.querySelectorAll('.delete-milestone-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (confirm('Delete this custom milestone?')) {
                    deleteCustomMilestone(id);
                }
            });
        });
    });
}

function computeCustomMilestoneProgress(stats, studyDomains, hourlyStats) {
    let totalFocusSeconds = 0;
    let streak = 0;
    let maxDailyHours = 0;

    const today = new Date();
    const allDates = Object.keys(stats).sort();

    // Total focus hours & max daily
    allDates.forEach(date => {
        const dayStats = stats[date] || {};
        let dayFocus = 0;
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            if (studyDomains.some(d => domain === d || domain.endsWith('.' + d))) {
                dayFocus += seconds;
            }
        });
        totalFocusSeconds += dayFocus;
        const dayHours = dayFocus / 3600;
        if (dayHours > maxDailyHours) maxDailyHours = dayHours;
    });

    // Streak
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = localDateStr(d);
        const dayStats = stats[dateStr] || {};
        let focusSec = 0;
        Object.entries(dayStats).forEach(([domain, seconds]) => {
            if (studyDomains.some(sd => domain === sd || domain.endsWith('.' + sd))) focusSec += seconds;
        });
        if (focusSec >= 600) streak++;
        else break;
    }

    // Night owl: collect which hours have focus activity across all dates
    // Store a map of hour -> total focus seconds across all days
    const nightOwlHours = {};
    Object.entries(hourlyStats).forEach(([date, dayData]) => {
        Object.entries(dayData).forEach(([hour, val]) => {
            const h = parseInt(hour);
            const focusSec = val.focus || 0;
            if (focusSec > 0) {
                nightOwlHours[h] = (nightOwlHours[h] || 0) + focusSec;
            }
        });
    });

    return {
        totalHours: totalFocusSeconds / 3600,
        streak,
        maxDailyHours,
        nightOwlHours
    };
}

function getCustomMilestoneProgress(milestone, progressData) {
    // Auto-detect night owl from description (e.g. "studying after 10pm", "focus after 11 PM")
    const desc = (milestone.desc || '').toLowerCase();
    const afterMatch = desc.match(/after\s*(\d{1,2})\s*(pm|am)/i);
    if (afterMatch) {
        let hour = parseInt(afterMatch[1]);
        const period = afterMatch[2].toLowerCase();
        if (period === 'pm' && hour < 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;
        
        const nightOwlHours = progressData.nightOwlHours || {};
        let totalLateSeconds = 0;
        // Check hours from the specified hour onward through early morning
        for (let h = 0; h < 24; h++) {
            const isLate = hour >= 12
                ? (h >= hour || h <= 4)  // e.g., after 10pm means 22,23,0,1,2,3,4
                : (h >= 0 && h <= 4 && h >= hour); // e.g., after 1am means 1,2,3,4
            if (isLate && nightOwlHours[h]) {
                totalLateSeconds += nightOwlHours[h];
            }
        }
        return { current: totalLateSeconds >= 60 ? 1 : 0, target: 1 };
    }

    switch (milestone.type) {
        case 'totalHours':
            return { current: progressData.totalHours, target: milestone.target };
        case 'streak':
            return { current: progressData.streak, target: milestone.target };
        case 'dailyHours':
            return { current: progressData.maxDailyHours, target: milestone.target };
        case 'nightOwl': {
            // Legacy support for any already-saved nightOwl type milestones
            const afterHour = milestone.targetHour != null ? milestone.targetHour : 22;
            let totalLateNightSeconds = 0;
            const nightOwlHours = progressData.nightOwlHours || {};
            for (let h = 0; h < 24; h++) {
                const isLateNight = afterHour >= 20
                    ? (h >= afterHour || h <= 3)
                    : (h >= afterHour && h <= 3);
                if (isLateNight && nightOwlHours[h]) {
                    totalLateNightSeconds += nightOwlHours[h];
                }
            }
            return { current: totalLateNightSeconds >= 60 ? 1 : 0, target: 1 };
        }
        default:
            return { current: 0, target: milestone.target };
    }
}

function formatDuration(hours) {
    const totalSeconds = Math.round(hours * 3600);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize custom milestones when DOM is ready
document.addEventListener('DOMContentLoaded', initCustomMilestones);

// ============================================
// Your Own Motivation
// ============================================
function initMotivationSection() {
    const input = document.getElementById('motivationInput');
    const addBtn = document.getElementById('addMotivationBtn');
    const list = document.getElementById('motivationList');

    loadMotivations();

    addBtn.addEventListener('click', addMotivation);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addMotivation();
    });

    function addMotivation() {
        const text = input.value.trim();
        if (!text) return;

        chrome.storage.local.get({ customNudges: [] }, (data) => {
            const nudges = data.customNudges;
            nudges.push(text);
            chrome.storage.local.set({ customNudges: nudges }, () => {
                input.value = '';
                loadMotivations();
            });
        });
    }

    function removeMotivation(index) {
        chrome.storage.local.get({ customNudges: [] }, (data) => {
            const nudges = data.customNudges;
            nudges.splice(index, 1);
            chrome.storage.local.set({ customNudges: nudges }, () => {
                loadMotivations();
            });
        });
    }

    function loadMotivations() {
        chrome.storage.local.get({ customNudges: [] }, (data) => {
            const nudges = data.customNudges || [];
            list.innerHTML = '';

            if (nudges.length === 0) {
                list.innerHTML = '<div class="motivation-empty">No custom messages yet. Add your own motivational nudges!</div>';
                return;
            }

            nudges.forEach((text, index) => {
                const item = document.createElement('div');
                item.className = 'motivation-item';
                item.innerHTML = `
                    <span class="motivation-item-text">"${escapeHtml(text)}"</span>
                    <button class="motivation-item-delete" title="Remove">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                `;
                item.querySelector('.motivation-item-delete').addEventListener('click', () => removeMotivation(index));
                list.appendChild(item);
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', initMotivationSection);

// ============================================
// Guide Modal
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const guideBtn = document.getElementById('guideBtn');
    const guideOverlay = document.getElementById('guideOverlay');
    const guideCloseBtn = document.getElementById('guideCloseBtn');

    guideBtn.addEventListener('click', () => {
        guideOverlay.classList.add('active');
    });

    guideCloseBtn.addEventListener('click', () => {
        guideOverlay.classList.remove('active');
    });

    guideOverlay.addEventListener('click', (e) => {
        if (e.target === guideOverlay) {
            guideOverlay.classList.remove('active');
        }
    });
});

// ============================================
// Tasks Dashboard
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const taskInput = document.getElementById('dashTaskInput');
    const addBtn = document.getElementById('dashAddTaskBtn');
    const taskList = document.getElementById('dashTaskList');
    const countEl = document.getElementById('dashTasksCount');

    function loadTasks() {
        chrome.storage.local.get({ tasks: [] }, (data) => {
            renderTasks(data.tasks);
        });
    }

    function saveTasks(tasks) {
        chrome.storage.local.set({ tasks }, () => renderTasks(tasks));
    }

    function renderTasks(tasks) {
        taskList.innerHTML = '';
        const done = tasks.filter(t => t.done).length;
        countEl.textContent = `${done}/${tasks.length} completed`;

        if (tasks.length === 0) {
            taskList.innerHTML = '<li class="tasks-dash-empty">No tasks yet. Add one above!</li>';
            return;
        }

        tasks.forEach((task, i) => {
            const li = document.createElement('li');
            li.className = `tasks-dash-item ${task.done ? 'done' : ''}`;
            li.innerHTML = `
                <div class="tasks-dash-checkbox ${task.done ? 'checked' : ''}" data-index="${i}">
                    <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
                <span class="tasks-dash-text">${escapeHtml(task.text)}</span>
                <button class="tasks-dash-delete" data-index="${i}">&times;</button>
            `;
            taskList.appendChild(li);
        });

        // Checkbox
        taskList.querySelectorAll('.tasks-dash-checkbox').forEach(cb => {
            cb.addEventListener('click', () => {
                const idx = parseInt(cb.dataset.index);
                chrome.storage.local.get({ tasks: [] }, (data) => {
                    data.tasks[idx].done = !data.tasks[idx].done;
                    saveTasks(data.tasks);
                });
            });
        });

        // Delete
        taskList.querySelectorAll('.tasks-dash-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                chrome.storage.local.get({ tasks: [] }, (data) => {
                    data.tasks.splice(idx, 1);
                    saveTasks(data.tasks);
                });
            });
        });
    }

    function addTask() {
        const text = taskInput.value.trim();
        if (!text) return;
        chrome.storage.local.get({ tasks: [] }, (data) => {
            data.tasks.push({ text, done: false, createdAt: Date.now() });
            saveTasks(data.tasks);
            taskInput.value = '';
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    addBtn.addEventListener('click', addTask);
    taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
    });

    loadTasks();
});

// ============================================
// Chart Toggle (Sites vs Focus)
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const sitesBtn = document.getElementById('chartToggleSites');
    const focusBtn = document.getElementById('chartToggleFocus');
    const usageChart = document.getElementById('usageChart');
    const focusChart = document.getElementById('focusVsDistractionChart');
    const chartTitle = document.getElementById('chartTitle');

    sitesBtn.addEventListener('click', () => {
        sitesBtn.classList.add('active');
        focusBtn.classList.remove('active');
        usageChart.style.display = '';
        focusChart.style.display = 'none';
        chartTitle.textContent = 'Usage Distribution';
    });

    focusBtn.addEventListener('click', () => {
        focusBtn.classList.add('active');
        sitesBtn.classList.remove('active');
        focusChart.style.display = '';
        usageChart.style.display = 'none';
        chartTitle.textContent = 'Deep Work vs Distracted';
        _renderFocusDistChart();
    });
});
