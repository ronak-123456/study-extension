document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();
    setInterval(updateDashboard, 10000); // Update every 10 seconds
});

function updateDashboard() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    chrome.storage.local.get(['dailyStats', 'dailyUrlStats', 'studyDomains'], (data) => {
        const stats = data.dailyStats || {};
        const urlStats = data.dailyUrlStats || {};
        const todayStats = stats[today] || {};
        const todayUrlStats = urlStats[today] || {};
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

        if (sortedSites.length > 0) {
            const mainDistraction = sortedSites.find(([domain]) =>
                !studyDomains.some(d => domain === d || domain.endsWith('.' + d))
            );
            if (mainDistraction) {
                document.getElementById('topDistraction').textContent = mainDistraction[0];
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
          <div class="site-name">${domain}</div>
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

        // Update Chart
        renderChart(totalFocusSeconds, totalDistractionSeconds);
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

let myChart = null;
function renderChart(focus, distraction) {
    const ctx = document.getElementById('usageChart').getContext('2d');

    if (myChart) {
        myChart.destroy();
    }

    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Focus', 'Distraction'],
            datasets: [{
                data: [focus, distraction],
                backgroundColor: ['#6abf9b', '#fca5a5'],
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: {
                            family: "'Inter', sans-serif",
                            size: 14
                        }
                    }
                }
            },
            cutout: '70%'
        }
    });
}
