const mqtt = require('mqtt');

const printUsageAndExit = (info) => {
  console.log(info);
  process.exit(1);
};

module.exports.api = {
  getVersionString: () => {
    return 'Frigo Integration';
  },

  checkArgumentsOrExit: (args) => {
    if (!args.s) printUsageAndExit('HiveMQ: -s <mqtt broker url> is required');
    if (!args.u) printUsageAndExit('HiveMQ: -u <mqtt broker username> is required');
    if (!args.p) printUsageAndExit('HiveMQ: -p <mqtt broker password> is required');
  },

  connectAndSubscribe: async (args, devices, onUplinkDevicePortBufferDateLatLng) => {
    args.v && console.log('Trying to connect to', args.s);

    const options = {
      username: args.u,
      password: args.p
    };

    const client = mqtt.connect(args.s, options);

    client.on('connect', () => {
      args.v && console.log('Frigo: Connected to mqtt broker');

      if (Array.isArray(devices) && devices.length > 0) {
        devices.forEach((devEui) => {
          const topic = `mqtt/munin/${devEui.toUpperCase()}/uplink`;
          client.subscribe(topic, (err) => {
            if (err) {
              console.log(`Frigo subscribe failed: ${topic}: ${err.message}`);
            } else {
              args.v && console.log(`Frigo subscribed to ${topic}`);
            }
          });
        });
      } else {
        const topic = 'mqtt/munin/+/uplink';
        client.subscribe(topic, (err) => {
          if (err) {
            console.log(`Frigo wildcard subscribe failed: ${topic}: ${err.message}`);
          } else {
            args.v && console.log(`Frigo wildcard subscribed to ${topic}`);
          }
        });
      }
    });

    client.on('message', async (topic, message) => {
      try {
        args.v && console.log('Frigo message:', topic, message.toString());

        // 1) Parse TPX / Actility JSON
        const obj = JSON.parse(message.toString('utf-8'));

        // Mirror your TB converter behaviour:
        // - DevEUI_uplink
        // - DevEUI_notification (join)
        // - or fall back to the object itself
        const frame =
          obj.DevEUI_uplink ||
          obj.DevEUI_notification ||
          obj;

        // DevEUI (always present in all samples)
        const id = (frame.DevEUI || '').toUpperCase();

        if (!id) {
          console.log('Frigo: missing DevEUI in frame, skipping');
          return;
        }

        // FPort – join/notification has no FPort, data uplinks do.
        // Use 0 as a safe default for non-data frames.
        const port = frame.FPort ? parseInt(frame.FPort, 10) : 0;

        // payload_hex → Buffer
        // Join / some control frames may have no payload_hex → empty Buffer.
        const payloadHex = frame.payload_hex || '';
        const data = payloadHex
          ? Buffer.from(payloadHex, 'hex')
          : Buffer.alloc(0);

        // Time → JS Date; fallback to "now" if missing/invalid
        let date = new Date(frame.Time || Date.now());
        if (isNaN(date.getTime())) {
          date = new Date();
        }

        // Gateway / RSSI info – no lat/lon in samples, so leave undefined for now.
        let lat;
        let lng;

        // maxSize – LoRa downlink max payload size, we can refine later.
        const maxSize = 40;

        // 2) Hand off to Munin core (solver + decorator + publisher)
        await onUplinkDevicePortBufferDateLatLng(
          client,
          id,
          port,
          data,
          date,
          lat,
          lng,
          maxSize
        );
      } catch (e) {
        console.log('Frigo: error handling message:', e.message);
      }
    });

    return client;
  },

  sendDownlink: async (client, args, deviceId, port, data, confirmed) => {
    console.log(
      'Frigo sendDownlink (not implemented yet):',
      deviceId,
      'port',
      port,
      'len',
      Buffer.isBuffer(data) ? data.length : 'n/a'
    );
  }
};
