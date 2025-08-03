// Converts total seconds into a human-readable "Xd Yh Zm" format.
function formatUptime(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return `${hours}h ${remainingMinutes}m`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
}

// Formats bytes into a human-readable size (e.g., KB, MB, GB).
function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Stores the processed data from the API.
let apiData = {};

// Tracks the collapsed/expanded state of each SSID group.
const expandedSsids = {};

// Cached DOM element references to avoid repeated queries.
const uptimeContent = document.getElementById('router-uptime-content');
const clientsGroupedContent = document.getElementById('clients-grouped-content');
const errorMessageContainer = document.getElementById('error-message-container');
const refreshButton = document.getElementById('refresh-button');
const fullScreenLoader = document.getElementById('full-screen-loader');

function showFullScreenLoader() {
    if (fullScreenLoader) {
        fullScreenLoader.classList.add('show');
    }
}

function hideFullScreenLoader() {
    if (fullScreenLoader) {
        fullScreenLoader.classList.remove('show');
    }
}

function showErrorMessage(message) {
    if (errorMessageContainer) {
        errorMessageContainer.textContent = message;
        errorMessageContainer.style.display = 'block';
    }
}

function hideErrorMessage() {
    if (errorMessageContainer) {
        errorMessageContainer.style.display = 'none';
        errorMessageContainer.textContent = '';
    }
}

// Processes raw API data into a structured format for rendering.
function transformData(data) {
    const transformed = {
        clients: [],
        router_uptimes: {},
        summary: {
            "Total All Connected": Number(data["total clients"])
        }
    };
    
    // Populates the summary with dynamic SSID client counts.
    for (const ssid in data.clients) {
        if (data.clients.hasOwnProperty(ssid)) {
            transformed.summary[ssid] = data.clients[ssid].length;
        }
    }
    
    // Formats and stores router uptimes.
    for (const routerId in data.router_uptimes) {
        if (data.router_uptimes.hasOwnProperty(routerId)) {
            transformed.router_uptimes[routerId] = formatUptime(Number(data.router_uptimes[routerId]));
        }
    }
    
    // Formats and restructures client data for the UI.
    for (const ssid in data.clients) {
        if (data.clients.hasOwnProperty(ssid)) {
            data.clients[ssid].forEach(client => {
                const [rxBytes, txBytes] = client["rx/tx"].split('/').map(Number);
                transformed.clients.push({
                    hostname: client.hostname,
                    rx_data: formatBytes(rxBytes),
                    ssid: ssid,
                    tx_data: formatBytes(txBytes),
                    uptime: formatUptime(Number(client.uptime))
                });
            });
        }
    }
    return transformed;
}

// Renders the router uptime and total client count.
function renderRouterUptime() {
    if (!uptimeContent) return;
    uptimeContent.innerHTML = '';

    for (const routerId in apiData.router_uptimes) {
        if (apiData.router_uptimes.hasOwnProperty(routerId)) {
            // Displays a shortened router name if a hyphen exists.
            const displayName = routerId.includes('-') ? `Router ${routerId.split('-')[1]}` : routerId;
            const uptimeParagraph = document.createElement('p');
            uptimeParagraph.className = 'flex-between-center text-lg';
            uptimeParagraph.innerHTML = `
                <span class="font-medium text-gray-700">${displayName}:</span>
                <span class="text-blue-600 font-bold">${apiData.router_uptimes[routerId]}</span>
            `;
            uptimeContent.appendChild(uptimeParagraph);
        }
    }

    const totalClientsParagraph = document.createElement('p');
    totalClientsParagraph.className = 'flex-between-center text-lg';
    totalClientsParagraph.innerHTML = `
        <span class="font-bold text-gray-700">Total Connected Devices:</span>
        <span class="text-indigo-600 font-bold">${apiData.summary["Total All Connected"]} devices</span>
    `;
    uptimeContent.appendChild(totalClientsParagraph);
}

// Renders all clients grouped by their SSID in collapsible sections.
function renderGroupedClients() {
    if (!clientsGroupedContent) return;
    clientsGroupedContent.innerHTML = '';

    // Collects all SSIDs to ensure every one is displayed.
    const allSsids = Object.keys(apiData.summary).filter(key => key !== "Total All Connected");

    // Groups clients by their SSID.
    const groupedClients = apiData.clients.reduce((acc, client) => {
        const { ssid } = client;
        if (!acc[ssid]) {
            acc[ssid] = [];
        }
        acc[ssid].push(client);
        return acc;
    }, {});

    // Creates a collapsible section for each SSID.
    allSsids.forEach(ssid => {
        const clients = groupedClients[ssid] || [];
        const clientCount = apiData.summary[ssid] || 0;
        
        if (expandedSsids[ssid] === undefined) {
            expandedSsids[ssid] = false;
        }

        const groupDiv = document.createElement('div');
        groupDiv.className = 'ssid-group-container'; 

        const headerButton = document.createElement('button');
        headerButton.className = `ssid-header-button ${expandedSsids[ssid] ? 'expanded' : ''}`;
        headerButton.id = `ssid-button-${ssid}`;
        headerButton.innerHTML = `
            <span>
                ${ssid} (${clientCount} connected)
            </span>
            <svg
                id="ssid-icon-${ssid}"
                class="w-6 h-6 transform transition-transform duration-200"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
        `;
        headerButton.onclick = () => toggleSsidExpansion(ssid);
        groupDiv.appendChild(headerButton);

        const clientsGrid = document.createElement('div');
        clientsGrid.id = `clients-grid-${ssid}`;
        clientsGrid.className = `client-cards-grid collapse-content ${expandedSsids[ssid] ? 'expanded' : ''}`;

        if (clients.length > 0) {
            clients.forEach((client) => {
                const clientCard = document.createElement('div');
                clientCard.className = 'client-card';
                clientCard.innerHTML = `
                    <h4 class="client-card-title">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-1.25-3M15 10V5a3 3 0 00-3-3H9a3 3 0 00-3 3v5m6 0h.01M12 10h-.01M12 10v4.01m-4.75-4.01h9.5"></path></svg>
                        ${client.hostname}
                    </h4>
                    <div class="client-data-row">
                        <span class="label">Upload:</span>
                        <span class="value">${client.rx_data}</span>
                    </div>
                    <div class="client-data-row">
                        <span class="label">Download:</span>
                        <span class="value">${client.tx_data}</span>
                    </div>
                    <div class="client-data-row">
                        <span class="label">Uptime:</span>
                        <span class="value">${client.uptime}</span>
                    </div>
                `;
                clientsGrid.appendChild(clientCard);
            });
        } else {
            // Displays a message if there are no connected devices for this SSID.
            clientsGrid.innerHTML = `
                <div class="client-card" style="text-align: center; padding: 1.5rem; color: #666;">
                    No devices connected to this Wi-Fi network.
                </div>
            `;
        }
        groupDiv.appendChild(clientsGrid);
        clientsGroupedContent.appendChild(groupDiv);
    });
}

// Toggles the expanded state of an SSID group and applies the necessary CSS classes.
function toggleSsidExpansion(ssid) {
    const clientsGrid = document.getElementById(`clients-grid-${ssid}`);
    const headerButton = document.getElementById(`ssid-button-${ssid}`);

    if (clientsGrid && headerButton) {
        const isExpanded = clientsGrid.classList.contains('expanded');
        expandedSsids[ssid] = !isExpanded;

        if (isExpanded) {
            clientsGrid.classList.remove('expanded');
            headerButton.classList.remove('expanded');
        } else {
            clientsGrid.classList.add('expanded');
            headerButton.classList.add('expanded');
        }
    }
}

// Fetches data from the API and updates the dashboard.
async function fetchNetworkData() {
    showFullScreenLoader();
    hideErrorMessage();
    if (refreshButton) {
        refreshButton.disabled = true;
    }

    // Resets the expansion state for a fresh view.
    for (const key in expandedSsids) {
        delete expandedSsids[key];
    }

    try {
        const response = await fetch('/api/openwrt');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        apiData = transformData(data);
        renderRouterUptime();
        renderGroupedClients();
    } catch (error) {
        console.error('Error fetching network data:', error);
        showErrorMessage(`Failed to load data: ${error.message}. Please ensure the API is accessible and try again.`);
        if (uptimeContent) uptimeContent.innerHTML = '<p class="text-gray-600">Data not available.</p>';
        if (clientsGroupedContent) clientsGroupedContent.innerHTML = '';
    } finally {
        hideFullScreenLoader();
        if (refreshButton) {
            refreshButton.disabled = false;
        }
    }
}

// Initial data fetch and event listener setup on page load.
document.addEventListener('DOMContentLoaded', () => {
    fetchNetworkData();
    if (refreshButton) {
        refreshButton.addEventListener('click', fetchNetworkData);
    }
});
