const WebSocket = require('ws');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const apiKey = process.env.AISSTREAM_API_KEY;
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

ws.on('open', () => {
    console.log('Connected.');
    const msg = {
        Apikey: apiKey,
        BoundingBoxes: [
            // Test 1: SW, NE (What we currently do) for Mumbai High
            [[19.30, 71.40], [19.49, 71.59]],
            // Test 2: NW, SE for Fujairah
            [[25.29, 56.30], [25.10, 56.49]],
            // Test 3: Chennai (Wait, how was Chennai written?)
            [[13.00, 80.30], [13.19, 80.49]]
        ],
        FiltersShipMMSI: [],
        FilterMessageTypes: ["PositionReport"]
    };
    ws.send(JSON.stringify(msg));
});

let counts = {
    mumbai_sw_ne: 0,
    fujairah_nw_se: 0,
    chennai_sw_ne: 0
};

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.MessageType === 'PositionReport') {
        const lat = msg.Message.PositionReport.Latitude;
        const lon = msg.Message.PositionReport.Longitude;
        
        if (lat >= 19.30 && lat <= 19.49 && lon >= 71.40 && lon <= 71.59) {
            counts.mumbai_sw_ne++;
        }
        if (lat >= 25.10 && lat <= 25.29 && lon >= 56.30 && lon <= 56.49) {
            counts.fujairah_nw_se++;
        }
        if (lat >= 13.00 && lat <= 13.19 && lon >= 80.30 && lon <= 80.49) {
            counts.chennai_sw_ne++;
        }
        console.log(counts);
    }
});

setTimeout(() => {
    console.log('Final counts:', counts);
    ws.close();
}, 15000);
