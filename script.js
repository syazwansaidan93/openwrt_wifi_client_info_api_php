// Helper function to format uptime from seconds to "Xd Yh Zm"
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

// Helper function to format bytes to human-readable size
function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Global variable to store transformed API data
let apiData = {};
// State to manage the collapsed/expanded status of each SSID group
const expandedSsids = {};

// DOM elements
const uptimeContent = document.getElementById('router-uptime-content');
const clientsGroupedContent = document.getElementById('clients-grouped-content');
const errorMessageContainer = document.getElementById('error-message-container');
const refreshButton = document.getElementById('refresh-button');
const fullScreenLoader = document.getElementById('full-screen-loader');

// Function to show/hide the full-screen loading overlay
function showFullScreenLoader() {
    fullScreenLoader.classList.add('show');
}

function hideFullScreenLoader() {
    fullScreenLoader.classList.remove('show');
}

// Function to display error messages (only in the dedicated error container)
function showErrorMessage(message) {
    errorMessageContainer.textContent = message;
    errorMessageContainer.style.display = 'block';
}

// Function to hide error messages
function hideErrorMessage() {
    errorMessageContainer.style.display = 'none';
    errorMessageContainer.textContent = '';
}

// Transform raw data into the format expected by the dashboard
function transformData(data) {
    const transformed = {
        clients: [],
        router_uptimes: {},
        summary: {
            "Total All Connected": Number(data["total clients"]),
            "wifi_slow": Number(data["wifi_slow"]),
            "wifi_slow2": Number(data["wifi_slow2"]),
            "wifi_slow2_5g": Number(data["wifi_slow2_5g"]),
            "wifi_slow_5g": Number(data["wifi_slow_5g"])
        }
    };
    
    // Dynamically populate router uptimes
    for (const routerId in data.router_uptimes) {
        if (data.router_uptimes.hasOwnProperty(routerId)) {
            transformed.router_uptimes[routerId] = formatUptime(Number(data.router_uptimes[routerId]));
        }
    }
    
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

// Function to render Router Uptime
function renderRouterUptime() {
    if (!uptimeContent) return;
    uptimeContent.innerHTML = ''; // Clear previous content

    for (const routerId in apiData.router_uptimes) {
        if (apiData.router_uptimes.hasOwnProperty(routerId)) {
            // Check if the routerId has a hyphen. If so, use the part after it.
            // If not, use the full routerId.
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

// Function to render Clients Grouped by SSID
function renderGroupedClients() {
    if (!clientsGroupedContent) return;
    clientsGroupedContent.innerHTML = ''; // Clear previous content

    // Get all SSIDs from the summary, including those with 0 clients
    const allSsids = Object.keys(apiData.summary).filter(key => key !== "Total All Connected");

    // Group clients by SSID (only clients that actually exist in apiData.clients)
    const groupedClients = apiData.clients.reduce((acc, client) => {
        const { ssid } = client;
        if (!acc[ssid]) {
            acc[ssid] = [];
        }
        acc[ssid].push(client);
        return acc;
    }, {});

    // Iterate over all possible SSIDs to create the sections
    allSsids.forEach(ssid => {
        const clients = groupedClients[ssid] || [];
        const clientCount = apiData.summary[ssid] || 0;

        // Initialize expanded state for each SSID (default to false/collapsed)
        if (expandedSsids[ssid] === undefined) {
            expandedSsids[ssid] = false;
        }

        const groupDiv = document.createElement('div');
        groupDiv.className = 'ssid-group-container'; 

        const headerButton = document.createElement('button');
        headerButton.className = `ssid-header-button ${expandedSsids[ssid] ? 'expanded' : ''}`;
        // Assign a unique ID to the button and the SVG for easy targeting
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
        // Attach the event listener directly here, passing the SSID
        headerButton.onclick = () => toggleSsidExpansion(ssid);
        groupDiv.appendChild(headerButton);

        const clientsGrid = document.createElement('div');
        clientsGrid.id = `clients-grid-${ssid}`; // Unique ID for the content div
        clientsGrid.className = `client-cards-grid collapse-content ${expandedSsids[ssid] ? 'expanded' : ''}`;

        if (clients.length > 0) {
            clients.forEach((client, index) => {
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
                    <div class="client-data-row"> <!-- Uptime is now a regular data row -->
                        <span class="label">Uptime:</span>
                        <span class="value">${client.uptime}</span>
                    </div>
                `;
                clientsGrid.appendChild(clientCard);
            });
        } else {
            // Display message for no connected devices
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

// Function to toggle the expanded state of an SSID group and apply classes
function toggleSsidExpansion(ssid) {
    const clientsGrid = document.getElementById(`clients-grid-${ssid}`);
    const headerButton = document.getElementById(`ssid-button-${ssid}`);
    const headerIcon = document.getElementById(`ssid-icon-${ssid}`);

    if (clientsGrid && headerButton && headerIcon) {
        const isExpanded = clientsGrid.classList.contains('expanded');
        
        // Toggle the expanded state in our tracking object
        expandedSsids[ssid] = !isExpanded;

        // Apply/remove classes for transition
        if (isExpanded) {
            clientsGrid.classList.remove('expanded');
            headerButton.classList.remove('expanded');
        } else {
            clientsGrid.classList.add('expanded');
            headerButton.classList.add('expanded');
        }
    }
}

// Function to fetch data from the API
async function fetchNetworkData() {
    showFullScreenLoader(); // Show full-screen loader
    hideErrorMessage(); // Hide any previous error messages
    refreshButton.disabled = true; // Disable button during fetch

    // Reset expandedSsids state when new data is fetched
    for (const key in expandedSsids) {
        delete expandedSsids[key];
    }

    try {
        const response = await fetch('http://wifi.home/api/openwrt');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        apiData = transformData(data);
        renderRouterUptime();
        renderGroupedClients(); // This will now create the elements with correct initial classes
    } catch (error) {
        console.error('Error fetching network data:', error);
        showErrorMessage(`Failed to load data: ${error.message}. Please ensure the API is accessible and try again.`);
        uptimeContent.innerHTML = '<p class="text-gray-600">Data not available.</p>';
        clientsGroupedContent.innerHTML = '';
    } finally {
        hideFullScreenLoader(); // Hide full-screen loader
        refreshButton.disabled = false; // Re-enable button
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    fetchNetworkData(); // Initial data fetch on page load
    refreshButton.addEventListener('click', fetchNetworkData); // Add click listener to refresh button
});
