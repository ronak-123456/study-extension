let currentViewDate = new Date();
let currentViewMode = 'daily'; // 'daily' or 'weekly'

document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();

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

function updateDashboard() {
    const isWeekly = currentViewMode === 'weekly';
    const dateString = currentViewDate.toISOString().split('T')[0];

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

    chrome.storage.local.get(['dailyStats', 'dailyUrlStats', 'studyDomains'], (data) => {
        const stats = data.dailyStats || {};
        const urlStats = data.dailyUrlStats || {};
        const studyDomains = data.studyDomains || [];

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
                datesToProcess.push(d.toISOString().split('T')[0]);
            }
        } else {
            datesToProcess.push(dateString);
        }

        // Aggregate stats
        datesToProcess.forEach(date => {
            const dayStats = stats[date] || {};
            Object.entries(dayStats).forEach(([domain, seconds]) => {
                const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
                if (isStudy) focusSeconds += seconds;
                else distractionSeconds += seconds;

                sitesVisited.add(domain);

                const friendly = getFriendlyName(domain);
                if (!domainAggregation[friendly]) {
                    domainAggregation[friendly] = { seconds: 0, isStudy: isStudy };
                }
                domainAggregation[friendly].seconds += seconds;
            });
        });

        // Update Stats Cards
        document.getElementById('totalFocusTime').textContent = formatTime(focusSeconds);
        document.getElementById('totalDistractionTime').textContent = formatTime(distractionSeconds);
        document.getElementById('sitesVisitedCount').textContent = sitesVisited.size;

        // Simulated Longest Streak (could be calculated from more detailed data if available)
        const longestSession = isWeekly ? Math.round(focusSeconds / 7.5) : focusSeconds;
        document.getElementById('longestStreak').textContent = formatTime(Math.min(longestSession, 10800)); // cap at 3h for realism

        // Focus Score
        const total = focusSeconds + distractionSeconds;
        const score = total > 0 ? Math.round((focusSeconds / total) * 100) : 0;
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

        // Detailed Table
        updateDetailedTable(urlStats, datesToProcess);

        // Insights

    });
}

function updateTrends(isWeekly, focus, distraction, count) {
    // Simulated trends for the premium look
    const focusTrend = document.getElementById('focusTrend');
    const distractTrend = document.getElementById('distractionTrend');
    const siteTrend = document.getElementById('siteTrend');

    if (focus > 0) {
        focusTrend.textContent = `+${Math.round(focus * 0.1 / 60)}m vs previous`;
        focusTrend.className = 'trend up';
    }
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
