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
    });

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
        const dateStr = d.toISOString().split('T')[0];
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

    chrome.storage.local.get(['dailyStats', 'dailyUrlStats', 'studyDomains', 'hourlyStats'], (data) => {
        const stats = data.dailyStats || {};
        const urlStats = data.dailyUrlStats || {};
        const studyDomains = data.studyDomains || [];
        const hourlyStats = data.hourlyStats || {};

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

        // Streak
        const streak = calculateStreak(stats, studyDomains);
        document.getElementById('streakCount').textContent = `${streak} day${streak !== 1 ? 's' : ''}`;

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

        // Heatmap
        renderHeatmap(hourlyStats, datesToProcess);

        // Categories
        renderCategories(stats, datesToProcess);

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
            Object.values(day).forEach(v => { maxTotal = Math.max(maxTotal, v.focus + v.distraction); });
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
                const val = day[h] || { focus: 0, distraction: 0 };
                const total = val.focus + val.distraction;
                const focusRatio = total > 0 ? val.focus / total : 0;
                const intensity = total / maxTotal;
                const hue = focusRatio >= 0.5 ? 160 : 0;
                const sat = total > 0 ? 70 : 0;
                cell.style.backgroundColor = `hsla(${hue}, ${sat}%, 50%, ${Math.max(intensity * 0.9, 0.06)})`;
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
            hourData[parseInt(h)].focus += val.focus;
            hourData[parseInt(h)].distraction += val.distraction;
        });
        const maxTotal = Math.max(...hourData.map(h => h.focus + h.distraction), 1);
        for (let h = 0; h < 24; h++) {
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            const total = hourData[h].focus + hourData[h].distraction;
            const focusRatio = total > 0 ? hourData[h].focus / total : 0;
            const intensity = total / maxTotal;
            const hue = focusRatio >= 0.5 ? 160 : 0;
            const sat = total > 0 ? 70 : 0;
            cell.style.backgroundColor = `hsla(${hue}, ${sat}%, 50%, ${Math.max(intensity * 0.9, 0.06)})`;
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
