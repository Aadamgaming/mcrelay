const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

let latestMinecraftData = '';
let connectedClients = new Set();
let minecraftClients = new Set(); // Track Minecraft clients specifically

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`New WebSocket connection from: ${clientIP}`);

    connectedClients.add(ws);

    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to Minecraft-Roblox relay server!'
    }));

    if (latestMinecraftData) {
        ws.send(latestMinecraftData);
    }

    ws.on('message', (message) => {
        try {
            const data = message.toString();
            console.log(`Received message: ${data.substring(0, 100)}...`);

            // Check if this is Minecraft data (JSON with blocks/players)
            try {
                const parsedData = JSON.parse(data);
                if (parsedData.blocks !== undefined || parsedData.players !== undefined) {
                    console.log('Received Minecraft block/player data');
                    latestMinecraftData = data;
                    minecraftClients.add(ws); // Mark as Minecraft client

                    // Broadcast to all other clients
                    connectedClients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            try {
                                client.send(data);
                            } catch (error) {
                                console.error('Error sending to client:', error);
                                connectedClients.delete(client);
                            }
                        }
                    });

                    console.log(`Broadcasted to ${connectedClients.size - 1} clients`);
                    return;
                }
            } catch (e) {
                // Not JSON, continue with other message types
            }

            // Handle legacy PLAYER: format
            if (data.startsWith('PLAYER:')) {
                console.log('Received legacy Minecraft block data');
                latestMinecraftData = data;
                minecraftClients.add(ws); // Mark as Minecraft client

                connectedClients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(data);
                        } catch (error) {
                            console.error('Error sending to client:', error);
                            connectedClients.delete(client);
                        }
                    }
                });

                console.log(`Broadcasted to ${connectedClients.size - 1} clients`);
            }
            // Handle scan requests
            else if (data.toLowerCase() === 'fullscan' || data.toLowerCase() === 'scan' || data.toLowerCase() === 'newscan') {
                console.log('Full scan requested from client');

                // Send scan request to all Minecraft clients
                minecraftClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(JSON.stringify({
                                type: 'scan_request',
                                message: 'Please send updated data'
                            }));
                        } catch (error) {
                            console.error('Error requesting scan from Minecraft client:', error);
                            minecraftClients.delete(client);
                        }
                    } else {
                        minecraftClients.delete(client);
                    }
                });

                console.log(`Requested new scan from ${minecraftClients.size} Minecraft clients`);
            }
            else {
                console.log('Unknown message type:', data);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', (code, reason) => {
        connectedClients.delete(ws);
        minecraftClients.delete(ws);
        console.log(`Client disconnected: ${code} - ${reason}`);
        console.log(`Active connections: ${connectedClients.size} (${minecraftClients.size} Minecraft clients)`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        connectedClients.delete(ws);
        minecraftClients.delete(ws);
    });
});

// HTTP endpoint to request new scan
app.post('/scan', (req, res) => {
    console.log('HTTP request for new scan');

    if (minecraftClients.size === 0) {
        return res.json({
            success: false,
            message: 'No Minecraft clients connected',
            timestamp: Date.now()
        });
    }

    // Send scan request to all Minecraft clients
    let requestsSent = 0;
    minecraftClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify({
                    type: 'scan_request',
                    message: 'Please send updated data'
                }));
                requestsSent++;
            } catch (error) {
                console.error('Error requesting scan from Minecraft client:', error);
                minecraftClients.delete(client);
            }
        } else {
            minecraftClients.delete(client);
        }
    });

    res.json({
        success: true,
        message: `Scan requested from ${requestsSent} Minecraft clients`,
        timestamp: Date.now()
    });
});

app.get('/blocks', (req, res) => {
    console.log('HTTP request for block data');

    if (latestMinecraftData) {
        res.json({
            success: true,
            data: latestMinecraftData,
            timestamp: Date.now()
        });
    } else {
        res.json({
            success: false,
            message: 'No Minecraft data available',
            timestamp: Date.now()
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        connections: connectedClients.size,
        minecraftClients: minecraftClients.size,
        hasMinecraftData: !!latestMinecraftData,
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Minecraft-Roblox Relay Server',
        endpoints: {
            websocket: 'wss://your-domain/',
            blocks: 'GET /blocks',
            scan: 'POST /scan',
            health: 'GET /health'
        },
        connections: connectedClients.size,
        minecraftClients: minecraftClients.size
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Minecraft-Roblox Relay Server running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);

    setInterval(() => {
        console.log(`Active connections: ${connectedClients.size} (${minecraftClients.size} Minecraft clients), Has data: ${!!latestMinecraftData}`);
    }, 30000);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
