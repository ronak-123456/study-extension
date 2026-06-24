let currentViewDate = new Date();

document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();

    // Auto-refresh only if we are looking at today
    setInterval(() => {
        if (isToday(currentViewDate)) {
            updateDashboard();
        }
    }, 10000);

    document.getElementById('prevDay').addEventListener('click', () => {
        currentViewDate.setDate(currentViewDate.getDate() - 1);
        updateDashboard();
    });

    document.getElementById('nextDay').addEventListener('click', () => {
        if (!isToday(currentViewDate)) {
            currentViewDate.setDate(currentViewDate.getDate() + 1);
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
    const dateString = currentViewDate.toISOString().split('T')[0];

    // Update date display
    document.getElementById('currentDate').textContent = currentViewDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Update date picker value
    const datePicker = document.getElementById('datePicker');
    if (datePicker) {
        datePicker.value = currentViewDate.toISOString().split('T')[0];
    }

    // Disable next button if we are at today
    document.getElementById('nextDay').disabled = isToday(currentViewDate);

    chrome.storage.local.get(['dailyStats', 'dailyUrlStats', 'studyDomains'], (data) => {
        const stats = data.dailyStats || {};
        const urlStats = data.dailyUrlStats || {};
        const todayStats = stats[dateString] || {};
        const todayUrlStats = urlStats[dateString] || {};
        const studyDomains = data.studyDomains || [];

        let totalFocusSeconds = 0;
        let totalDistractionSeconds = 0;
        const sortedSites = Object.entries(todayStats).sort((a, b) => b[1] - a[1]);

        sortedSites.forEach(([domain, seconds]) => {
            const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
            if (isStudy) {
                totalFocusSeconds += seconds;
            } else {
                totalDistractionSeconds += seconds;
            }
        });

        // Update Stats Cards
        document.getElementById('totalFocusTime').textContent = formatTime(totalFocusSeconds);

        // Calculate Comparison with Previous Day
        const prevDate = new Date(currentViewDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateString = prevDate.toISOString().split('T')[0];
        const prevDayStats = stats[prevDateString] || {};

        let prevFocusSeconds = 0;
        Object.entries(prevDayStats).forEach(([domain, seconds]) => {
            const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
            if (isStudy) prevFocusSeconds += seconds;
        });

        const trendElement = document.querySelector('.trend');
        if (prevFocusSeconds > 0) {
            const diff = totalFocusSeconds - prevFocusSeconds;
            const percent = Math.abs(Math.round((diff / prevFocusSeconds) * 100));
            const direction = diff >= 0 ? 'more' : 'less';
            trendElement.textContent = `Focusing ${percent}% ${direction} than previous day`;
            trendElement.className = `trend ${diff >= 0 ? 'up' : 'down'}`;
        } else {
            trendElement.textContent = "First day of data reached";
            trendElement.className = "trend";
        }
        if (sortedSites.length > 0) {
            const mainDistraction = sortedSites.find(([domain]) =>
                !studyDomains.some(d => domain === d || domain.endsWith('.' + d))
            );
            if (mainDistraction) {
                document.getElementById('topDistraction').textContent = getFriendlyName(mainDistraction[0]);
                document.getElementById('distractionTime').textContent = formatTime(mainDistraction[1]);
            } else {
                document.getElementById('topDistraction').textContent = "None";
                document.getElementById('distractionTime').textContent = "0m";
            }
        }

        const totalSeconds = totalFocusSeconds + totalDistractionSeconds;
        const focusRatio = totalSeconds > 0 ? Math.round((totalFocusSeconds / totalSeconds) * 100) : 0;
        document.getElementById('focusRatio').textContent = focusRatio + '%';
        document.getElementById('ratioProgress').style.width = focusRatio + '%';

        // Update Top Sites List
        const list = document.getElementById('topSitesList');
        list.innerHTML = '';
        sortedSites.slice(0, 5).forEach(([domain, seconds]) => {
            const li = document.createElement('li');
            li.innerHTML = `
        <div class="site-info">
          <div class="site-name">${getFriendlyName(domain)}</div>
        </div>
        <div class="site-time">${formatTime(seconds)}</div>
      `;
            list.appendChild(li);
        });

        // Update Detailed Activity Table
        const tableBody = document.getElementById('activityBody');
        tableBody.innerHTML = '';
        const sortedUrls = Object.entries(todayUrlStats).sort((a, b) => b[1].duration - a[1].duration);

        sortedUrls.forEach(([url, info]) => {
            const row = document.createElement('tr');
            row.innerHTML = `
        <td><div class="page-title" title="${info.title}">${info.title}</div></td>
        <td><span class="domain-badge">${info.domain}</span></td>
        <td><span class="site-time">${formatTime(info.duration)}</span></td>
      `;
            tableBody.appendChild(row);
        });

        // Prepare Data for Detailed Donut Chart
        const topSitesForChart = sortedSites.slice(0, 6).map(([domain, seconds]) => ({
            name: getFriendlyName(domain),
            value: seconds,
            isStudy: studyDomains.some(d => domain === d || domain.endsWith('.' + d))
        }));

        const otherSeconds = sortedSites.slice(6).reduce((acc, [_, seconds]) => acc + seconds, 0);
        if (otherSeconds > 0) {
            topSitesForChart.push({
                name: 'Other Sites',
                value: otherSeconds,
                isStudy: false // Default to distraction for others
            });
        }

        // Update Chart
        renderChart(topSitesForChart);
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

    // Remove www.
    let name = domain.replace(/^www\./i, '');

    // Remove common TLDs
    name = name.split('.')[0];

    // Capitalize first letter
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
            return isDark ? '#2dd4bf' : '#0d9488'; // Darker teal in light mode
        } else {
            return isDark ? '#fbbf24' : '#b45309'; // Deeper amber in light mode
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
