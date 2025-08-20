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

            if (data.startsWith('PLAYER:')) {
                console.log('Received Minecraft block data');
                latestMinecraftData = data;

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

            else if (data.toLowerCase() === 'fullscan') {
                console.log('Full scan requested from client');

                connectedClients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        try {
                            client.send('fullscan');
                        } catch (error) {
                            console.error('Error forwarding fullscan:', error);
                        }
                    }
                });
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
        console.log(`Client disconnected: ${code} - ${reason}`);
        console.log(`Active connections: ${connectedClients.size}`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        connectedClients.delete(ws);
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
        hasMinecraftData: !!latestMinecraftData,
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Minecraft-Roblox Relay Server',
        endpoints: {
            websocket: 'wss://your-domain/ws',
            blocks: '/blocks',
            health: '/health'
        },
        connections: connectedClients.size
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Minecraft-Roblox Relay Server running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);

    setInterval(() => {
        console.log(`Active connections: ${connectedClients.size}, Has Minecraft data: ${!!latestMinecraftData}`);
    }, 30000);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

