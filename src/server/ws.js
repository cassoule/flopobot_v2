import {WebSocket} from "ws";

const wss = new WebSocket.Server({ port: 8000 });

export function initializeWSS() {
    wss.on('connection', (ws) => {
        console.log("WSS Client connected");
        ws.on('message', (message) => {
            console.log("Message received : ", message.toString());
            ws.send(message);
        })
    })
}

